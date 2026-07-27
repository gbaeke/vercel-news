import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';
import sanitizeHtml from 'sanitize-html';
import { renderMarkdown } from './markdown';
import { getPool, query } from './db';
import { deleteAudioIfOrphaned, type BlobDeleter } from './blobCleanup';
import { generateSpeechBytes } from './llm';
import type { Article, ArticleAudio } from './types';

export const DEFAULT_SPEECH_MODEL = 'openai/tts-1';
export const DEFAULT_SPEECH_VOICE = 'alloy';
export const MAX_SPEECH_CHARACTERS = 4_096;
export const MAX_AUDIO_ATTEMPTS = 3;
const NARRATION_SCRIPT_VERSION = 'v1';
const STALE_CLAIM_MINUTES = 10;
const MAX_ERROR_LENGTH = 1_000;

export interface AudioWorkerDeps {
  generateSpeech?: (text: string, voice: string) => Promise<Buffer>;
  uploadBlob?: (name: string, data: Buffer, contentType: string) => Promise<string>;
  del?: BlobDeleter;
}

export interface AudioTickResult {
  articleId: number;
  from: 'pending' | 'processing';
  to: 'ready' | 'pending' | 'failed';
  attempt: number;
  error?: string;
}

export type AudioRequestResult =
  | { ok: true; status: ArticleAudio['status']; changed: boolean }
  | { ok: false; reason: 'not_found' | 'not_published' };

export class AudioInputTooLongError extends Error {
  constructor(length: number) {
    super(
      `Narration is ${length.toLocaleString('en-US')} characters; the economical speech model limit is ` +
      `${MAX_SPEECH_CHARACTERS.toLocaleString('en-US')}. Shorten the article, then publish the correction.`
    );
    this.name = 'AudioInputTooLongError';
  }
}

class PermanentAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentAudioError';
  }
}

function decodeEntities(text: string): string {
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function markdownToSpeechText(markdown: string): string {
  const html = renderMarkdown(markdown)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|h[1-6]|li|blockquote|pre|div)>/gi, '\n\n');
  return html
    .split(/\n+/)
    .map((part) => decodeEntities(part)
      // Markdown links retain their human-readable label after HTML stripping;
      // bare/autolinked URLs are omitted because reading them aloud is noisy.
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n\n');
}

export function buildNarration(article: Pick<Article, 'title' | 'content_md'>): string {
  const title = (article.title ?? 'Untitled').trim();
  const body = markdownToSpeechText(article.content_md ?? '');
  return [
    title,
    'This article is narrated by an AI-generated voice.',
    body,
  ].filter(Boolean).join('\n\n');
}

export function audioSourceHash(
  narration: string,
  model = process.env.SPEECH_MODEL ?? DEFAULT_SPEECH_MODEL,
  voice = process.env.SPEECH_VOICE ?? DEFAULT_SPEECH_VOICE
): string {
  return createHash('sha256')
    .update(`${NARRATION_SCRIPT_VERSION}\0${model}\0${voice}\0${narration}`)
    .digest('hex');
}

async function defaultUploadBlob(name: string, data: Buffer, contentType: string): Promise<string> {
  const blob = await put(name, data, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31_536_000,
  });
  return blob.url;
}

async function enqueueArticle(
  article: Article,
  forceRetry: boolean,
  deps: Pick<AudioWorkerDeps, 'del'> = {}
): Promise<AudioRequestResult> {
  if (article.status !== 'published') return { ok: false, reason: 'not_published' };

  const model = process.env.SPEECH_MODEL ?? DEFAULT_SPEECH_MODEL;
  const voice = process.env.SPEECH_VOICE ?? DEFAULT_SPEECH_VOICE;
  const sourceHash = audioSourceHash(buildNarration(article), model, voice);
  const [previous] = await query<Pick<ArticleAudio, 'source_hash' | 'status' | 'blob_url'>>(
    `SELECT source_hash, status, blob_url FROM article_audio WHERE article_id = $1`,
    [article.id]
  );

  const sameSource = previous?.source_hash === sourceHash;
  if (sameSource && !forceRetry) {
    return { ok: true, status: previous.status, changed: false };
  }

  await query(
    `INSERT INTO article_audio (
       article_id, article_version, source_hash, status, model, voice,
       attempt_count, next_attempt_at, updated_at
     )
     VALUES ($1, $2, $3, 'pending', $4, $5, 0, now(), now())
     ON CONFLICT (article_id) DO UPDATE SET
       article_version = EXCLUDED.article_version,
       source_hash = EXCLUDED.source_hash,
       status = 'pending',
       model = EXCLUDED.model,
       voice = EXCLUDED.voice,
       blob_url = NULL,
       byte_length = NULL,
       media_type = NULL,
       attempt_count = 0,
       next_attempt_at = now(),
       claimed_at = NULL,
       last_error = NULL,
       generated_at = NULL,
       updated_at = now()`,
    [article.id, article.version, sourceHash, model, voice]
  );

  if (previous?.blob_url) {
    await deleteAudioIfOrphaned(previous.blob_url, deps);
  }
  return { ok: true, status: 'pending', changed: true };
}

export async function enqueueArticleAudioById(
  articleId: number,
  options: { forceRetry?: boolean; deps?: Pick<AudioWorkerDeps, 'del'> } = {}
): Promise<AudioRequestResult> {
  const [article] = await query<Article>(`SELECT * FROM articles WHERE id = $1`, [articleId]);
  if (!article) return { ok: false, reason: 'not_found' };
  return enqueueArticle(article, options.forceRetry ?? false, options.deps);
}

async function claimNextAudio(): Promise<ArticleAudio | null> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query<ArticleAudio>(
      `SELECT *
       FROM article_audio
       WHERE (
         status = 'pending'
         AND next_attempt_at IS NOT NULL
         AND next_attempt_at <= now()
       ) OR (
         status = 'processing'
         AND claimed_at < now() - ($1 * interval '1 minute')
       )
       ORDER BY updated_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [STALE_CLAIM_MINUTES]
    );
    const job = selected.rows[0];
    if (!job) {
      await client.query('COMMIT');
      return null;
    }
    const claimed = await client.query<ArticleAudio>(
      `UPDATE article_audio
       SET status = 'processing',
           attempt_count = CASE WHEN status = 'pending' THEN attempt_count + 1 ELSE attempt_count END,
           claimed_at = now(),
           next_attempt_at = NULL,
           updated_at = now()
       WHERE article_id = $1
       RETURNING *`,
      [job.article_id]
    );
    await client.query('COMMIT');
    return claimed.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function statusCodeFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { statusCode?: unknown; status?: unknown };
  const value = candidate.statusCode ?? candidate.status;
  return typeof value === 'number' ? value : undefined;
}

export function isTransientAudioError(error: unknown): boolean {
  if (error instanceof AudioInputTooLongError || error instanceof PermanentAudioError) return false;
  const status = statusCodeFromError(error);
  if (status !== undefined) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return true;
  // Unknown network/provider failures get the benefit of the persisted retry
  // budget; deterministic input failures are explicitly classified above.
  return true;
}

function retryDelayMinutes(attempt: number): number {
  return [15, 60, 360][Math.max(0, Math.min(attempt - 1, 2))];
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= MAX_ERROR_LENGTH ? message : `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

async function failOrRetry(job: ArticleAudio, error: unknown): Promise<AudioTickResult> {
  const message = errorMessage(error);
  const retry = isTransientAudioError(error) && job.attempt_count < MAX_AUDIO_ATTEMPTS;
  if (retry) {
    await query(
      `UPDATE article_audio
       SET status = 'pending',
           next_attempt_at = now() + ($1 * interval '1 minute'),
           claimed_at = NULL,
           last_error = $2,
           updated_at = now()
       WHERE article_id = $3 AND status = 'processing' AND source_hash = $4`,
      [retryDelayMinutes(job.attempt_count), message, job.article_id, job.source_hash]
    );
    return {
      articleId: job.article_id,
      from: 'processing',
      to: 'pending',
      attempt: job.attempt_count,
      error: message,
    };
  }

  await query(
    `UPDATE article_audio
     SET status = 'failed',
         next_attempt_at = NULL,
         claimed_at = NULL,
         last_error = $1,
         updated_at = now()
     WHERE article_id = $2 AND status = 'processing' AND source_hash = $3`,
    [message, job.article_id, job.source_hash]
  );
  return {
    articleId: job.article_id,
    from: 'processing',
    to: 'failed',
    attempt: job.attempt_count,
    error: message,
  };
}

export async function processAudioJob(
  job: ArticleAudio,
  deps: AudioWorkerDeps = {}
): Promise<AudioTickResult> {
  try {
    const [article] = await query<Article>(`SELECT * FROM articles WHERE id = $1`, [job.article_id]);
    if (!article || article.status !== 'published') {
      throw new PermanentAudioError('Article is no longer published; audio generation was cancelled.');
    }
    const narration = buildNarration(article);
    const currentHash = audioSourceHash(narration, job.model, job.voice);
    if (article.version !== job.article_version || currentHash !== job.source_hash) {
      throw new PermanentAudioError(
        'Article changed after audio was queued; publish it again to create a corrected episode.'
      );
    }
    if (narration.length > MAX_SPEECH_CHARACTERS) {
      throw new AudioInputTooLongError(narration.length);
    }

    const generate = deps.generateSpeech ?? generateSpeechBytes;
    const upload = deps.uploadBlob ?? defaultUploadBlob;
    const bytes = await generate(narration, job.voice);
    if (bytes.length === 0) throw new Error('Speech provider returned an empty audio file.');

    const blobName = `audio/${job.article_id}/v${job.article_version}-${job.source_hash.slice(0, 12)}.mp3`;
    const blobUrl = await upload(blobName, bytes, 'audio/mpeg');
    const rows = await query<{ article_id: number }>(
      `UPDATE article_audio
       SET status = 'ready',
           blob_url = $1,
           byte_length = $2,
           media_type = 'audio/mpeg',
           generated_at = now(),
           next_attempt_at = NULL,
           claimed_at = NULL,
           last_error = NULL,
           updated_at = now()
       WHERE article_id = $3
         AND status = 'processing'
         AND article_version = $4
         AND source_hash = $5
       RETURNING article_id`,
      [blobUrl, bytes.length, job.article_id, job.article_version, job.source_hash]
    );
    if (rows.length === 0) {
      await deleteAudioIfOrphaned(blobUrl, { del: deps.del });
      throw new Error('Audio job changed while the MP3 was being generated; the uploaded file was discarded.');
    }
    return {
      articleId: job.article_id,
      from: 'processing',
      to: 'ready',
      attempt: job.attempt_count,
    };
  } catch (error) {
    return failOrRetry(job, error);
  }
}

export async function runAudioTick(
  deps: AudioWorkerDeps = {},
  maxJobs = Number(process.env.AUDIO_JOBS_PER_TICK ?? 1)
): Promise<AudioTickResult[]> {
  const requestedJobs = Number.isFinite(maxJobs) ? maxJobs : 1;
  const safeMaxJobs = Math.max(0, Math.min(10, Math.trunc(requestedJobs)));
  const results: AudioTickResult[] = [];
  for (let i = 0; i < safeMaxJobs; i += 1) {
    const job = await claimNextAudio();
    if (!job) break;
    const result = await processAudioJob(job, deps);
    console.log(
      `[audio] article ${result.articleId}: processing -> ${result.to} ` +
      `(attempt ${result.attempt}${result.error ? `: ${result.error}` : ''})`
    );
    results.push(result);
  }
  return results;
}

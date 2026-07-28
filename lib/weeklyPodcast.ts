import { createHash } from 'node:crypto';
import { getPool, query } from './db';
import { structured } from './llm';
import { loadPrompt } from './prompts';
import type {
  Article,
  WeeklyDialogueTurn,
  WeeklyEpisode,
  WeeklyEpisodeSegment,
  WeeklyEpisodeSource,
} from './types';

export const WEEKLY_TIME_ZONE = 'Europe/Brussels';
export const WEEKLY_PROVIDER = 'elevenlabs';
export const DEFAULT_WEEKLY_SPEECH_MODEL = 'eleven_v3';
export const MAX_DIALOGUE_REQUEST_CHARACTERS = 1_800;
const WEEKLY_PROMPT_VERSION = 'v1';
const MAX_WEEKLY_ERROR_LENGTH = 1_000;

export interface WeeklyScriptResult {
  title: string;
  summary: string;
  turns: WeeklyDialogueTurn[];
}

interface WeeklySourceArticle extends Article {
  content_md: string;
  title: string;
  summary: string;
  slug: string;
  published_at: string;
}

export interface WeeklyWindow {
  weekKey: string;
  periodStart: string;
  periodEnd: string;
}

export interface WeeklyProducerJob {
  episode: WeeklyEpisode;
  sources: WeeklyEpisodeSource[];
  segments: WeeklyEpisodeSegment[];
}

export interface WeeklyScriptPreparation {
  window: WeeklyWindow;
  sourceHash: string;
  sourcePacket: string;
  existingJob: WeeklyProducerJob | null;
}

export interface WeeklyPrepareDeps {
  now?: Date;
  weekKey?: string;
  generateStructured?: typeof structured;
}

const WEEKLY_SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    turns: {
      type: 'array',
      minItems: 16,
      maxItems: 48,
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', enum: ['host', 'analyst'] },
          text: { type: 'string' },
          delivery: { type: 'string' },
        },
        required: ['speaker', 'text', 'delivery'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'turns'],
  additionalProperties: false,
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function zonedDateParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let candidate = targetAsUtc;
  // Resolve the zone offset at this particular local date. Iterating also
  // handles the week in which Europe/Brussels changes daylight-saving offset.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedDateParts(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    );
    candidate += targetAsUtc - observedAsUtc;
  }
  return new Date(candidate);
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isoWeekKeyFromMonday(mondayCalendarDate: Date): string {
  const thursday = addUtcDays(mondayCalendarDate, 3);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4IsoDay = jan4.getUTCDay() || 7;
  const firstMonday = addUtcDays(jan4, 1 - jan4IsoDay);
  const week = Math.floor(
    (mondayCalendarDate.getTime() - firstMonday.getTime()) / (7 * 86_400_000)
  ) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function previousWeeklyWindow(
  now = new Date(),
  timeZone = WEEKLY_TIME_ZONE
): WeeklyWindow {
  const local = zonedDateParts(now, timeZone);
  const localCalendarDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const isoDay = localCalendarDate.getUTCDay() || 7;
  const currentMonday = addUtcDays(localCalendarDate, 1 - isoDay);
  const previousMonday = addUtcDays(currentMonday, -7);
  const nextMonday = addUtcDays(previousMonday, 7);
  return {
    weekKey: isoWeekKeyFromMonday(previousMonday),
    periodStart: zonedMidnightUtc(
      previousMonday.getUTCFullYear(),
      previousMonday.getUTCMonth() + 1,
      previousMonday.getUTCDate(),
      timeZone
    ).toISOString(),
    periodEnd: zonedMidnightUtc(
      nextMonday.getUTCFullYear(),
      nextMonday.getUTCMonth() + 1,
      nextMonday.getUTCDate(),
      timeZone
    ).toISOString(),
  };
}

export function weeklyWindowForKey(
  weekKey: string,
  timeZone = WEEKLY_TIME_ZONE
): WeeklyWindow {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) throw new Error('weekKey must use ISO format YYYY-Www');
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  if (isoWeek < 1 || isoWeek > 53) throw new Error('weekKey contains an invalid ISO week');
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4IsoDay = jan4.getUTCDay() || 7;
  const firstMonday = addUtcDays(jan4, 1 - jan4IsoDay);
  const monday = addUtcDays(firstMonday, (isoWeek - 1) * 7);
  if (isoWeekKeyFromMonday(monday) !== weekKey) {
    throw new Error('weekKey does not exist in the requested ISO year');
  }
  const nextMonday = addUtcDays(monday, 7);
  return {
    weekKey,
    periodStart: zonedMidnightUtc(
      monday.getUTCFullYear(),
      monday.getUTCMonth() + 1,
      monday.getUTCDate(),
      timeZone
    ).toISOString(),
    periodEnd: zonedMidnightUtc(
      nextMonday.getUTCFullYear(),
      nextMonday.getUTCMonth() + 1,
      nextMonday.getUTCDate(),
      timeZone
    ).toISOString(),
  };
}

function publicArticleUrl(article: WeeklySourceArticle): string {
  const base = process.env.APP_URL;
  if (!base) return article.trigger_url;
  try {
    return new URL(
      `/articles/${encodeURIComponent(article.slug)}`,
      `${base.replace(/\/+$/, '')}/`
    ).toString();
  } catch {
    return article.trigger_url;
  }
}

function sourcePacket(articles: WeeklySourceArticle[]): string {
  return articles.map((article, index) => [
    `ARTICLE ${index + 1}`,
    `Title: ${article.title}`,
    `Published: ${article.published_at}`,
    `Summary: ${article.summary}`,
    `Body:\n${article.content_md.slice(0, 8_000)}`,
  ].join('\n')).join('\n\n---\n\n');
}

function weeklySourceHash(articles: WeeklySourceArticle[], window: WeeklyWindow): string {
  return sha256(JSON.stringify({
    promptVersion: WEEKLY_PROMPT_VERSION,
    weekKey: window.weekKey,
    articles: articles.map((article) => ({
      id: article.id,
      version: article.version,
      title: article.title,
      summary: article.summary,
      content: article.content_md,
    })),
  }));
}

function normalizeScript(candidate: WeeklyScriptResult): WeeklyScriptResult {
  const title = String(candidate.title ?? '').replace(/\s+/g, ' ').trim();
  const summary = String(candidate.summary ?? '').replace(/\s+/g, ' ').trim();
  const turns = Array.isArray(candidate.turns)
    ? candidate.turns.map((turn) => ({
      speaker: turn.speaker,
      text: String(turn.text ?? '').replace(/\s+/g, ' ').trim(),
      delivery: String(turn.delivery ?? '').replace(/[\[\]\r\n]/g, '').trim().slice(0, 80),
    })).filter((turn): turn is WeeklyDialogueTurn =>
      (turn.speaker === 'host' || turn.speaker === 'analyst') && turn.text.length > 0
    )
    : [];

  if (!title || !summary) throw new Error('Weekly script is missing a title or summary.');
  if (turns.length < 4) throw new Error('Weekly script contains fewer than four usable turns.');
  if (!turns.some((turn) => turn.speaker === 'host')
    || !turns.some((turn) => turn.speaker === 'analyst')) {
    throw new Error('Weekly script must contain both host and analyst turns.');
  }
  if (turns.some((turn) => turn.text.length > 900)) {
    throw new Error('Weekly script contains a turn that is too long for natural dialogue.');
  }
  return { title, summary, turns };
}

async function generateValidWeeklyScript(
  generate: typeof structured,
  system: string,
  user: string,
  stage: 'draft' | 'verification'
): Promise<WeeklyScriptResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const retryHint = attempt === 1
        ? ''
        : '\n\nYour previous response was unusable. Return 24–40 non-empty turn objects, ' +
          'alternate the host and analyst naturally, and use lowercase speaker values exactly.';
      const candidate = await generate<WeeklyScriptResult>(
        system,
        `${user}${retryHint}`,
        WEEKLY_SCRIPT_SCHEMA
      );
      return normalizeScript(candidate);
    } catch (error) {
      lastError = error;
      console.warn(
        `[weekly] ${stage} script attempt ${attempt} was invalid: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Weekly ${stage} script was invalid after two attempts: ${detail}`);
}

export async function generateWeeklyScript(
  preparation: Pick<WeeklyScriptPreparation, 'window' | 'sourcePacket'>,
  generate: typeof structured = structured
): Promise<WeeklyScriptResult> {
  const draft = await generateValidWeeklyScript(
    generate,
    loadPrompt('weekly-system'),
    loadPrompt('weekly-user', {
      week_key: preparation.window.weekKey,
      period_start: preparation.window.periodStart,
      period_end: preparation.window.periodEnd,
      articles: preparation.sourcePacket,
    }),
    'draft'
  );
  return generateValidWeeklyScript(
    generate,
    loadPrompt('weekly-verify-system'),
    loadPrompt('weekly-verify-user', {
      week_key: preparation.window.weekKey,
      articles: preparation.sourcePacket,
      draft: JSON.stringify(draft, null, 2),
    }),
    'verification'
  );
}

export function dialogueTurnCharacters(turn: WeeklyDialogueTurn): number {
  return turn.text.length + (turn.delivery ? turn.delivery.length + 3 : 0);
}

export function splitDialogueTurns(
  turns: WeeklyDialogueTurn[],
  maxCharacters = MAX_DIALOGUE_REQUEST_CHARACTERS
): WeeklyDialogueTurn[][] {
  if (!Number.isFinite(maxCharacters) || maxCharacters < 100) {
    throw new Error('Dialogue segment character limit is invalid.');
  }
  const segments: WeeklyDialogueTurn[][] = [];
  let current: WeeklyDialogueTurn[] = [];
  let currentCharacters = 0;
  for (const turn of turns) {
    const characters = dialogueTurnCharacters(turn);
    if (characters > maxCharacters) {
      throw new Error(`A weekly dialogue turn is ${characters} characters and cannot fit in one segment.`);
    }
    if (current.length > 0 && currentCharacters + characters > maxCharacters) {
      segments.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(turn);
    currentCharacters += characters;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

async function sourceArticlesForWindow(window: WeeklyWindow): Promise<WeeklySourceArticle[]> {
  const configured = Number(process.env.WEEKLY_MAX_SOURCE_ARTICLES ?? 12);
  const limit = Number.isFinite(configured) ? Math.max(1, Math.min(30, Math.trunc(configured))) : 12;
  return query<WeeklySourceArticle>(
    `SELECT *
     FROM articles
     WHERE status = 'published'
       AND published_at >= $1
       AND published_at < $2
       AND title IS NOT NULL
       AND summary IS NOT NULL
       AND content_md IS NOT NULL
       AND slug IS NOT NULL
     ORDER BY published_at DESC
     LIMIT $3`,
    [window.periodStart, window.periodEnd, limit]
  );
}

async function getEpisodeByWeek(weekKey: string): Promise<WeeklyEpisode | null> {
  const [episode] = await query<WeeklyEpisode>(
    `SELECT * FROM weekly_episodes WHERE week_key = $1`,
    [weekKey]
  );
  return episode ?? null;
}

export async function getWeeklyProducerJob(episodeId: string): Promise<WeeklyProducerJob | null> {
  const [[episode], sources, segments] = await Promise.all([
    query<WeeklyEpisode>(`SELECT * FROM weekly_episodes WHERE id = $1`, [episodeId]),
    query<WeeklyEpisodeSource>(
      `SELECT * FROM weekly_episode_sources WHERE episode_id = $1 ORDER BY position`,
      [episodeId]
    ),
    query<WeeklyEpisodeSegment>(
      `SELECT * FROM weekly_episode_segments WHERE episode_id = $1 ORDER BY position`,
      [episodeId]
    ),
  ]);
  return episode ? { episode, sources, segments } : null;
}

async function savePreparedEpisode(
  episodeId: string,
  articles: WeeklySourceArticle[],
  script: WeeklyScriptResult,
  sourceHash: string
): Promise<void> {
  const scriptValue = { turns: script.turns };
  const scriptHash = sha256(JSON.stringify({
    promptVersion: WEEKLY_PROMPT_VERSION,
    title: script.title,
    summary: script.summary,
    script: scriptValue,
  }));
  const segments = splitDialogueTurns(script.turns);
  const showNotes = [
    'Sources:',
    ...articles.map((article) => `- ${article.title} — ${publicArticleUrl(article)}`),
  ].join('\n');

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE weekly_episodes
       SET status = 'scripted',
           title = $1,
           summary = $2,
           show_notes = $3,
           script = $4::jsonb,
           script_hash = $5,
           provider = $6,
           model = $7,
           claimed_at = NULL,
           last_error = NULL,
           updated_at = now()
       WHERE id = $8 AND status = 'preparing' AND source_hash = $9`,
      [
        script.title,
        script.summary,
        showNotes,
        JSON.stringify(scriptValue),
        scriptHash,
        WEEKLY_PROVIDER,
        process.env.WEEKLY_SPEECH_MODEL ?? DEFAULT_WEEKLY_SPEECH_MODEL,
        episodeId,
        sourceHash,
      ]
    );
    await client.query(`DELETE FROM weekly_episode_sources WHERE episode_id = $1`, [episodeId]);
    await client.query(`DELETE FROM weekly_episode_segments WHERE episode_id = $1`, [episodeId]);

    for (const [position, article] of articles.entries()) {
      await client.query(
        `INSERT INTO weekly_episode_sources (
           episode_id, position, article_id, article_version, title, url
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          episodeId,
          position,
          article.id,
          article.version,
          article.title,
          publicArticleUrl(article),
        ]
      );
    }
    for (const [position, turns] of segments.entries()) {
      const segmentHash = sha256(`${scriptHash}\0${position}\0${JSON.stringify(turns)}`);
      await client.query(
        `INSERT INTO weekly_episode_segments (
           episode_id, position, turns, source_hash, status
         ) VALUES ($1, $2, $3::jsonb, $4, 'pending')`,
        [episodeId, position, JSON.stringify(turns), segmentHash]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= MAX_WEEKLY_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_WEEKLY_ERROR_LENGTH - 1)}…`;
}

async function markPrepareFailed(episodeId: string, error: unknown): Promise<void> {
  await query(
    `UPDATE weekly_episodes
     SET status = 'failed',
         claimed_at = NULL,
         last_error = $1,
         updated_at = now()
     WHERE id = $2 AND status = 'preparing'`,
    [errorMessage(error), episodeId]
  );
}

export async function prepareWeeklySources(
  deps: Pick<WeeklyPrepareDeps, 'now' | 'weekKey'> = {}
): Promise<WeeklyScriptPreparation> {
  const window = deps.weekKey
    ? weeklyWindowForKey(deps.weekKey)
    : previousWeeklyWindow(deps.now);
  const articles = await sourceArticlesForWindow(window);
  if (articles.length === 0) {
    throw new Error(`No published articles were found for ${window.weekKey}.`);
  }
  const sourceHash = weeklySourceHash(articles, window);
  const existing = await getEpisodeByWeek(window.weekKey);
  const canReuse = existing?.status === 'ready'
    || (existing?.source_hash === sourceHash && existing.script && existing.script_hash);
  return {
    window,
    sourceHash,
    sourcePacket: sourcePacket(articles),
    existingJob: canReuse ? await getWeeklyProducerJob(existing.id) : null,
  };
}

export async function saveWeeklyScript(input: {
  weekKey: string;
  sourceHash: string;
  script: WeeklyScriptResult;
}): Promise<WeeklyProducerJob> {
  const window = weeklyWindowForKey(input.weekKey);
  const articles = await sourceArticlesForWindow(window);
  if (articles.length === 0) {
    throw new Error(`No published articles were found for ${window.weekKey}.`);
  }
  const currentSourceHash = weeklySourceHash(articles, window);
  if (currentSourceHash !== input.sourceHash) {
    throw new Error('Weekly sources changed while the script was being generated; retry the job.');
  }
  const existing = await getEpisodeByWeek(window.weekKey);
  if (existing?.status === 'ready') {
    return (await getWeeklyProducerJob(existing.id))!;
  }
  if (existing?.source_hash === currentSourceHash && existing.script && existing.script_hash) {
    return (await getWeeklyProducerJob(existing.id))!;
  }

  const script = normalizeScript(input.script);
  const [episode] = await query<WeeklyEpisode>(
    `INSERT INTO weekly_episodes (
       week_key, period_start, period_end, status, source_hash, provider, model, claimed_at
     )
     VALUES ($1, $2, $3, 'preparing', $4, $5, $6, now())
     ON CONFLICT (week_key) DO UPDATE SET
       period_start = EXCLUDED.period_start,
       period_end = EXCLUDED.period_end,
       status = 'preparing',
       source_hash = EXCLUDED.source_hash,
       title = NULL,
       summary = NULL,
       show_notes = NULL,
       script = NULL,
       script_hash = NULL,
       blob_url = NULL,
       byte_length = NULL,
       media_type = NULL,
       duration_seconds = NULL,
       claimed_at = now(),
       last_error = NULL,
       generated_at = NULL,
       published_at = NULL,
       updated_at = now()
     RETURNING *`,
    [
      window.weekKey,
      window.periodStart,
      window.periodEnd,
      currentSourceHash,
      WEEKLY_PROVIDER,
      process.env.WEEKLY_SPEECH_MODEL ?? DEFAULT_WEEKLY_SPEECH_MODEL,
    ]
  );

  try {
    await savePreparedEpisode(episode.id, articles, script, currentSourceHash);
  } catch (error) {
    await markPrepareFailed(episode.id, error);
    throw error;
  }
  return (await getWeeklyProducerJob(episode.id))!;
}

export async function prepareWeeklyEpisode(
  deps: WeeklyPrepareDeps = {}
): Promise<WeeklyProducerJob> {
  const preparation = await prepareWeeklySources(deps);
  if (preparation.existingJob) return preparation.existingJob;
  const script = await generateWeeklyScript(
    preparation,
    deps.generateStructured ?? structured
  );
  return saveWeeklyScript({
    weekKey: preparation.window.weekKey,
    sourceHash: preparation.sourceHash,
    script,
  });
}

export async function claimWeeklyEpisode(episodeId: string): Promise<WeeklyProducerJob | null> {
  const rows = await query<WeeklyEpisode>(
    `UPDATE weekly_episodes
     SET status = CASE WHEN status = 'ready' THEN status ELSE 'generating' END,
         attempt_count = CASE WHEN status = 'ready' THEN attempt_count ELSE attempt_count + 1 END,
         claimed_at = CASE WHEN status = 'ready' THEN claimed_at ELSE now() END,
         last_error = CASE WHEN status = 'ready' THEN last_error ELSE NULL END,
         updated_at = now()
     WHERE id = $1
       AND status IN ('scripted', 'generating', 'failed', 'ready')
       AND script IS NOT NULL
       AND script_hash IS NOT NULL
     RETURNING *`,
    [episodeId]
  );
  return rows.length > 0 ? getWeeklyProducerJob(episodeId) : null;
}

export async function markWeeklySegmentStarted(
  episodeId: string,
  position: number,
  sourceHash: string
): Promise<boolean> {
  const rows = await query(
    `UPDATE weekly_episode_segments
     SET status = 'processing',
         attempt_count = attempt_count + 1,
         last_error = NULL,
         updated_at = now()
     WHERE episode_id = $1
       AND position = $2
       AND source_hash = $3
       AND status <> 'ready'
     RETURNING episode_id`,
    [episodeId, position, sourceHash]
  );
  return rows.length > 0;
}

export async function markWeeklySegmentReady(input: {
  episodeId: string;
  position: number;
  sourceHash: string;
  blobUrl: string;
  byteLength: number;
  mediaType: string;
  durationSeconds: number;
}): Promise<boolean> {
  const rows = await query(
    `UPDATE weekly_episode_segments
     SET status = 'ready',
         blob_url = $1,
         byte_length = $2,
         media_type = $3,
         duration_seconds = $4,
         generated_at = now(),
         last_error = NULL,
         updated_at = now()
     WHERE episode_id = $5
       AND position = $6
       AND source_hash = $7
       AND status IN ('pending', 'processing', 'failed', 'ready')
     RETURNING episode_id`,
    [
      input.blobUrl,
      input.byteLength,
      input.mediaType,
      input.durationSeconds,
      input.episodeId,
      input.position,
      input.sourceHash,
    ]
  );
  return rows.length > 0;
}

export async function markWeeklySegmentFailed(
  episodeId: string,
  position: number,
  sourceHash: string,
  error: unknown
): Promise<void> {
  await query(
    `UPDATE weekly_episode_segments
     SET status = 'failed',
         last_error = $1,
         updated_at = now()
     WHERE episode_id = $2 AND position = $3 AND source_hash = $4`,
    [errorMessage(error), episodeId, position, sourceHash]
  );
}

export async function failWeeklyEpisode(episodeId: string, error: unknown): Promise<void> {
  await query(
    `UPDATE weekly_episodes
     SET status = 'failed',
         claimed_at = NULL,
         last_error = $1,
         updated_at = now()
     WHERE id = $2 AND status <> 'ready'`,
    [errorMessage(error), episodeId]
  );
}

export async function completeWeeklyEpisode(input: {
  episodeId: string;
  scriptHash: string;
  hostVoice: string;
  analystVoice: string;
  blobUrl: string;
  byteLength: number;
  mediaType: string;
  durationSeconds: number;
}): Promise<boolean> {
  const rows = await query(
    `UPDATE weekly_episodes
     SET status = 'ready',
         host_voice = $1,
         analyst_voice = $2,
         blob_url = $3,
         byte_length = $4,
         media_type = $5,
         duration_seconds = $6,
         claimed_at = NULL,
         last_error = NULL,
         generated_at = now(),
         published_at = COALESCE(published_at, now()),
         updated_at = now()
     WHERE id = $7
       AND status = 'generating'
       AND script_hash = $8
       AND EXISTS (
         SELECT 1 FROM weekly_episode_segments
         WHERE episode_id = $7
       )
       AND NOT EXISTS (
         SELECT 1 FROM weekly_episode_segments
         WHERE episode_id = $7 AND status <> 'ready'
       )
     RETURNING id`,
    [
      input.hostVoice,
      input.analystVoice,
      input.blobUrl,
      input.byteLength,
      input.mediaType,
      input.durationSeconds,
      input.episodeId,
      input.scriptHash,
    ]
  );
  return rows.length > 0;
}

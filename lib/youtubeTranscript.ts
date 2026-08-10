import { complete } from './llm';
import { loadPrompt } from './prompts';

const SUPADATA_BASE_URL = 'https://api.supadata.ai/v1';
const REQUEST_TIMEOUT_MS = 30_000;
const GENERATED_REQUEST_TIMEOUT_MS = 150_000;
const DIRECT_TRANSCRIPT_LENGTH = 28_000;
const TRANSCRIPT_CHUNK_LENGTH = 14_000;
const MAX_CHUNK_SUMMARY_LENGTH = 3_500;
export const MAX_VIDEO_TRANSCRIPT_LENGTH = 300_000;

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
  lang: string | null;
}

export interface ReadyTranscript {
  kind: 'ready';
  segments: TranscriptSegment[];
  language: string | null;
  method: 'youtube-captions' | 'youtube-asr';
}

export interface PendingTranscript {
  kind: 'pending';
  jobId: string;
  method: 'youtube-asr';
}

export interface UnavailableTranscript {
  kind: 'unavailable';
  reason: string;
}

export type YouTubeTranscriptResult = ReadyTranscript | PendingTranscript | UnavailableTranscript;

export interface YouTubeTranscriptRequest {
  url: string;
  jobId?: string | null;
}

export type YouTubeTranscriptFetcher = (
  request: YouTubeTranscriptRequest
) => Promise<YouTubeTranscriptResult>;

interface SupadataContent {
  text?: unknown;
  offset?: unknown;
  duration?: unknown;
  lang?: unknown;
}

function apiKey(): string {
  const value = process.env.SUPADATA_API_KEY?.trim();
  if (!value) throw new Error('SUPADATA_API_KEY is not configured');
  return value;
}

function generatedFallbackEnabled(): boolean {
  return (process.env.YOUTUBE_TRANSCRIPT_MODE ?? 'auto').toLowerCase() !== 'native';
}

async function supadataRequest(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  return fetch(`${SUPADATA_BASE_URL}${path}`, {
    headers: { 'x-api-key': apiKey() },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  const nested = typeof body.error === 'object' && body.error !== null
    ? body.error as Record<string, unknown>
    : null;
  const value = body.message
    ?? (typeof body.error === 'string' ? body.error : nested?.message);
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function parseSegments(body: Record<string, unknown>): TranscriptSegment[] {
  const content = body.content;
  if (typeof content === 'string') {
    return content.trim()
      ? [{ text: content.trim(), offset: 0, duration: 0, lang: typeof body.lang === 'string' ? body.lang : null }]
      : [];
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): TranscriptSegment[] => {
    if (typeof item !== 'object' || item === null) return [];
    const segment = item as SupadataContent;
    if (typeof segment.text !== 'string' || !segment.text.trim()) return [];
    return [{
      text: segment.text.trim(),
      offset: typeof segment.offset === 'number' && Number.isFinite(segment.offset) ? segment.offset : 0,
      duration: typeof segment.duration === 'number' && Number.isFinite(segment.duration) ? segment.duration : 0,
      lang: typeof segment.lang === 'string' ? segment.lang : null,
    }];
  });
}

function readyResult(
  body: Record<string, unknown>,
  method: ReadyTranscript['method']
): ReadyTranscript | UnavailableTranscript {
  const segments = parseSegments(body);
  if (segments.length === 0) {
    return { kind: 'unavailable', reason: 'the video transcript contains no speech' };
  }
  return {
    kind: 'ready',
    segments,
    language: typeof body.lang === 'string' ? body.lang : segments[0]?.lang ?? null,
    method,
  };
}

async function requestTranscript(
  url: string,
  mode: 'native' | 'generate'
): Promise<YouTubeTranscriptResult> {
  const params = new URLSearchParams({ url, mode, text: 'false' });
  const response = await supadataRequest(
    `/transcript?${params.toString()}`,
    mode === 'generate' ? GENERATED_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  );
  const body = await responseJson(response);

  if (response.status === 202) {
    const jobId = body.jobId;
    if (typeof jobId !== 'string' || !jobId) {
      throw new Error('transcript provider returned a pending response without a job ID');
    }
    return { kind: 'pending', jobId, method: 'youtube-asr' };
  }
  if (response.status === 206) {
    return {
      kind: 'unavailable',
      reason: errorMessage(body, 'no public transcript is available for this video'),
    };
  }
  if (!response.ok) {
    throw new Error(`transcript provider failed (${response.status}): ${errorMessage(body, response.statusText)}`);
  }
  return readyResult(body, mode === 'native' ? 'youtube-captions' : 'youtube-asr');
}

async function pollTranscript(jobId: string): Promise<YouTubeTranscriptResult> {
  const response = await supadataRequest(`/transcript/${encodeURIComponent(jobId)}`);
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(`transcript job lookup failed (${response.status}): ${errorMessage(body, response.statusText)}`);
  }
  const status = body.status;
  if (status === 'queued' || status === 'active') {
    return { kind: 'pending', jobId, method: 'youtube-asr' };
  }
  if (status === 'failed') {
    return { kind: 'unavailable', reason: errorMessage(body, 'speech-to-text generation failed') };
  }
  if (status !== 'completed') {
    throw new Error(`transcript provider returned unknown job status: ${String(status)}`);
  }
  const result = typeof body.result === 'object' && body.result !== null
    ? body.result as Record<string, unknown>
    : body;
  return readyResult(result, 'youtube-asr');
}

export const fetchYouTubeTranscript: YouTubeTranscriptFetcher = async ({ url, jobId }) => {
  if (jobId) return pollTranscript(jobId);

  const native = await requestTranscript(url, 'native');
  if (native.kind !== 'unavailable' || !generatedFallbackEnabled()) return native;
  return requestTranscript(url, 'generate');
};

function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => `[${formatTimestamp(segment.offset)}] ${segment.text}`)
    .join('\n')
    .trim();
}

function chunkTranscript(transcript: string): string[] {
  const lines = transcript.split('\n');
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > TRANSCRIPT_CHUNK_LENGTH) {
      chunks.push(current);
      current = '';
    }
    if (line.length > TRANSCRIPT_CHUNK_LENGTH) {
      if (current) chunks.push(current);
      for (let offset = 0; offset < line.length; offset += TRANSCRIPT_CHUNK_LENGTH) {
        chunks.push(line.slice(offset, offset + TRANSCRIPT_CHUNK_LENGTH));
      }
      continue;
    }
    current += `${current ? '\n' : ''}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

export type TranscriptSummarizer = (system: string, user: string) => Promise<string>;

export async function prepareTranscriptForPipeline(
  transcript: string,
  summarize: TranscriptSummarizer = complete
): Promise<{ content: string; summarized: boolean; chunkCount: number }> {
  if (transcript.length <= DIRECT_TRANSCRIPT_LENGTH) {
    return {
      content: `Video transcript (timestamps mark the approximate start of each caption):\n\n${transcript}`,
      summarized: false,
      chunkCount: 1,
    };
  }

  const chunks = chunkTranscript(transcript);
  const system = loadPrompt('youtube-analysis-system');
  const notes: string[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const summary = await summarize(
      system,
      loadPrompt('youtube-analysis-user', {
        position: String(index + 1),
        total: String(chunks.length),
        transcript: chunks[index],
      })
    );
    notes.push(`Transcript section ${index + 1} of ${chunks.length}:\n${summary.trim().slice(0, MAX_CHUNK_SUMMARY_LENGTH)}`);
  }
  return {
    content: `Evidence notes produced from every section of a long, timestamped video transcript. Attribute statements to the speaker or presenter when appropriate.\n\n${notes.join('\n\n')}`,
    summarized: true,
    chunkCount: chunks.length,
  };
}

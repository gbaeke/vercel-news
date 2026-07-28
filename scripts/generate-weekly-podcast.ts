import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
import { put } from '@vercel/blob';
import type {
  WeeklyDialogueTurn,
  WeeklyEpisodeSegment,
} from '../lib/types';
import type { WeeklyProducerJob } from '../lib/weeklyPodcast';

dotenv.config({ path: '.env.local' });

const execFile = promisify(execFileCallback);
const ELEVENLABS_DIALOGUE_URL =
  'https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128';

export interface ProducerConfig {
  appUrl: string;
  cronSecret: string;
  elevenLabsApiKey: string;
  blobToken: string;
  hostVoice: string;
  analystVoice: string;
  speechModel: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function configFromEnv(): ProducerConfig {
  return {
    appUrl: requiredEnv('APP_URL').replace(/\/+$/, ''),
    cronSecret: requiredEnv('CRON_SECRET'),
    elevenLabsApiKey: requiredEnv('ELEVENLABS_API_KEY'),
    blobToken: requiredEnv('BLOB_READ_WRITE_TOKEN'),
    hostVoice: requiredEnv('WEEKLY_HOST_VOICE_ID'),
    analystVoice: requiredEnv('WEEKLY_ANALYST_VOICE_ID'),
    speechModel: process.env.WEEKLY_SPEECH_MODEL?.trim() || 'eleven_v3',
  };
}

async function weeklyApi<T>(
  config: ProducerConfig,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${config.appUrl}/api/weekly`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cronSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Weekly API returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

function dialogueInput(
  turn: WeeklyDialogueTurn,
  config: ProducerConfig
): { text: string; voice_id: string } {
  const direction = turn.delivery ? `[${turn.delivery}] ` : '';
  return {
    text: `${direction}${turn.text}`,
    voice_id: turn.speaker === 'host' ? config.hostVoice : config.analystVoice,
  };
}

export async function generateDialogueSegment(
  turns: WeeklyDialogueTurn[],
  config: ProducerConfig,
  fetchFn: typeof fetch = fetch
): Promise<Buffer> {
  const inputs = turns.map((turn) => dialogueInput(turn, config));
  const characterCount = inputs.reduce((total, item) => total + item.text.length, 0);
  if (characterCount > 2_000) {
    throw new Error(`Dialogue segment contains ${characterCount} characters; provider limit is 2,000.`);
  }
  const response = await fetchFn(ELEVENLABS_DIALOGUE_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': config.elevenLabsApiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      model_id: config.speechModel,
      inputs,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ElevenLabs returned ${response.status}: ${detail.slice(0, 500)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('ElevenLabs returned an empty audio file.');
  return bytes;
}

async function audioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine audio duration for ${path.basename(filePath)}.`);
  }
  return duration;
}

async function downloadReadySegment(segment: WeeklyEpisodeSegment, filePath: string): Promise<void> {
  if (!segment.blob_url) throw new Error(`Ready segment ${segment.position} has no Blob URL.`);
  const response = await fetch(segment.blob_url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Could not download segment ${segment.position}: HTTP ${response.status}`);
  }
  await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
}

async function uploadAudio(
  pathname: string,
  bytes: Buffer,
  token: string
): Promise<string> {
  const blob = await put(pathname, bytes, {
    access: 'public',
    token,
    contentType: 'audio/mpeg',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31_536_000,
  });
  return blob.url;
}

async function renderSegment(
  job: WeeklyProducerJob,
  segment: WeeklyEpisodeSegment,
  filePath: string,
  config: ProducerConfig
): Promise<void> {
  const episodeId = job.episode.id;
  await weeklyApi(config, {
    action: 'segment_started',
    episodeId,
    position: segment.position,
    sourceHash: segment.source_hash,
  });
  try {
    const bytes = await generateDialogueSegment(segment.turns, config);
    await fs.writeFile(filePath, bytes);
    const duration = await audioDuration(filePath);
    const blobUrl = await uploadAudio(
      `weekly/${job.episode.week_key}/v${job.episode.script_version}/segments/` +
      `${String(segment.position).padStart(3, '0')}-${segment.source_hash.slice(0, 12)}.mp3`,
      bytes,
      config.blobToken
    );
    await weeklyApi(config, {
      action: 'segment_ready',
      episodeId,
      position: segment.position,
      sourceHash: segment.source_hash,
      blobUrl,
      byteLength: bytes.length,
      mediaType: 'audio/mpeg',
      durationSeconds: duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await weeklyApi(config, {
      action: 'segment_failed',
      episodeId,
      position: segment.position,
      sourceHash: segment.source_hash,
      error: message,
    }).catch(() => undefined);
    throw error;
  }
}

async function assembleEpisode(segmentPaths: string[], outputPath: string): Promise<void> {
  const listPath = path.join(path.dirname(outputPath), 'segments.txt');
  const lines = segmentPaths.map((segmentPath) =>
    `file '${segmentPath.replace(/'/g, "'\\''")}'`
  );
  await fs.writeFile(listPath, `${lines.join('\n')}\n`, 'utf8');
  await execFile('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ac', '1',
    '-ar', '44100',
    '-codec:a', 'libmp3lame',
    '-b:a', '96k',
    outputPath,
  ], { maxBuffer: 10 * 1024 * 1024 });
}

async function main(): Promise<void> {
  const config = configFromEnv();
  let episodeId: string | undefined;
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-wire-weekly-'));
  try {
    const job = await weeklyApi<WeeklyProducerJob>(config, {
      action: 'prepare',
      weekKey: process.env.WEEKLY_WEEK_KEY?.trim() || undefined,
    });
    episodeId = job.episode.id;
    if (job.episode.status === 'ready') {
      console.log(`[weekly] ${job.episode.week_key} is already ready; nothing to do`);
      return;
    }
    if (!job.episode.script_hash || job.segments.length === 0) {
      throw new Error('Prepared weekly episode has no renderable dialogue segments.');
    }

    const segmentPaths: string[] = [];
    for (const segment of job.segments) {
      const filePath = path.join(
        temporaryDirectory,
        `segment-${String(segment.position).padStart(3, '0')}.mp3`
      );
      if (segment.status === 'ready') {
        console.log(`[weekly] reusing segment ${segment.position + 1}/${job.segments.length}`);
        await downloadReadySegment(segment, filePath);
      } else {
        console.log(`[weekly] generating segment ${segment.position + 1}/${job.segments.length}`);
        await renderSegment(job, segment, filePath, config);
      }
      segmentPaths.push(filePath);
    }

    const outputPath = path.join(temporaryDirectory, `${job.episode.week_key}.mp3`);
    await assembleEpisode(segmentPaths, outputPath);
    const [finalBytes, duration] = await Promise.all([
      fs.readFile(outputPath),
      audioDuration(outputPath),
    ]);
    const blobUrl = await uploadAudio(
      `weekly/${job.episode.week_key}/v${job.episode.script_version}-` +
      `${job.episode.script_hash.slice(0, 12)}.mp3`,
      finalBytes,
      config.blobToken
    );
    await weeklyApi(config, {
      action: 'complete',
      episodeId,
      scriptHash: job.episode.script_hash,
      hostVoice: config.hostVoice,
      analystVoice: config.analystVoice,
      blobUrl,
      byteLength: finalBytes.length,
      mediaType: 'audio/mpeg',
      durationSeconds: duration,
    });
    console.log(
      `[weekly] published ${job.episode.week_key}: ${duration.toFixed(1)}s, ` +
      `${finalBytes.length} bytes`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (episodeId) {
      await weeklyApi(config, { action: 'fail', episodeId, error: message }).catch(() => undefined);
    }
    throw error;
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[weekly] generation failed', error);
    process.exit(1);
  });
}

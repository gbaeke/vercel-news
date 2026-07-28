export const runtime = 'nodejs';
export const maxDuration = 300;

import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth';
import {
  claimWeeklyEpisode,
  completeWeeklyEpisode,
  failWeeklyEpisode,
  markWeeklySegmentFailed,
  markWeeklySegmentReady,
  markWeeklySegmentStarted,
  prepareWeeklySources,
  saveWeeklyScript,
} from '../../../lib/weeklyPodcast';
import type { WeeklyDialogueTurn } from '../../../lib/types';

type JsonObject = Record<string, unknown>;

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function positiveNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  const number = positiveNumber(value, name);
  if (!Number.isInteger(number)) throw new Error(`${name} must be an integer`);
  return number;
}

function publicHttpUrl(value: unknown, name: string): string {
  const raw = nonEmptyString(value, name);
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be an HTTP URL`);
  }
  return url.toString();
}

function weeklyScript(value: unknown): {
  title: string;
  summary: string;
  turns: WeeklyDialogueTurn[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('script must be a JSON object');
  }
  const object = value as JsonObject;
  if (!Array.isArray(object.turns)) throw new Error('script.turns must be an array');
  const turns: WeeklyDialogueTurn[] = object.turns.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`script.turns[${index}] must be a JSON object`);
    }
    const turn = value as JsonObject;
    const speaker = nonEmptyString(turn.speaker, `script.turns[${index}].speaker`);
    if (speaker !== 'host' && speaker !== 'analyst') {
      throw new Error(`script.turns[${index}].speaker must be host or analyst`);
    }
    return {
      speaker: speaker as WeeklyDialogueTurn['speaker'],
      text: nonEmptyString(turn.text, `script.turns[${index}].text`),
      delivery: nonEmptyString(turn.delivery, `script.turns[${index}].delivery`),
    };
  });
  return {
    title: nonEmptyString(object.title, 'script.title'),
    summary: nonEmptyString(object.summary, 'script.summary'),
    turns,
  };
}

async function requestBody(req: NextRequest): Promise<JsonObject> {
  const value = await req.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be a JSON object');
  }
  return value as JsonObject;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: JsonObject;
  try {
    body = await requestBody(req);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'invalid JSON body' },
      { status: 400 }
    );
  }

  try {
    const action = nonEmptyString(body.action, 'action');
    if (action === 'source') {
      const weekKey = body.weekKey === undefined || body.weekKey === ''
        ? undefined
        : nonEmptyString(body.weekKey, 'weekKey');
      const preparation = await prepareWeeklySources({ weekKey });
      if (!preparation.existingJob) {
        return NextResponse.json({ preparation, job: null });
      }
      if (preparation.existingJob.episode.status === 'ready') {
        return NextResponse.json({ preparation: null, job: preparation.existingJob });
      }
      const claimed = await claimWeeklyEpisode(preparation.existingJob.episode.id);
      if (!claimed) {
        return NextResponse.json({ error: 'weekly episode could not be claimed' }, { status: 409 });
      }
      return NextResponse.json({ preparation: null, job: claimed });
    }
    if (action === 'script_ready') {
      const prepared = await saveWeeklyScript({
        weekKey: nonEmptyString(body.weekKey, 'weekKey'),
        sourceHash: nonEmptyString(body.sourceHash, 'sourceHash'),
        script: weeklyScript(body.script),
      });
      if (prepared.episode.status === 'ready') {
        return NextResponse.json(prepared);
      }
      const claimed = await claimWeeklyEpisode(prepared.episode.id);
      if (!claimed) {
        return NextResponse.json({ error: 'weekly episode could not be claimed' }, { status: 409 });
      }
      return NextResponse.json(claimed);
    }

    const episodeId = nonEmptyString(body.episodeId, 'episodeId');
    if (action === 'segment_started') {
      const changed = await markWeeklySegmentStarted(
        episodeId,
        nonNegativeInteger(body.position, 'position'),
        nonEmptyString(body.sourceHash, 'sourceHash')
      );
      return NextResponse.json({ ok: changed }, { status: changed ? 200 : 409 });
    }
    if (action === 'segment_ready') {
      const changed = await markWeeklySegmentReady({
        episodeId,
        position: nonNegativeInteger(body.position, 'position'),
        sourceHash: nonEmptyString(body.sourceHash, 'sourceHash'),
        blobUrl: publicHttpUrl(body.blobUrl, 'blobUrl'),
        byteLength: positiveInteger(body.byteLength, 'byteLength'),
        mediaType: nonEmptyString(body.mediaType, 'mediaType'),
        durationSeconds: positiveNumber(body.durationSeconds, 'durationSeconds'),
      });
      return NextResponse.json({ ok: changed }, { status: changed ? 200 : 409 });
    }
    if (action === 'segment_failed') {
      await markWeeklySegmentFailed(
        episodeId,
        nonNegativeInteger(body.position, 'position'),
        nonEmptyString(body.sourceHash, 'sourceHash'),
        nonEmptyString(body.error, 'error')
      );
      return NextResponse.json({ ok: true });
    }
    if (action === 'complete') {
      const changed = await completeWeeklyEpisode({
        episodeId,
        scriptHash: nonEmptyString(body.scriptHash, 'scriptHash'),
        hostVoice: nonEmptyString(body.hostVoice, 'hostVoice'),
        analystVoice: nonEmptyString(body.analystVoice, 'analystVoice'),
        blobUrl: publicHttpUrl(body.blobUrl, 'blobUrl'),
        byteLength: positiveInteger(body.byteLength, 'byteLength'),
        mediaType: nonEmptyString(body.mediaType, 'mediaType'),
        durationSeconds: positiveNumber(body.durationSeconds, 'durationSeconds'),
      });
      if (changed) revalidatePath('/podcast.xml');
      return NextResponse.json({ ok: changed }, { status: changed ? 200 : 409 });
    }
    if (action === 'fail') {
      await failWeeklyEpisode(episodeId, nonEmptyString(body.error, 'error'));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[weekly] request failed', error);
    const status = message.startsWith('No published articles were found') ? 422 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

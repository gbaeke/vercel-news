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
  prepareWeeklyEpisode,
} from '../../../lib/weeklyPodcast';

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
    if (action === 'prepare') {
      const weekKey = body.weekKey === undefined || body.weekKey === ''
        ? undefined
        : nonEmptyString(body.weekKey, 'weekKey');
      const prepared = await prepareWeeklyEpisode({ weekKey });
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

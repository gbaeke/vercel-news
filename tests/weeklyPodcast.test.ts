import { describe, expect, it, vi } from 'vitest';
import { query } from '../lib/db';
import { getPodcastEpisodes } from '../lib/podcast';
import {
  claimWeeklyEpisode,
  completeWeeklyEpisode,
  dialogueTurnCharacters,
  markWeeklySegmentReady,
  markWeeklySegmentStarted,
  prepareWeeklyEpisode,
  previousWeeklyWindow,
  splitDialogueTurns,
  weeklyWindowForKey,
} from '../lib/weeklyPodcast';
import type { WeeklyDialogueTurn, WeeklyEpisode } from '../lib/types';

const turns: WeeklyDialogueTurn[] = [
  { speaker: 'host', delivery: 'warm', text: 'Welcome to the weekly review.' },
  { speaker: 'analyst', delivery: 'thoughtful', text: 'Three connected stories stood out.' },
  { speaker: 'host', delivery: 'curious', text: 'Start with the model release. What changed?' },
  { speaker: 'analyst', delivery: 'matter-of-fact', text: 'The published article explains the practical change.' },
  { speaker: 'host', delivery: 'skeptical', text: 'Does that alter what teams should do next?' },
  { speaker: 'analyst', delivery: 'warm', text: 'Watch the evidence next week. These voices are AI-generated.' },
];

async function insertWeeklyArticle(publishedAt: string) {
  await query(
    `INSERT INTO articles (
       source_feed, trigger_url, trigger_title, trigger_content, title,
       content_md, content_html, summary, slug, status, version, published_at
     ) VALUES (
       'openai', 'https://source.example/weekly-one', 'Weekly source', 'Source body',
       'A meaningful model release', 'The release improves tool use for developers.',
       '<p>The release improves tool use for developers.</p>', 'A concise source summary.',
       'meaningful-model-release', 'published', 2, $1
     )`,
    [publishedAt]
  );
}

describe('weekly podcast preparation', () => {
  it('calculates the previous Brussels week across summer time', () => {
    expect(previousWeeklyWindow(new Date('2026-07-28T12:00:00Z'))).toEqual({
      weekKey: '2026-W30',
      periodStart: '2026-07-19T22:00:00.000Z',
      periodEnd: '2026-07-26T22:00:00.000Z',
    });
    expect(weeklyWindowForKey('2026-W30')).toEqual({
      weekKey: '2026-W30',
      periodStart: '2026-07-19T22:00:00.000Z',
      periodEnd: '2026-07-26T22:00:00.000Z',
    });
    expect(() => weeklyWindowForKey('2026-W54')).toThrow('invalid ISO week');
  });

  it('splits dialogue below the provider request limit without losing turns', () => {
    const expanded = turns.map((turn) => ({ ...turn, text: turn.text.repeat(8) }));
    const segments = splitDialogueTurns(expanded, 500);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.flat()).toEqual(expanded);
    expect(
      segments.every((segment) =>
        segment.reduce((total, turn) => total + dialogueTurnCharacters(turn), 0) <= 500
      )
    ).toBe(true);
  });

  it('prepares, checkpoints, and completes a resumable weekly episode', async () => {
    process.env.APP_URL = 'https://wire.example';
    await insertWeeklyArticle('2026-07-23T10:00:00.000Z');
    const generate = vi.fn(async () => ({
      title: 'Weekly Review: A model release',
      summary: 'What changed and why it matters.',
      turns,
    }));

    const prepared = await prepareWeeklyEpisode({
      now: new Date('2026-07-28T12:00:00Z'),
      generateStructured: generate as any,
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(prepared.episode.status).toBe('scripted');
    expect(prepared.episode.week_key).toBe('2026-W30');
    expect(prepared.sources).toHaveLength(1);
    expect(prepared.sources[0].url).toBe(
      'https://wire.example/articles/meaningful-model-release'
    );
    expect(prepared.segments.length).toBeGreaterThan(0);

    const again = await prepareWeeklyEpisode({
      now: new Date('2026-07-28T12:00:00Z'),
      generateStructured: generate as any,
    });
    expect(again.episode.id).toBe(prepared.episode.id);
    expect(generate).toHaveBeenCalledTimes(2);

    const claimed = await claimWeeklyEpisode(prepared.episode.id);
    expect(claimed?.episode.status).toBe('generating');
    const segment = claimed!.segments[0];
    expect(await markWeeklySegmentStarted(
      claimed!.episode.id,
      segment.position,
      segment.source_hash
    )).toBe(true);
    expect(await markWeeklySegmentReady({
      episodeId: claimed!.episode.id,
      position: segment.position,
      sourceHash: segment.source_hash,
      blobUrl: 'https://blob.example/segment.mp3',
      byteLength: 1234,
      mediaType: 'audio/mpeg',
      durationSeconds: 40,
    })).toBe(true);
    expect(await completeWeeklyEpisode({
      episodeId: claimed!.episode.id,
      scriptHash: claimed!.episode.script_hash!,
      hostVoice: 'host_voice',
      analystVoice: 'analyst_voice',
      blobUrl: 'https://blob.example/weekly.mp3',
      byteLength: 5678,
      mediaType: 'audio/mpeg',
      durationSeconds: 720,
    })).toBe(true);

    const [ready] = await query<WeeklyEpisode>(
      `SELECT * FROM weekly_episodes WHERE id = $1`,
      [claimed!.episode.id]
    );
    expect(ready.status).toBe('ready');
    expect(ready.published_at).not.toBeNull();

    const feedEpisodes = await getPodcastEpisodes();
    expect(feedEpisodes).toHaveLength(1);
    expect(feedEpisodes[0]).toMatchObject({
      kind: 'weekly',
      week_key: '2026-W30',
      title: 'Weekly Review: A model release',
    });
  });

  it('does not create an empty weekly episode', async () => {
    await expect(prepareWeeklyEpisode({
      now: new Date('2026-07-28T12:00:00Z'),
      generateStructured: vi.fn() as any,
    })).rejects.toThrow('No published articles were found for 2026-W30');
    const rows = await query(`SELECT id FROM weekly_episodes`);
    expect(rows).toHaveLength(0);
  });
});

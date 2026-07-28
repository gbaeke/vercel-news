import { describe, expect, it } from 'vitest';
import { buildPodcastFeed, type PodcastEpisode } from '../lib/podcast';

describe('podcast RSS', () => {
  it('builds a standards-oriented feed with escaped metadata and a stable versioned GUID', () => {
    const episode: PodcastEpisode = {
      kind: 'article',
      id: '7',
      version: 2,
      source_hash: 'abcdef1234567890',
      title: 'Models & <tools>',
      summary: 'What "changed" & why',
      slug: 'models-tools',
      week_key: null,
      show_notes: null,
      published_at: '2026-07-27T10:00:00.000Z',
      blob_url: 'https://x.public.blob.vercel-storage.com/audio/7/v2.mp3?x=1&y=2',
      byte_length: '4567',
      media_type: 'audio/mpeg',
      duration_seconds: null,
    };

    const xml = buildPodcastFeed('https://wire.example/', [episode]);
    expect(xml).toContain('<title>The AI Wire Audio</title>');
    expect(xml).toContain('xmlns:itunes=');
    expect(xml).toContain('<itunes:category text="Technology" />');
    expect(xml).toContain('https://wire.example/podcast-artwork.png');
    expect(xml).toContain('urn:the-ai-wire:article:7:v2:abcdef123456');
    expect(xml).toContain('Models &amp; &lt;tools&gt;');
    expect(xml).toContain('x=1&amp;y=2');
    expect(xml).toContain('length="4567" type="audio/mpeg"');
    expect(xml).toContain('narrated by an AI-generated voice');
  });

  it('adds weekly reviews without changing short-form episodes', () => {
    const weekly: PodcastEpisode = {
      kind: 'weekly',
      id: '11',
      version: 1,
      source_hash: '1234567890abcdef',
      title: 'Weekly Review: Models meet agents',
      summary: 'The consequential AI stories of the week.',
      slug: null,
      week_key: '2026-W30',
      show_notes: 'Sources:\n- A story — https://wire.example/articles/a-story',
      published_at: '2026-07-27T08:00:00.000Z',
      blob_url: 'https://x.public.blob.vercel-storage.com/weekly/2026-W30.mp3',
      byte_length: '9999',
      media_type: 'audio/mpeg',
      duration_seconds: '725.4',
    };

    const xml = buildPodcastFeed('https://wire.example', [weekly]);
    expect(xml).toContain('urn:the-ai-wire:weekly:2026-W30:v1:1234567890ab');
    expect(xml).toContain('<itunes:duration>725</itunes:duration>');
    expect(xml).toContain('The two voices in this episode are AI-generated.');
    expect(xml).toContain('https://wire.example/articles/a-story');
    expect(xml).toContain('<link>https://wire.example/</link>');
  });

  it('returns a valid empty channel before the first episode is ready', () => {
    const xml = buildPodcastFeed('https://wire.example', []);
    expect(xml).toContain('<channel>');
    expect(xml).toContain('</channel>');
    expect(xml).not.toContain('<item>');
  });
});

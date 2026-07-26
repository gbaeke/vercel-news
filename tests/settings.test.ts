import { describe, it, expect } from 'vitest';
import {
  getTagConfigs,
  getTags,
  addTag,
  deleteTag,
  normalizeTagName,
  updateTagPersona,
} from '../lib/tags';
import { getFeeds, addFeed, deleteFeed, normalizeFeedName } from '../lib/feeds';
import { query } from '../lib/db';

describe('tags CRUD', () => {
  it('lists the seeded tags sorted by name', async () => {
    const tags = await getTags();
    expect(tags).toEqual(['industry', 'models', 'policy', 'product', 'research', 'tooling']);
  });

  it('adds a tag and is idempotent on duplicates', async () => {
    expect(await addTag('agents', 'research-explainer')).toBe(true);
    expect(await addTag('agents', 'research-explainer')).toBe(false);
    const tags = await getTags();
    expect(tags.filter((t) => t === 'agents')).toEqual(['agents']);
    expect((await getTagConfigs()).find((tag) => tag.name === 'agents')).toEqual({
      name: 'agents',
      personaId: 'research-explainer',
    });
  });

  it('updates the persona assigned to an existing tag', async () => {
    expect(await updateTagPersona('models', 'policy-watcher')).toBe(true);
    expect((await getTagConfigs()).find((tag) => tag.name === 'models')?.personaId)
      .toBe('policy-watcher');
    expect(await updateTagPersona('missing', 'policy-watcher')).toBe(false);
  });

  it('rejects persona IDs that are not in the YAML catalogue', async () => {
    await expect(addTag('agents', 'missing-persona')).rejects.toThrow('unknown persona');
    await expect(updateTagPersona('models', 'missing-persona')).rejects.toThrow('unknown persona');
  });

  it('deletes a tag', async () => {
    const result = await deleteTag('policy');
    expect(result.deleted).toBe(true);
    expect(await getTags()).not.toContain('policy');
  });

  it('refuses to delete the last remaining tag', async () => {
    await query(`DELETE FROM tags WHERE name != 'models'`);
    const result = await deleteTag('models');
    expect(result.deleted).toBe(false);
    expect(await getTags()).toEqual(['models']);
  });

  it('reports a tag that is already gone', async () => {
    expect(await deleteTag('missing')).toEqual({ deleted: false, reason: 'not_found' });
  });

  it('normalizes valid names and rejects invalid ones', () => {
    expect(normalizeTagName('  Agents ')).toBe('agents');
    expect(normalizeTagName('foo bar')).toBeNull();
    expect(normalizeTagName('')).toBeNull();
    expect(normalizeTagName('-leading')).toBeNull();
  });
});

describe('feeds CRUD', () => {
  it('lists the seeded feeds', async () => {
    const feeds = await getFeeds();
    expect(feeds.map((f) => f.name)).toEqual(['anthropic', 'openai']);
  });

  it('adds a feed and updates the url on name conflict', async () => {
    expect(await addFeed('hn', 'https://example.com/hn.xml')).toEqual({ ok: true, changed: true });
    expect(await addFeed('hn', 'https://example.com/hn-v2.xml')).toEqual({ ok: true, changed: true });
    const feeds = await getFeeds();
    expect(feeds.find((f) => f.name === 'hn')?.url).toBe('https://example.com/hn-v2.xml');
  });

  it('clears the ingest cursor when an existing feed URL changes', async () => {
    await query(`INSERT INTO feed_state (feed_name, last_url) VALUES ('openai', 'https://old/item')`);
    await addFeed('openai', 'https://example.com/openai-v2.xml');
    expect(await query(`SELECT * FROM feed_state WHERE feed_name = 'openai'`)).toEqual([]);
  });

  it('returns a friendly conflict when another feed already owns the URL', async () => {
    const result = await addFeed('duplicate', 'https://openai.com/news/rss.xml');
    expect(result).toEqual({ ok: false, reason: 'url_conflict', existingName: 'openai' });
  });

  it('deletes a feed together with its ingest cursor', async () => {
    await query(`INSERT INTO feed_state (feed_name, last_url) VALUES ('openai', 'https://x')`);
    expect(await deleteFeed('openai')).toBe(true);
    expect((await getFeeds()).map((f) => f.name)).toEqual(['anthropic']);
    expect(await query(`SELECT * FROM feed_state WHERE feed_name = 'openai'`)).toEqual([]);
  });

  it('reports a feed that is already gone', async () => {
    expect(await deleteFeed('missing')).toBe(false);
  });

  it('normalizes valid names and rejects invalid ones', () => {
    expect(normalizeFeedName(' OpenAI ')).toBe('openai');
    expect(normalizeFeedName('foo/bar')).toBeNull();
  });
});

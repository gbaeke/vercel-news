import { describe, it, expect } from 'vitest';
import { getTags, addTag, deleteTag, normalizeTagName } from '../lib/tags';
import { getFeeds, addFeed, deleteFeed, normalizeFeedName } from '../lib/feeds';
import { query } from '../lib/db';

describe('tags CRUD', () => {
  it('lists the seeded tags sorted by name', async () => {
    const tags = await getTags();
    expect(tags).toEqual(['industry', 'models', 'policy', 'product', 'research', 'tooling']);
  });

  it('adds a tag and is idempotent on duplicates', async () => {
    await addTag('agents');
    await addTag('agents');
    const tags = await getTags();
    expect(tags.filter((t) => t === 'agents')).toEqual(['agents']);
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
    await addFeed('hn', 'https://example.com/hn.xml');
    await addFeed('hn', 'https://example.com/hn-v2.xml');
    const feeds = await getFeeds();
    expect(feeds.find((f) => f.name === 'hn')?.url).toBe('https://example.com/hn-v2.xml');
  });

  it('deletes a feed together with its ingest cursor', async () => {
    await query(`INSERT INTO feed_state (feed_name, last_url) VALUES ('openai', 'https://x')`);
    await deleteFeed('openai');
    expect((await getFeeds()).map((f) => f.name)).toEqual(['anthropic']);
    expect(await query(`SELECT * FROM feed_state WHERE feed_name = 'openai'`)).toEqual([]);
  });

  it('normalizes valid names and rejects invalid ones', () => {
    expect(normalizeFeedName(' OpenAI ')).toBe('openai');
    expect(normalizeFeedName('foo/bar')).toBeNull();
  });
});

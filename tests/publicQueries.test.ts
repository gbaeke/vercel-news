import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import { getPublishedArticles, getPublishedArticleBySlug } from '../lib/publicQueries';

describe('publicQueries', () => {
  it('returns only published articles, newest first', async () => {
    await query(
      `INSERT INTO articles (source_feed, trigger_url, status, slug, published_at)
       VALUES ('openai','https://example.com/1','published','older', now() - interval '1 day'),
              ('openai','https://example.com/2','published','newer', now()),
              ('openai','https://example.com/3','in_review','unpublished', null)`
    );
    const articles = await getPublishedArticles();
    expect(articles.map((a) => a.slug)).toEqual(['newer', 'older']);
  });

  it('fetches one published article by slug, or null if not published', async () => {
    await query(
      `INSERT INTO articles (source_feed, trigger_url, status, slug, published_at)
       VALUES ('openai','https://example.com/4','published','my-slug', now()),
              ('openai','https://example.com/5','declined','declined-slug', null)`
    );
    expect((await getPublishedArticleBySlug('my-slug'))?.slug).toBe('my-slug');
    expect(await getPublishedArticleBySlug('declined-slug')).toBeNull();
  });
});

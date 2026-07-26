import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import {
  getPublishedArticles,
  getPublishedArticleBySlug,
  getPublishedArticlesByEmbedding,
} from '../lib/publicQueries';
import { EMBEDDING_DIMENSIONS, vectorLiteral } from '../lib/embeddings';

function unitVector(dimension: number): number[] {
  return Array.from(
    { length: EMBEDDING_DIMENSIONS },
    (_, index) => (index === dimension ? 1 : 0)
  );
}

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

  it('filters by tags matching primary OR secondary (any of the given tags)', async () => {
    await query(
      `INSERT INTO articles (source_feed, trigger_url, status, slug, tags, published_at)
       VALUES
         ('openai','https://example.com/t1','published','models-primary', '{"primary":"models","secondary":[]}', now()),
         ('openai','https://example.com/t2','published','models-secondary', '{"primary":"product","secondary":["models","tooling"]}', now() - interval '1 hour'),
         ('openai','https://example.com/t3','published','policy-only', '{"primary":"policy","secondary":[]}', now() - interval '2 hours'),
         ('openai','https://example.com/t4','published','untagged', null, now() - interval '3 hours')`
    );

    const models = await getPublishedArticles(['models']);
    expect(models.map((a) => a.slug)).toEqual(['models-primary', 'models-secondary']);

    const multi = await getPublishedArticles(['models', 'policy']);
    expect(multi.map((a) => a.slug)).toEqual(['models-primary', 'models-secondary', 'policy-only']);

    const all = await getPublishedArticles();
    expect(all.length).toBe(4);
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

  it('ranks published articles by vector similarity and current model', async () => {
    await query(
      `INSERT INTO articles
         (source_feed, trigger_url, status, slug, title, embedding, embedding_model, published_at)
       VALUES
         ('openai', 'https://example.com/vector-1', 'published', 'closest', 'Closest',
          $1::vector, 'test/model', now()),
         ('openai', 'https://example.com/vector-2', 'published', 'farther', 'Farther',
          $2::vector, 'test/model', now() - interval '1 hour'),
         ('openai', 'https://example.com/vector-3', 'published', 'other-model', 'Other model',
          $1::vector, 'other/model', now())`,
      [vectorLiteral(unitVector(0)), vectorLiteral(unitVector(1))]
    );

    const results = await getPublishedArticlesByEmbedding(
      unitVector(0),
      'test/model'
    );
    expect(results.map((article) => article.slug)).toEqual(['closest', 'farther']);
  });

  it('combines semantic search with the active tag filter', async () => {
    await query(
      `INSERT INTO articles
         (source_feed, trigger_url, status, slug, tags, embedding, embedding_model, published_at)
       VALUES
         ('openai', 'https://example.com/vector-tag-1', 'published', 'models-vector',
          '{"primary":"models","secondary":[]}', $1::vector, 'test/model', now()),
         ('openai', 'https://example.com/vector-tag-2', 'published', 'policy-vector',
          '{"primary":"policy","secondary":[]}', $1::vector, 'test/model', now())`,
      [vectorLiteral(unitVector(0))]
    );

    const results = await getPublishedArticlesByEmbedding(
      unitVector(0),
      'test/model',
      ['policy']
    );
    expect(results.map((article) => article.slug)).toEqual(['policy-vector']);
  });
});

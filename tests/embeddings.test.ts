import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  articleEmbeddingText,
  createEmbedding,
  createEmbeddings,
  vectorLiteral,
} from '../lib/embeddings';
import { normalizeSearchQuery } from '../lib/search';

describe('embeddings', () => {
  beforeEach(() => {
    process.env.FAKE_LLM = '1';
  });

  it('creates deterministic normalized vectors with the configured dimensions', async () => {
    const first = await createEmbedding('semantic search');
    const second = await createEmbedding('semantic search');

    expect(first).toEqual(second);
    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
  });

  it('embeds batches in input order', async () => {
    const values = await createEmbeddings(['one', 'two']);
    expect(values).toHaveLength(2);
    expect(values[0]).toEqual(await createEmbedding('one'));
    expect(values[1]).toEqual(await createEmbedding('two'));
  });

  it('builds article input from only the title and summary', () => {
    expect(articleEmbeddingText({ title: 'A title', summary: 'A summary' })).toBe(
      'Title: A title\nSummary: A summary'
    );
  });

  it('rejects malformed vectors before they reach Postgres', () => {
    expect(() => vectorLiteral([1, 2, 3])).toThrow(/expected 768/);
  });
});

describe('normalizeSearchQuery', () => {
  it('trims, collapses whitespace, and limits public queries', () => {
    expect(normalizeSearchQuery('  agent   workflows  ')).toBe('agent workflows');
    expect(normalizeSearchQuery('x'.repeat(250))).toHaveLength(200);
    expect(normalizeSearchQuery(undefined)).toBe('');
  });
});

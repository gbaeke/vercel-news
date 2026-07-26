import { embed, embedMany } from 'ai';
import type { Article } from './types';

export const EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

export function embeddingModelId(): string {
  return process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
}

export function articleEmbeddingText(
  article: Pick<Article, 'title' | 'summary'>
): string {
  return [`Title: ${article.title ?? ''}`, `Summary: ${article.summary ?? ''}`].join('\n');
}

function fakeEmbedding(value: string): number[] {
  let seed = 2166136261;
  for (let i = 0; i < value.length; i++) {
    seed ^= value.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }

  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => {
    seed ^= index + 0x9e3779b9;
    seed = Math.imul(seed, 1664525) + 1013904223;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  });
  const magnitude = Math.sqrt(values.reduce((sum, item) => sum + item * item, 0));
  return values.map((item) => item / magnitude);
}

function embeddingProviderOptions() {
  return embeddingModelId().startsWith('openai/')
    ? { openai: { dimensions: EMBEDDING_DIMENSIONS } }
    : undefined;
}

function validateEmbedding(value: number[]): number[] {
  if (
    value.length !== EMBEDDING_DIMENSIONS ||
    value.some((component) => !Number.isFinite(component))
  ) {
    throw new Error(
      `Embedding model ${embeddingModelId()} returned ${value.length} dimensions; expected ${EMBEDDING_DIMENSIONS}`
    );
  }
  return value;
}

export async function createEmbedding(value: string): Promise<number[]> {
  if (process.env.FAKE_LLM === '1') return fakeEmbedding(value);

  const result = await embed({
    model: embeddingModelId(),
    value,
    providerOptions: embeddingProviderOptions(),
  });
  return validateEmbedding(result.embedding);
}

export async function createEmbeddings(values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  if (process.env.FAKE_LLM === '1') return values.map(fakeEmbedding);

  const result = await embedMany({
    model: embeddingModelId(),
    values,
    providerOptions: embeddingProviderOptions(),
  });
  return result.embeddings.map(validateEmbedding);
}

export function vectorLiteral(value: number[]): string {
  return JSON.stringify(validateEmbedding(value));
}

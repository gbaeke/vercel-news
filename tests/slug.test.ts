import { describe, it, expect } from 'vitest';
import { generateSlug } from '../lib/slug';

describe('generateSlug', () => {
  it('slugifies a title', async () => {
    const slug = await generateSlug('Hello, World! New Model', async () => false);
    expect(slug).toBe('hello-world-new-model');
  });

  it('appends a numeric suffix on collision', async () => {
    const taken = new Set(['hello-world']);
    const slug = await generateSlug('Hello World', async (s) => taken.has(s));
    expect(slug).toBe('hello-world-2');
  });
});

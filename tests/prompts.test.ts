import { describe, it, expect } from 'vitest';
import { loadPrompt } from '../lib/prompts';

describe('loadPrompt', () => {
  it('substitutes {{ placeholder }} tokens', () => {
    const text = loadPrompt('tag-user', { content: 'hello world' });
    expect(text).toContain('hello world');
    expect(text).not.toContain('{{ content }}');
  });
});

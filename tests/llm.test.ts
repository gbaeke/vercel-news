import { describe, it, expect, beforeEach } from 'vitest';
import { complete, structured } from '../lib/llm';

describe('llm module (FAKE_LLM=1)', () => {
  beforeEach(() => {
    process.env.FAKE_LLM = '1';
  });

  it('complete() returns deterministic text with no network call', async () => {
    const a = await complete('system prompt', 'user prompt');
    const b = await complete('system prompt', 'user prompt');
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('structured() returns an object matching the schema shape', async () => {
    const schema = {
      type: 'object',
      properties: {
        relevant: { type: 'boolean' },
        primary: { type: 'string' },
        secondary: { type: 'array', items: { type: 'string' } },
      },
      required: ['relevant', 'primary', 'secondary'],
    };
    const result = await structured<{ relevant: boolean; primary: string; secondary: string[] }>(
      'system', 'user', schema
    );
    expect(typeof result.relevant).toBe('boolean');
    expect(typeof result.primary).toBe('string');
    expect(Array.isArray(result.secondary)).toBe(true);
  });
});

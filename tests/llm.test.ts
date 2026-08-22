import { describe, it, expect, beforeEach, vi } from 'vitest';
import { complete, generateImageBytes, structured } from '../lib/llm';

const generateImage = vi.hoisted(() => vi.fn());
const generateText = vi.hoisted(() => vi.fn());

vi.mock('ai', () => ({
  experimental_generateSpeech: vi.fn(),
  generateText,
  generateObject: vi.fn(),
  generateImage,
  jsonSchema: vi.fn((schema) => schema),
}));

describe('llm module (FAKE_LLM=1)', () => {
  beforeEach(() => {
    process.env.FAKE_LLM = '1';
    delete process.env.IMAGE_MODEL;
    generateImage.mockReset();
    generateText.mockReset();
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

  it('falls back when the configured image model has been removed', async () => {
    process.env.FAKE_LLM = '0';
    process.env.IMAGE_MODEL = 'google/imagen-4.0-fast-generate-001';
    generateImage
      .mockRejectedValueOnce(new Error("Model 'google/imagen-4.0-fast-generate-001' not found"))
      .mockResolvedValueOnce({ image: { uint8Array: new Uint8Array([1, 2, 3]) } });

    await expect(generateImageBytes('thumbnail prompt')).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(generateImage).toHaveBeenNthCalledWith(1, {
      model: 'google/imagen-4.0-fast-generate-001',
      prompt: 'thumbnail prompt',
    });
    expect(generateImage).toHaveBeenNthCalledWith(2, {
      model: 'recraft/recraft-v4.1',
      prompt: 'thumbnail prompt',
    });
    expect(generateText).not.toHaveBeenCalled();
  });
});

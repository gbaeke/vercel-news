import { describe, expect, it, vi } from 'vitest';
import {
  generateDialogueSegment,
  type ProducerConfig,
} from '../scripts/generate-weekly-podcast';

const config: ProducerConfig = {
  appUrl: 'https://wire.example',
  cronSecret: 'secret',
  elevenLabsApiKey: 'xi_test',
  blobToken: 'blob_test',
  hostVoice: 'host_voice',
  analystVoice: 'analyst_voice',
  speechModel: 'eleven_v3',
};

describe('weekly ElevenLabs producer', () => {
  it('sends ordered turns with the configured voices and delivery cues', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(Buffer.from('mp3 bytes'), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    );
    const bytes = await generateDialogueSegment([
      { speaker: 'host', delivery: 'curious', text: 'What changed?' },
      { speaker: 'analyst', delivery: 'thoughtful', text: 'The release improved tool use.' },
    ], config, fetchFn as unknown as typeof fetch);
    expect(bytes.length).toBeGreaterThan(0);

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('xi_test');
    expect(JSON.parse(init.body as string)).toEqual({
      model_id: 'eleven_v3',
      inputs: [
        { text: '[curious] What changed?', voice_id: 'host_voice' },
        { text: '[thoughtful] The release improved tool use.', voice_id: 'analyst_voice' },
      ],
    });
  });

  it('rejects a dialogue request above the provider limit before spending money', async () => {
    const fetchFn = vi.fn();
    await expect(generateDialogueSegment([
      { speaker: 'host', delivery: 'warm', text: 'x'.repeat(2_000) },
    ], config, fetchFn as unknown as typeof fetch)).rejects.toThrow('provider limit');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

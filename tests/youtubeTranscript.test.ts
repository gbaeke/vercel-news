import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchYouTubeTranscript,
  formatTranscript,
  prepareTranscriptForPipeline,
} from '../lib/youtubeTranscript';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPADATA_API_KEY;
  delete process.env.YOUTUBE_TRANSCRIPT_MODE;
});

describe('YouTube transcripts', () => {
  it('formats timestamped transcript segments', () => {
    expect(formatTranscript([
      { text: 'Opening', offset: 0, duration: 1_000, lang: 'en' },
      { text: 'A later claim', offset: 3_723_000, duration: 2_000, lang: 'en' },
    ])).toBe('[0:00] Opening\n[1:02:03] A later claim');
  });

  it('keeps a short transcript intact without an LLM summary', async () => {
    const summarize = vi.fn(async () => 'unused');
    const prepared = await prepareTranscriptForPipeline('[0:00] A complete short transcript', summarize);
    expect(prepared.summarized).toBe(false);
    expect(prepared.content).toContain('A complete short transcript');
    expect(summarize).not.toHaveBeenCalled();
  });

  it('analyzes every chunk of a long transcript', async () => {
    const transcript = Array.from(
      { length: 2_000 },
      (_, index) => `[${Math.floor(index / 60)}:${String(index % 60).padStart(2, '0')}] claim ${index} with substantive details`
    ).join('\n');
    const summarize = vi.fn(async (_system: string, user: string) => `notes for ${user.length} chars`);

    const prepared = await prepareTranscriptForPipeline(transcript, summarize);

    expect(prepared.summarized).toBe(true);
    expect(prepared.chunkCount).toBeGreaterThan(1);
    expect(summarize).toHaveBeenCalledTimes(prepared.chunkCount);
    expect(prepared.content).toContain(`Transcript section ${prepared.chunkCount} of ${prepared.chunkCount}`);
  });

  it('fetches native captions before considering generated speech-to-text', async () => {
    process.env.SUPADATA_API_KEY = 'test-key';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      content: [{ text: 'Caption text', offset: 1000, duration: 2000, lang: 'en' }],
      lang: 'en',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchYouTubeTranscript({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))
      .resolves.toMatchObject({ kind: 'ready', method: 'youtube-captions', language: 'en' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('mode=native');
  });

  it('starts and later polls an async generated transcript without resubmitting it', async () => {
    process.env.SUPADATA_API_KEY = 'test-key';
    process.env.YOUTUBE_TRANSCRIPT_MODE = 'auto';
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response())
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'not available' }), { status: 206 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 'job-123' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'completed',
        content: [{ text: 'Generated text', offset: 0, duration: 1000, lang: 'en' }],
        lang: 'en',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchYouTubeTranscript({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }))
      .resolves.toEqual({ kind: 'pending', jobId: 'job-123', method: 'youtube-asr' });
    await expect(fetchYouTubeTranscript({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      jobId: 'job-123',
    })).resolves.toMatchObject({ kind: 'ready', method: 'youtube-asr' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain('/transcript/job-123');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { query } from '../lib/db';
import {
  MAX_SPEECH_CHARACTERS,
  buildNarration,
  enqueueArticleAudioById,
  markdownToSpeechText,
  runAudioTick,
} from '../lib/audio';

async function insertPublished(extra: { content?: string; version?: number } = {}) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (
       source_feed, trigger_url, title, content_md, content_html, summary,
       slug, status, version, published_at
     ) VALUES (
       'openai', 'https://example.com/audio', 'A useful title', $1, '<p>Body</p>', 'Summary',
       'a-useful-title', 'published', $2, now()
     ) RETURNING id`,
    [extra.content ?? 'First paragraph.\n\nSecond paragraph with [a link](https://example.com).', extra.version ?? 1]
  );
  return rows[0].id;
}

describe('article audio', () => {
  it('builds a clean narration with title, disclosure, and body but no link URL or summary', () => {
    const body = markdownToSpeechText(
      '## Heading\n\nRead [the source](https://example.com/x), not https://example.com/raw.\n\n- One\n- Two'
    );
    const narration = buildNarration({
      title: 'Title',
      content_md: '## Heading\n\nRead [the source](https://example.com/x), not https://example.com/raw.\n\n- One\n- Two',
    });
    expect(body).toContain('Heading');
    expect(narration).toContain('Title\n\nThis article is narrated by an AI-generated voice.');
    expect(narration).toContain('Read the source');
    expect(narration).not.toContain('https://');
    expect(narration).not.toContain('Summary');
  });

  it('generates and stores a ready MP3 for a queued published article', async () => {
    const id = await insertPublished();
    await enqueueArticleAudioById(id);
    const uploadBlob = vi.fn(async () =>
      'https://x.public.blob.vercel-storage.com/audio/1/v1-deadbeef.mp3'
    );
    const generateSpeech = vi.fn(async () => Buffer.from('mp3 bytes'));

    const results = await runAudioTick({ generateSpeech, uploadBlob });
    expect(results).toEqual([{ articleId: id, from: 'processing', to: 'ready', attempt: 1 }]);
    expect(generateSpeech).toHaveBeenCalledWith(
      expect.stringContaining('This article is narrated by an AI-generated voice.'),
      'alloy'
    );
    expect(uploadBlob).toHaveBeenCalledWith(
      expect.stringMatching(/^audio\/1\/v1-[a-f0-9]{12}\.mp3$/),
      Buffer.from('mp3 bytes'),
      'audio/mpeg'
    );

    const [audio] = await query<any>(`SELECT * FROM article_audio WHERE article_id = $1`, [id]);
    expect(audio.status).toBe('ready');
    expect(audio.byte_length).toBe('9');
    expect(audio.media_type).toBe('audio/mpeg');
    expect(audio.generated_at).not.toBeNull();
  });

  it('persists transient failures, backs off, and stops after three attempts', async () => {
    const id = await insertPublished();
    await enqueueArticleAudioById(id);
    const generateSpeech = vi.fn(async () => {
      const error = new Error('gateway overloaded') as Error & { statusCode: number };
      error.statusCode = 503;
      throw error;
    });

    const first = await runAudioTick({ generateSpeech });
    expect(first[0]).toMatchObject({ to: 'pending', attempt: 1, error: 'gateway overloaded' });

    for (let attempt = 2; attempt <= 3; attempt += 1) {
      await query(`UPDATE article_audio SET next_attempt_at = now() WHERE article_id = $1`, [id]);
      const result = await runAudioTick({ generateSpeech });
      expect(result[0]).toMatchObject({
        to: attempt === 3 ? 'failed' : 'pending',
        attempt,
      });
    }
    expect(generateSpeech).toHaveBeenCalledTimes(3);
    const [audio] = await query<any>(`SELECT * FROM article_audio WHERE article_id = $1`, [id]);
    expect(audio.status).toBe('failed');
    expect(audio.attempt_count).toBe(3);
    expect(audio.next_attempt_at).toBeNull();
  });

  it('fails an oversized article visibly without calling the provider', async () => {
    const id = await insertPublished({ content: 'x'.repeat(MAX_SPEECH_CHARACTERS + 1) });
    await enqueueArticleAudioById(id);
    const generateSpeech = vi.fn(async () => Buffer.from('never'));

    const [result] = await runAudioTick({ generateSpeech });
    expect(result.to).toBe('failed');
    expect(result.error).toContain('Shorten the article');
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it('replaces a prior episode when a corrected article version is queued', async () => {
    const id = await insertPublished();
    await enqueueArticleAudioById(id);
    const oldUrl = 'https://x.public.blob.vercel-storage.com/audio/1/v1-old.mp3';
    await query(
      `UPDATE article_audio
       SET status = 'ready', blob_url = $1, byte_length = 12, media_type = 'audio/mpeg', generated_at = now()
       WHERE article_id = $2`,
      [oldUrl, id]
    );
    await query(
      `UPDATE articles SET version = 2, content_md = 'Corrected body.' WHERE id = $1`,
      [id]
    );
    const del = vi.fn(async () => {});

    const result = await enqueueArticleAudioById(id, { deps: { del } });
    expect(result).toEqual({ ok: true, status: 'pending', changed: true });
    expect(del).toHaveBeenCalledWith(oldUrl);
    const [audio] = await query<any>(`SELECT * FROM article_audio WHERE article_id = $1`, [id]);
    expect(audio.article_version).toBe(2);
    expect(audio.status).toBe('pending');
    expect(audio.blob_url).toBeNull();
  });

  it('manual retry resets an exhausted job to a fresh three-attempt budget', async () => {
    const id = await insertPublished();
    await enqueueArticleAudioById(id);
    await query(
      `UPDATE article_audio SET status = 'failed', attempt_count = 3, next_attempt_at = NULL
       WHERE article_id = $1`,
      [id]
    );

    const result = await enqueueArticleAudioById(id, { forceRetry: true });
    expect(result).toEqual({ ok: true, status: 'pending', changed: true });
    const [audio] = await query<any>(
      `SELECT status, attempt_count, next_attempt_at FROM article_audio WHERE article_id = $1`,
      [id]
    );
    expect(audio.status).toBe('pending');
    expect(audio.attempt_count).toBe(0);
    expect(audio.next_attempt_at).not.toBeNull();
  });
});

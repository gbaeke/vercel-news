import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';
import { extractStructuredArticleBody, scrapeHandler } from '../../lib/handlers/scrape';

async function insertArticle(overrides: Partial<{ trigger_content: string; source_rss_content: string; source_attempt_count: number }> = {}) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, source_rss_content, source_attempt_count, status)
     VALUES ('openai', 'https://example.com/x', $1, $2, $3, 'new') RETURNING *`,
    [
      overrides.trigger_content ?? null,
      overrides.source_rss_content ?? null,
      overrides.source_attempt_count ?? 0,
    ]
  );
  return rows[0];
}

const noWait = async () => {};

async function insertYouTubeArticle() {
  const [article] = await query(
    `INSERT INTO articles (
       source_feed, trigger_url, status, source_type, youtube_video_id
     ) VALUES (
       'youtube.com', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'new', 'youtube', 'dQw4w9WgXcQ'
     ) RETURNING *`
  );
  return article;
}

describe('scrapeHandler', () => {
  it('stores a YouTube transcript and its provenance instead of scraping page HTML', async () => {
    const article = await insertYouTubeArticle();
    const transcriptText = 'A substantive caption about a model release and its limitations. '.repeat(8);
    const to = await scrapeHandler(article as any, {
      fetchYouTubeTranscript: async () => ({
        kind: 'ready',
        segments: [{ text: transcriptText, offset: 0, duration: 10_000, lang: 'en' }],
        language: 'en',
        method: 'youtube-captions',
      }),
      sourceProvider: 'test-provider',
    });

    expect(to).toBe('scraped');
    const [row] = await query<{
      status: string; trigger_content: string; source_transcript: string;
      source_extraction_method: string; source_transcript_lang: string; source_provider: string;
    }>(
      `SELECT status, trigger_content, source_transcript, source_extraction_method,
              source_transcript_lang, source_provider
       FROM articles WHERE id = $1`,
      [(article as any).id]
    );
    expect(row.status).toBe('scraped');
    expect(row.trigger_content).toContain('Video transcript');
    expect(row.source_transcript).toContain('[0:00] A substantive caption');
    expect(row.source_extraction_method).toBe('youtube-captions');
    expect(row.source_transcript_lang).toBe('en');
    expect(row.source_provider).toBe('test-provider');
  });

  it('persists and polls an asynchronous transcript job without starting it again', async () => {
    const article = await insertYouTubeArticle();
    const fetchTranscript = vi.fn(async ({ jobId }: { jobId?: string | null }) => {
      if (!jobId) return { kind: 'pending' as const, jobId: 'job-123', method: 'youtube-asr' as const };
      return { kind: 'pending' as const, jobId, method: 'youtube-asr' as const };
    });

    await expect(scrapeHandler(article as any, { fetchYouTubeTranscript: fetchTranscript }))
      .resolves.toBe('scrape_retry');
    const [pending] = await query<any>(`SELECT * FROM articles WHERE id = $1`, [(article as any).id]);
    expect(pending.source_external_job_id).toBe('job-123');
    expect(pending.source_extraction_method).toBe('youtube-asr-pending');

    await expect(scrapeHandler(pending, { fetchYouTubeTranscript: fetchTranscript }))
      .resolves.toBe('scrape_retry');
    expect(fetchTranscript).toHaveBeenNthCalledWith(2, {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      jobId: 'job-123',
    });
    const [polled] = await query<{ source_attempt_count: number }>(
      `SELECT source_attempt_count FROM articles WHERE id = $1`,
      [(article as any).id]
    );
    expect(polled.source_attempt_count).toBe(1);
  });

  it('fails visibly when a YouTube transcript is unavailable', async () => {
    const article = await insertYouTubeArticle();
    const to = await scrapeHandler(article as any, {
      fetchYouTubeTranscript: async () => ({ kind: 'unavailable', reason: 'video is private' }),
    });
    expect(to).toBe('failed');
    const [row] = await query<{ status: string; failed_from: string; error: string }>(
      `SELECT status, failed_from, error FROM articles WHERE id = $1`,
      [(article as any).id]
    );
    expect(row.status).toBe('failed');
    expect(row.failed_from).toBe('new');
    expect(row.error).toContain('video is private');
  });

  it('stores a substantive page extraction with its provenance', async () => {
    const article = await insertArticle();
    const longText = 'A'.repeat(500);
    const to = await scrapeHandler(article as any, { extract: async () => longText });
    expect(to).toBe('scraped');

    const [row] = await query<{
      status: string; trigger_content: string; source_extraction_method: string;
      source_content_length: number; source_attempt_count: number;
    }>(
      `SELECT status, trigger_content, source_extraction_method, source_content_length, source_attempt_count
       FROM articles WHERE id = $1`, [article.id]
    );
    expect(row).toMatchObject({
      status: 'scraped',
      trigger_content: longText,
      source_extraction_method: 'page',
      source_content_length: 500,
      source_attempt_count: 1,
    });
  });

  it('retries a weak page response before accepting a later complete extraction', async () => {
    const article = await insertArticle();
    let calls = 0;
    const to = await scrapeHandler(article as any, {
      extract: async () => (++calls === 1 ? 'too short' : 'A'.repeat(500)),
      sleep: noWait,
    });
    expect(to).toBe('scraped');
    expect(calls).toBe(2);
  });

  it('uses a substantive, non-truncated RSS body only as a documented fallback', async () => {
    const fallback = 'B'.repeat(600);
    const article = await insertArticle({ source_rss_content: fallback });
    const to = await scrapeHandler(article as any, { extract: async () => null, sleep: noWait });
    expect(to).toBe('scraped');

    const [row] = await query<{ trigger_content: string; source_extraction_method: string; source_fallback_reason: string }>(
      `SELECT trigger_content, source_extraction_method, source_fallback_reason FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content).toBe(fallback);
    expect(row.source_extraction_method).toBe('rss-fallback');
    expect(row.source_fallback_reason).toContain('page extraction');
  });

  it('queues a truncated RSS preview for a delayed scrape retry instead of drafting from it', async () => {
    const preview = 'The Shared Pool: Every Copilot Business ($19/mo) and E... Update Type: Announcement, Services:';
    const article = await insertArticle({ source_rss_content: preview });
    const to = await scrapeHandler(article as any, { extract: async () => null, sleep: noWait });
    expect(to).toBe('scrape_retry');

    const [row] = await query<{
      status: string; source_attempt_count: number; source_fallback_reason: string; source_next_retry_at: string | null;
    }>(`SELECT status, source_attempt_count, source_fallback_reason, source_next_retry_at FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('scrape_retry');
    expect(row.source_attempt_count).toBe(1);
    expect(row.source_fallback_reason).toContain('truncated preview');
    expect(row.source_next_retry_at).not.toBeNull();
  });

  it('fails with an inspectable reason after three scrape cycles', async () => {
    const article = await insertArticle({ source_attempt_count: 2 });
    const to = await scrapeHandler(article as any, { extract: async () => null, sleep: noWait });
    expect(to).toBe('failed');

    const [row] = await query<{ status: string; failed_from: string; error: string; source_attempt_count: number }>(
      `SELECT status, failed_from, error, source_attempt_count FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.status).toBe('failed');
    expect(row.failed_from).toBe('new');
    expect(row.error).toContain('scrape failed after 3 cycles');
    expect(row.source_attempt_count).toBe(3);
  });

  it('strips HTML tags from extracted content before storing', async () => {
    const article = await insertArticle();
    const html = `<article><h1>Big News</h1><p>${'Real content. '.repeat(30)}</p><script>evil()</script></article>`;
    await scrapeHandler(article as any, { extract: async () => html });

    const [row] = await query<{ trigger_content: string }>(
      `SELECT trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content).not.toContain('<');
    expect(row.trigger_content).toContain('Real content.');
    expect(row.trigger_content).not.toContain('evil()');
  });

  it('preserves safe article links for the eventual news item', async () => {
    const article = await insertArticle();
    const html = `<article><p>${'Reporting with context. '.repeat(30)}<a href="/research">Read the research</a><a href="javascript:alert(1)">Bad link</a></p></article>`;
    await scrapeHandler(article as any, { extract: async () => html });

    const [row] = await query<{ trigger_content: string }>(
      `SELECT trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content).toContain('Links from the original article:');
    expect(row.trigger_content).toContain('[Read the research](https://example.com/research)');
    expect(row.trigger_content).not.toContain('javascript:');
  });

  it('rejects an over-limit source and records that the safety limit fired', async () => {
    const article = await insertArticle();
    const to = await scrapeHandler(article as any, { extract: async () => 'C'.repeat(100_001), sleep: noWait });
    expect(to).toBe('scrape_retry');
    const [row] = await query<{ source_capped: boolean; trigger_content: string | null }>(
      `SELECT source_capped, trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.source_capped).toBe(true);
    expect(row.trigger_content).toBeNull();
  });

  it('extracts the largest Article JSON-LD body as a second strategy', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Article","articleBody":"short"}</script>
      <script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","articleBody":"${'Full article. '.repeat(50)}"}]}</script>
    `;
    expect(extractStructuredArticleBody(html)).toContain('Full article.');
  });
});

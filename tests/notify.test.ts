import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendReviewReadyEmail } from '../lib/notify';
import type { Article } from '../lib/types';

const article = {
  id: 42,
  source_feed: 'openai',
  title: 'GPT-6 Ships & <Breaks> Things',
  summary: 'A short summary.',
  persona: 'Ada Lovelace',
  tags: { primary: 'models', secondary: [] },
  status: 'written',
} as unknown as Article;

function okFetch() {
  return vi.fn(async () => new Response('{"id":"email_1"}', { status: 200 }));
}

describe('sendReviewReadyEmail', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.REVIEW_NOTIFY_EMAIL = 'editor@example.com';
    process.env.APP_URL = 'https://news.example.com';
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.REVIEW_NOTIFY_EMAIL;
    delete process.env.APP_URL;
    delete process.env.REVIEW_NOTIFY_FROM;
  });

  it('posts a formatted email to Resend', async () => {
    const fetchFn = okFetch();
    const sent = await sendReviewReadyEmail(article, 'https://blob.example.com/t.png', { fetchFn });
    expect(sent).toBe(true);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');

    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(['editor@example.com']);
    expect(body.subject).toBe('Ready for review: GPT-6 Ships & <Breaks> Things');
    expect(body.html).toContain('GPT-6 Ships &amp; &lt;Breaks&gt; Things');
    expect(body.html).toContain('https://news.example.com/review/42');
    expect(body.html).toContain('https://blob.example.com/t.png');
    expect(body.html).toContain('Ada Lovelace');
  });

  it('skips when not configured', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchFn = okFetch();
    const sent = await sendReviewReadyEmail(article, null, { fetchFn });
    expect(sent).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('omits data-URL placeholder thumbnails from the email', async () => {
    const fetchFn = okFetch();
    await sendReviewReadyEmail(article, 'data:image/svg+xml;base64,abc', { fetchFn });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).not.toContain('data:image/svg+xml');
    expect(body.html).not.toContain('<img');
  });

  it('returns false on a Resend error without throwing', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 422 }));
    const sent = await sendReviewReadyEmail(article, null, { fetchFn });
    expect(sent).toBe(false);
  });

  it('returns false when fetch itself rejects', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('network down'); });
    const sent = await sendReviewReadyEmail(article, null, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(sent).toBe(false);
  });
});

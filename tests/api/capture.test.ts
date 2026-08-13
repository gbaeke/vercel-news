import { afterEach, describe, expect, it } from 'vitest';
import { query } from '../../lib/db';
import { POST } from '../../app/api/capture/route';

const originalToken = process.env.CAPTURE_TOKEN;

function captureRequest(body: unknown, token = 'test-capture-token'): Request {
  return new Request('https://wire.example/api/capture', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  if (originalToken === undefined) delete process.env.CAPTURE_TOKEN;
  else process.env.CAPTURE_TOKEN = originalToken;
});

describe('POST /api/capture', () => {
  it('fails closed without the configured token', async () => {
    process.env.CAPTURE_TOKEN = 'test-capture-token';
    const response = await POST(captureRequest({ url: 'https://example.com/story' }, 'wrong'));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Unauthorized.' });
  });

  it('queues a valid URL and returns a Shortcut-friendly message', async () => {
    process.env.CAPTURE_TOKEN = 'test-capture-token';
    const response = await POST(captureRequest({ url: 'https://example.com/story' }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      outcome: 'inserted',
      articleId: 1,
      status: 'new',
      message: 'Queued as article #1.',
      reviewUrl: 'https://wire.example/review/1',
    });
    const rows = await query<{ trigger_url: string }>('SELECT trigger_url FROM articles');
    expect(rows).toEqual([{ trigger_url: 'https://example.com/story' }]);
  });

  it('accepts the one-item URL list that Shortcuts may serialize', async () => {
    process.env.CAPTURE_TOKEN = 'test-capture-token';
    const response = await POST(captureRequest({ url: ['https://example.com/from-shortcut'] }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      url: 'https://example.com/from-shortcut',
    });
  });

  it('reports a duplicate without creating another row', async () => {
    process.env.CAPTURE_TOKEN = 'test-capture-token';
    await POST(captureRequest({ url: 'https://example.com/story' }));
    const response = await POST(captureRequest({ url: 'https://example.com/story' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      outcome: 'duplicate',
      message: 'Already queued as article #1.',
    });
    const [{ count }] = await query<{ count: string }>('SELECT count(*) FROM articles');
    expect(count).toBe('1');
  });

  it('returns validation errors without queueing a row', async () => {
    process.env.CAPTURE_TOKEN = 'test-capture-token';
    const response = await POST(captureRequest({ url: 'not a url' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Enter a valid absolute URL.',
    });
  });

  it('keeps permanently deleted URLs out of the queue', async () => {
    process.env.CAPTURE_TOKEN = 'test-capture-token';
    await query('INSERT INTO deleted_urls (url) VALUES ($1)', ['https://example.com/deleted']);
    const response = await POST(captureRequest({ url: 'https://example.com/deleted' }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, outcome: 'deleted' });
  });
});

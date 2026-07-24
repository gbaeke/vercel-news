import { describe, it, expect } from 'vitest';
import { validateFeed } from '../lib/feedValidator';

const OK_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>My Feed</title>
<item><title>A</title><link>https://example.com/a</link></item>
<item><title>B</title><link>https://example.com/b</link></item>
</channel></rss>`;

describe('validateFeed', () => {
  it('accepts a parseable feed and reports title and item count', async () => {
    const result = await validateFeed('https://example.com/rss.xml', {
      fetchFeedXml: async () => OK_XML,
    });
    expect(result).toEqual({ ok: true, title: 'My Feed', itemCount: 2, warning: undefined });
  });

  it('rejects a malformed URL without fetching', async () => {
    const result = await validateFeed('not a url', {
      fetchFeedXml: async () => {
        throw new Error('should not be called');
      },
    });
    expect(result).toEqual({ ok: false, error: 'not a valid URL' });
  });

  it('rejects non-http(s) URLs', async () => {
    const result = await validateFeed('ftp://example.com/feed');
    expect(result.ok).toBe(false);
  });

  it('reports fetch failures (e.g. HTTP errors)', async () => {
    const result = await validateFeed('https://example.com/rss.xml', {
      fetchFeedXml: async () => {
        throw new Error('feed returned HTTP 404');
      },
    });
    expect(result).toEqual({ ok: false, error: 'fetch failed: feed returned HTTP 404' });
  });

  it('rejects content that is not RSS/Atom', async () => {
    const result = await validateFeed('https://example.com/rss.xml', {
      fetchFeedXml: async () => '<!DOCTYPE html><html><body>Not Found</body></html>',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a valid RSS\/Atom feed/);
  });

  it('rejects feeds whose items have no links (unusable for ingest)', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>No Links</title>
      <item><title>A</title></item></channel></rss>`;
    const result = await validateFeed('https://example.com/rss.xml', {
      fetchFeedXml: async () => xml,
    });
    expect(result).toEqual({ ok: false, error: 'feed parses but none of its items have a link' });
  });

  it('accepts an empty feed with a warning', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    const result = await validateFeed('https://example.com/rss.xml', {
      fetchFeedXml: async () => xml,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warning).toMatch(/no items/);
  });
});

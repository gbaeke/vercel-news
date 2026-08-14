import { afterEach, describe, expect, it } from 'vitest';
import { browserScrapeHostAllowed } from '../lib/browserScrape';

const originalHosts = process.env.BROWSER_SCRAPE_HOSTS;

afterEach(() => {
  if (originalHosts === undefined) delete process.env.BROWSER_SCRAPE_HOSTS;
  else process.env.BROWSER_SCRAPE_HOSTS = originalHosts;
});

describe('browser scrape host policy', () => {
  it('allows public hosts by default without per-site configuration', () => {
    delete process.env.BROWSER_SCRAPE_HOSTS;
    expect(browserScrapeHostAllowed('https://example.com/story')).toBe(true);
  });

  it('supports an optional host restriction for tighter deployments', () => {
    process.env.BROWSER_SCRAPE_HOSTS = 'z.ai, example.org';
    expect(browserScrapeHostAllowed('https://z.ai/blog/glm-5.3')).toBe(true);
    expect(browserScrapeHostAllowed('https://sub.example.org/story')).toBe(true);
    expect(browserScrapeHostAllowed('https://example.com/story')).toBe(false);
  });

  it('still rejects private and non-http targets', () => {
    delete process.env.BROWSER_SCRAPE_HOSTS;
    expect(browserScrapeHostAllowed('http://127.0.0.1/admin')).toBe(false);
    expect(browserScrapeHostAllowed('file:///etc/passwd')).toBe(false);
  });
});

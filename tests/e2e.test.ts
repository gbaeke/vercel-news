import { describe, it, expect, vi } from 'vitest';
import { query } from '../lib/db';
import { ingestFeeds } from '../lib/ingest';
import { runTick } from '../lib/tick';
import { approveArticleById } from '../lib/reviewActions';
import { getPublishedArticleBySlug } from '../lib/publicQueries';

vi.mock('../lib/handlers/scrape', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/handlers/scrape')>();
  return {
    ...mod,
    scrapeHandler: (article: any) => mod.scrapeHandler(article, { extract: async () => 'A'.repeat(500) }),
  };
});

vi.mock('../lib/handlers/thumbnail', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/handlers/thumbnail')>();
  return {
    ...mod,
    thumbnailHandler: (article: any) =>
      mod.thumbnailHandler(article, {
        generateImage: async () => Buffer.from('fake-image-bytes'),
        uploadBlob: async () => 'https://blob.example.com/e2e.png',
      }),
  };
});

function rss(items: { title: string; link: string; description: string }[]) {
  const entries = items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description}</description></item>`)
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${entries}</channel></rss>`;
}

describe('end-to-end pipeline (FAKE_LLM=1)', () => {
  it('carries one feed item from ingest through to in_review in a single tick', async () => {
    process.env.FAKE_LLM = '1';
    const xml = rss([{ title: 'A New Model', link: 'https://example.com/e2e-1', description: 'A model was released.' }]);
    await ingestFeeds({ fetchFeedXml: async () => xml });

    await runTick();

    const [row] = await query<{ status: string; title: string; thumbnail_url: string }>(
      `SELECT status, title, thumbnail_url FROM articles WHERE trigger_url = 'https://example.com/e2e-1'`
    );
    expect(row.status).toBe('in_review');
    expect(row.title).toBeTruthy();
    expect(row.thumbnail_url).toBeTruthy();
  });

  it('goes all the way to published and visible on the public site after approval', async () => {
    process.env.FAKE_LLM = '1';
    const xml = rss([{ title: 'Full Loop', link: 'https://example.com/e2e-2', description: 'Full loop test.' }]);
    await ingestFeeds({ fetchFeedXml: async () => xml });
    await runTick();

    const [inReview] = await query<{ id: number; status: string }>(
      `SELECT id, status FROM articles WHERE trigger_url = 'https://example.com/e2e-2'`
    );
    expect(inReview.status).toBe('in_review');

    await approveArticleById(inReview.id);
    await runTick();

    const [published] = await query<{ status: string; slug: string }>(
      `SELECT status, slug FROM articles WHERE id = $1`, [inReview.id]
    );
    expect(published.status).toBe('published');

    const publicArticle = await getPublishedArticleBySlug(published.slug);
    expect(publicArticle?.slug).toBe(published.slug);
  });
});

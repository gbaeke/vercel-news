import { describe, it, expect, vi } from 'vitest';
import { query } from '../lib/db';
import { ingestFeeds } from '../lib/ingest';
import { runTick } from '../lib/tick';
import {
  approveArticleById,
  approveRssFirstReviewById,
  approveRssFinalReviewAndPublishById,
  unpublishArticleById,
  deleteArticleById,
} from '../lib/reviewActions';
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
  it('holds an RSS item for source review, then drafts without a thumbnail', async () => {
    process.env.FAKE_LLM = '1';
    const xml = rss([{ title: 'A New Model', link: 'https://example.com/e2e-1', description: 'A model was released.' }]);
    await ingestFeeds({ fetchFeedXml: async () => xml });

    await runTick();
    const [sourceReview] = await query<{ id: number; status: string }>(
      `SELECT id, status FROM articles WHERE trigger_url = 'https://example.com/e2e-1'`
    );
    expect(sourceReview.status).toBe('rss_pending_review');

    await approveRssFirstReviewById(sourceReview.id);
    await runTick();

    const [row] = await query<{ status: string; title: string; thumbnail_url: string }>(
      `SELECT status, title, thumbnail_url FROM articles WHERE trigger_url = 'https://example.com/e2e-1'`
    );
    expect(row.status).toBe('rss_final_review');
    expect(row.title).toBeTruthy();
    expect(row.thumbnail_url).toBeNull();
  });

  it('goes all the way to published and visible on the public site after approval', async () => {
    process.env.FAKE_LLM = '1';
    const xml = rss([{ title: 'Full Loop', link: 'https://example.com/e2e-2', description: 'Full loop test.' }]);
    await ingestFeeds({ fetchFeedXml: async () => xml });
    await runTick();

    const [sourceReview] = await query<{ id: number; status: string }>(
      `SELECT id, status FROM articles WHERE trigger_url = 'https://example.com/e2e-2'`
    );
    expect(sourceReview.status).toBe('rss_pending_review');

    await approveRssFirstReviewById(sourceReview.id);
    await runTick();
    const [draftReview] = await query<{ status: string }>(`SELECT status FROM articles WHERE id = $1`, [sourceReview.id]);
    expect(draftReview.status).toBe('rss_final_review');
    await approveRssFinalReviewAndPublishById(sourceReview.id);

    const [published] = await query<{ status: string; slug: string }>(
      `SELECT status, slug FROM articles WHERE id = $1`, [sourceReview.id]
    );
    expect(published.status).toBe('published');

    const publicArticle = await getPublishedArticleBySlug(published.slug);
    expect(publicArticle?.slug).toBe(published.slug);
  });

  it('unpublishes back to the desk, sits out the next tick, and re-publishes to the same URL', async () => {
    process.env.FAKE_LLM = '1';
    const xml = rss([{ title: 'Second Thoughts', link: 'https://example.com/e2e-3', description: 'Pulled back.' }]);
    await ingestFeeds({ fetchFeedXml: async () => xml });
    await runTick();

    const [article] = await query<{ id: number }>(
      `SELECT id FROM articles WHERE trigger_url = 'https://example.com/e2e-3'`
    );
    await approveRssFirstReviewById(article.id);
    await runTick();
    await approveRssFinalReviewAndPublishById(article.id);
    const [live] = await query<{ slug: string }>(`SELECT slug FROM articles WHERE id = $1`, [article.id]);

    await unpublishArticleById(article.id);
    expect(await getPublishedArticleBySlug(live.slug)).toBeNull();

    // in_review has no handler, so the tick must leave it alone rather than
    // dragging it back through the pipeline.
    await runTick();
    const [waiting] = await query<{ status: string }>(`SELECT status FROM articles WHERE id = $1`, [article.id]);
    expect(waiting.status).toBe('in_review');

    await approveArticleById(article.id);
    await runTick();
    const [republished] = await query<{ status: string; slug: string }>(
      `SELECT status, slug FROM articles WHERE id = $1`, [article.id]
    );
    expect(republished.status).toBe('published');
    expect(republished.slug).toBe(live.slug);
  });

  it('a deleted article is gone for good — the next ingest and tick do not bring it back', async () => {
    process.env.FAKE_LLM = '1';
    const xml = rss([{ title: 'Never Again', link: 'https://example.com/e2e-4', description: 'Deleted.' }]);
    await ingestFeeds({ fetchFeedXml: async () => xml });
    await runTick();

    const [article] = await query<{ id: number }>(
      `SELECT id FROM articles WHERE trigger_url = 'https://example.com/e2e-4'`
    );
    await deleteArticleById(article.id);

    // Wipe the last-seen marker: even a feed that looks brand new must not
    // resurrect the story.
    await query(`DELETE FROM feed_state`);
    await ingestFeeds({ fetchFeedXml: async () => xml });
    await runTick();

    const rows = await query(`SELECT id FROM articles WHERE trigger_url = 'https://example.com/e2e-4'`);
    expect(rows).toEqual([]);
  });
});

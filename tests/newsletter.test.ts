import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { query } from '../lib/db';
import {
  generateNewsletterDraft,
  getNewsletterArticles,
  newsletterWindowForWeekEnding,
  previousNewsletterWindow,
  renderNewsletterHtml,
  type NewsletterArticle,
} from '../lib/newsletter';
import {
  newsletterMailConfigFromEnv,
  parseNewsletterRecipients,
  sendNewsletterEmail,
} from '../lib/newsletterMailer';
import { runWeeklyNewsletter } from '../lib/newsletterRunner';

async function insertArticle(input: {
  slug: string;
  title: string;
  publishedAt: string;
  status?: string;
  triggerUrl?: string;
  thumbnailUrl?: string | null;
}) {
  await query(
    `INSERT INTO articles (
       source_feed, trigger_url, title, content_md, content_html, summary,
       slug, thumbnail_url, status, version, published_at
     ) VALUES ('openai', $1, $2, 'Published body with concrete facts.', '<p>Published body with concrete facts.</p>',
       'An existing concise newsroom summary with useful detail.', $3, $4, $5, 1, $6)`,
    [
      input.triggerUrl ?? `https://source.example/${input.slug}`,
      input.title,
      input.slug,
      input.thumbnailUrl ?? null,
      input.status ?? 'published',
      input.publishedAt,
    ]
  );
}

function article(id: number): NewsletterArticle {
  return {
    id,
    source_feed: 'openai',
    trigger_url: `https://source.example/${id}`,
    tags: { primary: 'product', secondary: [] },
    title: `Article ${id}`,
    content_md: 'The published body contains the facts needed for a faithful summary.',
    summary: `Existing summary for article ${id} with enough detail to render a concise newsletter item.`,
    slug: `article-${id}`,
    thumbnail_url: id === 1 ? 'https://blob.example.com/one.png' : null,
    version: 1,
    published_at: '2026-08-09T10:00:00.000Z',
  };
}

describe('newsletter windows and source selection', () => {
  it('uses the previous seven complete local calendar days', () => {
    expect(previousNewsletterWindow(new Date('2026-08-10T12:00:00.000Z'))).toEqual({
      weekEnding: '2026-08-09',
      periodStart: '2026-08-02T22:00:00.000Z',
      periodEnd: '2026-08-09T22:00:00.000Z',
    });
    expect(newsletterWindowForWeekEnding('2026-11-01')).toEqual({
      weekEnding: '2026-11-01',
      periodStart: '2026-10-25T23:00:00.000Z',
      periodEnd: '2026-11-01T23:00:00.000Z',
    });
    expect(() => newsletterWindowForWeekEnding('2026-02-30')).toThrow('invalid');
  });

  it('returns only published, complete, unique articles in the requested window', async () => {
    const window = newsletterWindowForWeekEnding('2026-08-09');
    await insertArticle({ slug: 'kept', title: 'Kept', publishedAt: '2026-08-08T10:00:00.000Z' });
    await insertArticle({
      slug: 'duplicate-kept',
      title: 'Kept',
      publishedAt: '2026-08-07T10:00:00.000Z',
      triggerUrl: 'https://source.example/duplicate',
    });
    await insertArticle({ slug: 'draft', title: 'Draft', publishedAt: '2026-08-08T10:00:00.000Z', status: 'written' });
    await insertArticle({ slug: 'old', title: 'Old', publishedAt: '2026-08-02T10:00:00.000Z' });

    const articles = await getNewsletterArticles(window);
    expect(articles.map((item) => item.slug)).toEqual(['kept']);
  });
});

describe('newsletter drafting and rendering', () => {
  it('requires one LLM summary for every article and preserves source order', async () => {
    const articles = [article(1), article(2)];
    const generateStructured = vi.fn(async () => ({
      subject: 'The agent layer gets operational',
      intro: 'Several releases this week focused on the machinery around deployed agents.',
      closing: 'The open question is how much of this infrastructure becomes interoperable.',
      stories: [
        { article_id: 2, summary: 'The second article adds a concrete orchestration feature and leaves adoption as the open question.' },
        { article_id: 1, summary: 'The first article adds a measured product capability while keeping its limitations visible.' },
      ],
    }));

    const draft = await generateNewsletterDraft(
      newsletterWindowForWeekEnding('2026-08-09'),
      articles,
      { generateStructured: generateStructured as any }
    );
    expect(generateStructured).toHaveBeenCalledOnce();
    expect(draft.stories.map((story) => story.article_id)).toEqual([1, 2]);
  });

  it('retries a structurally valid but incomplete model response', async () => {
    const articles = [article(1)];
    const generateStructured = vi.fn()
      .mockResolvedValueOnce({
        subject: 'Incomplete',
        intro: 'This intro is long enough to pass the basic length check.',
        closing: 'This closing is also long enough to pass.',
        stories: [],
      })
      .mockResolvedValueOnce({
        subject: 'Recovered newsletter',
        intro: 'The recovered intro describes the concrete shape of the week.',
        closing: 'The unresolved question is whether the change lasts beyond preview.',
        stories: [{ article_id: 1, summary: 'The article explains a concrete product change and its remaining limitation.' }],
      });

    const draft = await generateNewsletterDraft(
      newsletterWindowForWeekEnding('2026-08-09'),
      articles,
      { generateStructured: generateStructured as any }
    );
    expect(draft.subject).toBe('Recovered newsletter');
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[1][1]).toContain('exactly 1 story objects');
  });

  it('renders a self-contained email with article links and safe thumbnail handling', () => {
    const articles = [article(1), article(2)];
    const draft = {
      subject: 'The week on the wire <carefully>',
      intro: 'A factual editorial intro.',
      closing: 'A restrained closing observation.',
      stories: articles.map((item) => ({ article_id: item.id, summary: item.summary })),
    };
    const html = renderNewsletterHtml(
      newsletterWindowForWeekEnding('2026-08-09'),
      articles,
      draft,
      'https://news.example.com'
    );
    expect(html).toContain('The week on the wire &lt;carefully&gt;');
    expect(html).toContain('3 Aug 2026 – 9 Aug 2026');
    expect(html).toContain('https://news.example.com/articles/article-1');
    expect(html).toContain('https://blob.example.com/one.png');
    expect(html).not.toContain('data:image');
  });
});

describe('newsletter delivery', () => {
  it('uses explicit newsletter sender and recipients as independent overrides', () => {
    const config = newsletterMailConfigFromEnv({
      RESEND_API_KEY: 're_test_key',
      NEWSLETTER_FROM: 'The AI Wire <weekly@example.com>',
      NEWSLETTER_RECIPIENTS: 'reader@example.com',
      REVIEW_NOTIFY_FROM: 'The AI Wire <review@example.com>',
      REVIEW_NOTIFY_EMAIL: 'editor@example.com',
    });
    expect(config.from).toBe('The AI Wire <weekly@example.com>');
    expect(config.recipients).toEqual(['reader@example.com']);
  });

  it('falls back independently to the established review-notification settings', () => {
    const senderFallback = newsletterMailConfigFromEnv({
      RESEND_API_KEY: 're_test_key',
      REVIEW_NOTIFY_FROM: 'The AI Wire <review@example.com>',
      REVIEW_NOTIFY_EMAIL: 'editor@example.com',
    });
    expect(senderFallback.from).toBe('The AI Wire <review@example.com>');
    expect(senderFallback.recipients).toEqual(['editor@example.com']);

    const recipientFallback = newsletterMailConfigFromEnv({
      RESEND_API_KEY: 're_test_key',
      NEWSLETTER_FROM: 'The AI Wire <weekly@example.com>',
      REVIEW_NOTIFY_EMAIL: 'editor@example.com',
    });
    expect(recipientFallback.from).toBe('The AI Wire <weekly@example.com>');
    expect(recipientFallback.recipients).toEqual(['editor@example.com']);
  });

  it('uses the review sender default when no sender override exists', () => {
    const config = newsletterMailConfigFromEnv({
      RESEND_API_KEY: 're_test_key',
      REVIEW_NOTIFY_EMAIL: 'editor@example.com',
    });
    expect(config.from).toBe('The AI Wire <onboarding@resend.dev>');
  });

  it('fails a real-send configuration when neither recipient setting exists', () => {
    expect(() => newsletterMailConfigFromEnv({ RESEND_API_KEY: 're_test_key' }))
      .toThrow('NEWSLETTER_RECIPIENTS or REVIEW_NOTIFY_EMAIL is not set');
  });

  it('deduplicates and validates recipient controls', () => {
    expect(parseNewsletterRecipients('one@example.com, two@example.com; one@example.com')).toEqual([
      'one@example.com',
      'two@example.com',
    ]);
    expect(() => parseNewsletterRecipients('not-an-email')).toThrow('invalid newsletter recipient');
  });

  it('sends through Resend using the dedicated newsletter recipient list', async () => {
    const fetchFn = vi.fn(async () => new Response('{"id":"email_newsletter_1"}', { status: 200 }));
    const result = await sendNewsletterEmail({
      apiKey: 're_test_key',
      from: 'The AI Wire <newsletter@example.com>',
      recipients: ['reader@example.com'],
      subject: 'The week on the wire',
      html: '<html>newsletter</html>',
    }, { fetchFn });
    expect(result.id).toBe('email_newsletter_1');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: ['reader@example.com'],
      subject: 'The week on the wire',
    });
  });

  it('surfaces provider failures instead of treating them as a successful send', async () => {
    const fetchFn = vi.fn(async () => new Response('bad request', { status: 422 }));
    await expect(sendNewsletterEmail({
      apiKey: 're_test_key',
      from: 'newsletter@example.com',
      recipients: ['reader@example.com'],
      subject: 'The week on the wire',
      html: '<html>newsletter</html>',
    }, { fetchFn })).rejects.toThrow('HTTP 422');
  });

  it('dry-run writes a preview and never invokes the sender', async () => {
    const sendEmail = vi.fn();
    const writeFile = vi.fn(async () => undefined);
    const result = await runWeeklyNewsletter({
      appUrl: 'https://news.example.com',
      dryRun: true,
      weekEnding: '2026-08-09',
      outputDir: '/tmp/newsletter-test-output',
    }, {
      getArticles: async () => [article(1)],
      generateDraft: async () => ({
        subject: 'Dry-run newsletter',
        intro: 'This is an inspectable dry-run intro for the test.',
        closing: 'No provider call should happen in this path.',
        stories: [{ article_id: 1, summary: article(1).summary }],
      }),
      sendEmail: sendEmail as any,
      writeFile,
    });
    expect(result.sent).toBe(false);
    expect(result.previewPath).toBe(path.resolve('/tmp/newsletter-test-output/weekly-newsletter-2026-08-09.html'));
    expect(writeFile).toHaveBeenCalledOnce();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

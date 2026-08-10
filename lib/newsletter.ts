import { query } from './db';
import { structured } from './llm';
import { loadPrompt } from './prompts';
import type { Article } from './types';

export const NEWSLETTER_TIME_ZONE = 'Europe/Brussels';
export const DEFAULT_NEWSLETTER_MAX_ARTICLES = 20;
const MAX_SOURCE_BODY_CHARACTERS = 5_000;
const MAX_STORY_SUMMARY_CHARACTERS = 520;

export interface NewsletterWindow {
  weekEnding: string;
  periodStart: string;
  periodEnd: string;
}

export interface NewsletterArticle {
  id: number;
  source_feed: string;
  trigger_url: string;
  tags: Article['tags'];
  title: string;
  content_md: string;
  summary: string;
  slug: string;
  thumbnail_url: string | null;
  version: number;
  published_at: string;
}

export interface NewsletterStoryDraft {
  article_id: number;
  summary: string;
}

export interface NewsletterDraft {
  subject: string;
  intro: string;
  closing: string;
  stories: NewsletterStoryDraft[];
}

export interface NewsletterGenerateDeps {
  generateStructured?: typeof structured;
}

const NEWSLETTER_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    intro: { type: 'string' },
    closing: { type: 'string' },
    stories: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          article_id: { type: 'integer' },
          summary: { type: 'string' },
        },
        required: ['article_id', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['subject', 'intro', 'closing', 'stories'],
  additionalProperties: false,
};

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function calendarDateString(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function zonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(candidate));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(observed.find((item) => item.type === type)?.value);
    const observedAsUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second')
    );
    candidate += targetAsUtc - observedAsUtc;
  }
  return new Date(candidate);
}

function parseCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('week ending date must use YYYY-MM-DD format');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`week ending date is invalid: ${value}`);
  }
  return date;
}

export function newsletterWindowForWeekEnding(
  weekEnding: string,
  timeZone = NEWSLETTER_TIME_ZONE
): NewsletterWindow {
  const ending = parseCalendarDate(weekEnding);
  const start = addCalendarDays(ending, -6);
  const endExclusive = addCalendarDays(ending, 1);
  return {
    weekEnding: calendarDateString(ending),
    periodStart: zonedMidnightUtc(
      start.getUTCFullYear(),
      start.getUTCMonth() + 1,
      start.getUTCDate(),
      timeZone
    ).toISOString(),
    periodEnd: zonedMidnightUtc(
      endExclusive.getUTCFullYear(),
      endExclusive.getUTCMonth() + 1,
      endExclusive.getUTCDate(),
      timeZone
    ).toISOString(),
  };
}

export function previousNewsletterWindow(
  now = new Date(),
  timeZone = NEWSLETTER_TIME_ZONE
): NewsletterWindow {
  const local = zonedDateParts(now, timeZone);
  const today = new Date(Date.UTC(local.year, local.month - 1, local.day));
  return newsletterWindowForWeekEnding(calendarDateString(addCalendarDays(today, -1)), timeZone);
}

const ARTICLE_COLUMNS = `
  id, source_feed, trigger_url, tags, title, content_md, summary, slug,
  thumbnail_url, version, published_at
`;

export async function getNewsletterArticles(
  window: NewsletterWindow,
  maxArticles = DEFAULT_NEWSLETTER_MAX_ARTICLES
): Promise<NewsletterArticle[]> {
  const limit = Math.trunc(maxArticles);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('newsletter article limit must be an integer between 1 and 100');
  }
  return query<NewsletterArticle>(
    `WITH ranked AS (
       SELECT ${ARTICLE_COLUMNS},
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(
                  NULLIF(LOWER(REGEXP_REPLACE(COALESCE(title, ''), '\\s+', ' ', 'g')), ''),
                  NULLIF(slug, ''),
                  NULLIF(trigger_url, '')
                )
                ORDER BY published_at DESC, id DESC
              ) AS duplicate_rank
       FROM articles
       WHERE status = 'published'
         AND published_at >= $1
         AND published_at < $2
         AND title IS NOT NULL
         AND summary IS NOT NULL
         AND content_md IS NOT NULL
         AND slug IS NOT NULL
     )
     SELECT ${ARTICLE_COLUMNS}
     FROM ranked
     WHERE duplicate_rank = 1
     ORDER BY published_at DESC, id DESC
     LIMIT $3`,
    [window.periodStart, window.periodEnd, limit]
  );
}

export function newsletterArticleUrl(article: Pick<NewsletterArticle, 'slug' | 'trigger_url'>, appUrl: string): string {
  try {
    return new URL(
      `/articles/${encodeURIComponent(article.slug)}`,
      `${appUrl.replace(/\/+$/, '')}/`
    ).toString();
  } catch {
    return article.trigger_url;
  }
}

export function buildNewsletterSourcePacket(articles: NewsletterArticle[]): string {
  return articles.map((article, index) => [
    `ARTICLE ${index + 1}`,
    `Article ID: ${article.id}`,
    `Title: ${article.title}`,
    `Source: ${article.source_feed}`,
    `Published: ${article.published_at}`,
    `Existing newsroom summary: ${article.summary}`,
    `Published article body:\n${article.content_md.slice(0, MAX_SOURCE_BODY_CHARACTERS)}`,
  ].join('\n')).join('\n\n---\n\n');
}

function fakeNewsletterDraft(articles: NewsletterArticle[]): NewsletterDraft {
  const dispatchLabel = articles.length === 1 ? 'dispatch' : 'dispatches';
  return {
    subject: `The AI Wire: ${articles.length} ${dispatchLabel} from the week`,
    intro: `The wire filed ${articles.length} ${dispatchLabel} this week. Here are the developments worth carrying forward.`,
    closing: 'The next signal is whether these releases become durable operating habits or remain isolated product surfaces.',
    stories: articles.map((article) => ({ article_id: article.id, summary: article.summary })),
  };
}

function normalizeNewsletterDraft(candidate: NewsletterDraft, articles: NewsletterArticle[]): NewsletterDraft {
  const subject = compact(String(candidate.subject ?? '')).slice(0, 180);
  const intro = compact(String(candidate.intro ?? ''));
  const closing = compact(String(candidate.closing ?? ''));
  const stories = Array.isArray(candidate.stories)
    ? candidate.stories.map((story) => ({
      article_id: Number(story.article_id),
      summary: compact(String(story.summary ?? '')).slice(0, MAX_STORY_SUMMARY_CHARACTERS),
    }))
    : [];
  const expectedIds = articles.map((article) => article.id);
  const actualIds = stories.map((story) => story.article_id);
  const validIds = actualIds.length === expectedIds.length
    && actualIds.every((id) => expectedIds.includes(id))
    && new Set(actualIds).size === actualIds.length;

  if (!subject || intro.length < 30 || closing.length < 20) {
    throw new Error('newsletter draft is missing a usable subject, intro, or closing');
  }
  if (!validIds) {
    throw new Error('newsletter draft must contain exactly one summary for every supplied article');
  }
  if (stories.some((story) => story.summary.length < 30)) {
    throw new Error('newsletter draft contains a story summary that is too short');
  }
  const summaries = new Map(stories.map((story) => [story.article_id, story.summary]));
  return {
    subject,
    intro,
    closing,
    stories: expectedIds.map((articleId) => ({ article_id: articleId, summary: summaries.get(articleId)! })),
  };
}

export async function generateNewsletterDraft(
  window: NewsletterWindow,
  articles: NewsletterArticle[],
  deps: NewsletterGenerateDeps = {}
): Promise<NewsletterDraft> {
  if (articles.length === 0) throw new Error('cannot draft a newsletter without published articles');
  const generate = deps.generateStructured ?? structured;
  if (process.env.FAKE_LLM === '1' && generate === structured) return fakeNewsletterDraft(articles);
  const sourcePacket = buildNewsletterSourcePacket(articles);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const retryHint = attempt === 1
        ? ''
        : `\n\nYour previous response was invalid. Return exactly ${articles.length} story objects, using these article IDs once each: ${articles.map((article) => article.id).join(', ')}.`;
      const candidate = await generate<NewsletterDraft>(
        loadPrompt('newsletter-system'),
        loadPrompt('newsletter-user', {
          period_start: window.periodStart,
          period_end: window.periodEnd,
          article_count: String(articles.length),
          articles: sourcePacket,
        }) + retryHint,
        NEWSLETTER_SCHEMA
      );
      return normalizeNewsletterDraft(candidate, articles);
    } catch (error) {
      lastError = error;
      console.warn(
        `[newsletter] draft attempt ${attempt} was invalid: `
        + `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  throw new Error(
    `newsletter draft was invalid after two attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(value: string, timeZone = NEWSLETTER_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(value));
}

function formatCalendarDate(value: string, timeZone = NEWSLETTER_TIME_ZONE): string {
  return formatDate(`${value}T12:00:00.000Z`, timeZone);
}

function articleTag(article: NewsletterArticle): string {
  return article.tags?.primary ?? 'industry';
}

export function renderNewsletterHtml(
  window: NewsletterWindow,
  articles: NewsletterArticle[],
  draft: NewsletterDraft,
  appUrl: string,
  timeZone = NEWSLETTER_TIME_ZONE
): string {
  const summaries = new Map(draft.stories.map((story) => [story.article_id, story.summary]));
  const dispatchLabel = articles.length === 1 ? 'dispatch' : 'dispatches';
  const periodLabel = `${formatDate(window.periodStart, timeZone)} – ${formatCalendarDate(window.weekEnding, timeZone)}`;
  const storyHtml = articles.map((article, index) => {
    const imageUrl = safeHttpUrl(article.thumbnail_url);
    const articleUrl = newsletterArticleUrl(article, appUrl);
    const image = imageUrl
      ? `<a href="${escapeHtml(articleUrl)}"><img src="${escapeHtml(imageUrl)}" alt="" width="132" style="width:132px;max-width:100%;height:auto;display:block;border:1px solid #191713;" /></a>`
      : '';
    const number = String(articles.length - index).padStart(2, '0');
    const metadataText = `${escapeHtml(article.source_feed)} ▸ ${escapeHtml(articleTag(article))} · filed ${escapeHtml(formatDate(article.published_at, timeZone))}`;
    const metadata = `<div style="font:500 10px/1.4 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#6B6459;">${metadataText}</div>`;
    const headline = `<h2 style="margin:7px 0 7px;font:700 24px/1.08 Newsreader,Georgia,serif;letter-spacing:-.015em;"><a href="${escapeHtml(articleUrl)}" style="color:#191713;text-decoration:none;">${escapeHtml(article.title)}</a></h2>`;
    const summary = `<p style="margin:0;color:#3B372F;font:16px/1.5 Newsreader,Georgia,serif;">${escapeHtml(summaries.get(article.id) ?? article.summary)}</p>`;
    const mobileImage = image
      ? `<tr><td class="story-mobile-image" style="padding:24px 0 14px;text-align:right;vertical-align:top;">${image}</td></tr>`
      : '';
    return `<tr>
      <td colspan="3" style="padding:0;">
        <table class="story-desktop" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="display:table;width:100%;border-collapse:collapse;"><tbody><tr>
          <td style="width:34px;padding:24px 0;border-bottom:1px solid rgba(25,23,19,.22);vertical-align:top;font:600 18px/1 'IBM Plex Mono',monospace;color:#C8361E;">${number}</td>
          <td style="padding:24px 16px 24px 0;border-bottom:1px solid rgba(25,23,19,.22);vertical-align:top;">${metadata}${headline}${summary}</td>
          ${image ? `<td style="width:132px;padding:24px 0;border-bottom:1px solid rgba(25,23,19,.22);vertical-align:top;">${image}</td>` : '<td style="width:132px;padding:24px 0;border-bottom:1px solid rgba(25,23,19,.22);"></td>'}
        </tr></tbody></table>
        <table class="story-mobile" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="display:none;width:100%;border-collapse:collapse;"><tbody>
          ${mobileImage}
          <tr><td class="story-mobile-copy" style="padding:${image ? '0 0 24px' : '24px 0'};border-bottom:1px solid rgba(25,23,19,.22);vertical-align:top;">
            <div style="margin:0 0 8px;font:500 10px/1.4 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#6B6459;"><span style="display:inline-block;margin-right:12px;font:600 18px/1 'IBM Plex Mono',monospace;color:#C8361E;">${number}</span>${metadataText}</div>
            ${headline}${summary}
          </td></tr>
        </tbody></table>
      </td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(draft.subject)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700;6..72,800&display=swap" rel="stylesheet">
<style>
  body{margin:0;background:#F4F0E8;color:#191713;font-family:Newsreader,Georgia,serif}
  a:hover{color:#C8361E!important}
  @media(max-width:650px){.email{padding-left:20px!important;padding-right:20px!important}.header-meta{display:block!important}.header-date{display:block!important;margin-top:6px!important}.footer-copy{display:block!important;max-width:none!important;margin-top:14px!important;text-align:left!important;white-space:normal!important}.story-desktop{display:none!important}.story-mobile{display:table!important;width:100%!important}.wordmark{font-size:52px!important}}
</style></head>
<body style="margin:0;background:#F4F0E8;background-image:radial-gradient(rgba(25,23,19,.035) 1px,transparent 1px);background-size:5px 5px;">
  <div class="email" style="max-width:760px;margin:0 auto;padding:0 54px 44px;background:#FDFBF6;">
    <header style="padding:0 0 22px;border-bottom:1px solid #191713;">
      <div aria-hidden="true" style="width:72px;height:3px;margin-bottom:24px;background-color:#C8361E;font-size:0;line-height:0;">&nbsp;</div>
      <div class="header-meta" style="display:flex;justify-content:space-between;gap:14px;font:500 10px/1.4 'IBM Plex Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:#6B6459;"><span style="color:#C8361E;">● Weekly dispatch</span><span class="header-date" style="flex:0 0 auto;white-space:nowrap;">${escapeHtml(periodLabel)}</span></div>
      <div class="masthead" style="margin-top:22px;"><div class="wordmark" style="font:800 76px/.88 Newsreader,Georgia,serif;letter-spacing:-.04em;white-space:nowrap;">The AI <em style="font-style:normal;font-weight:400;color:#C8361E;">Wire</em></div></div>
    </header>
    <section style="padding:28px 0 24px;border-bottom:1px solid rgba(25,23,19,.25);">
      <div style="margin:0 0 12px;color:#C8361E;font:600 10px/1.4 'IBM Plex Mono',monospace;letter-spacing:.15em;text-transform:uppercase;">The week in AI infrastructure</div>
      <h1 style="max-width:590px;margin:0;font:700 48px/1.02 Newsreader,Georgia,serif;letter-spacing:-.025em;">${escapeHtml(draft.subject)}</h1>
      <p style="max-width:580px;margin:15px 0 0;color:#3B372F;font:19px/1.5 Newsreader,Georgia,serif;">${escapeHtml(draft.intro)}</p>
    </section>
    <section style="padding:30px 0 32px;border-bottom:1px solid rgba(25,23,19,.25);">
      <div style="margin:0 0 12px;color:#6B6459;font:500 10px/1.4 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;"><span style="display:inline-block;margin-right:9px;padding:4px 8px;color:#FDFBF6;background:#C8361E;font-weight:600;">${articles.length} ${dispatchLabel}</span> human-reviewed · ${escapeHtml(periodLabel)}</div>
      <p style="margin:0;color:#3B372F;font:17px/1.5 Newsreader,Georgia,serif;">${escapeHtml(draft.closing)}</p>
    </section>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tbody>${storyHtml}</tbody></table>
    <footer style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-top:34px;padding-top:18px;border-top:3px solid #191713;"><div style="font:800 22px/1 Newsreader,Georgia,serif;letter-spacing:-.02em;">The AI <em style="font-style:normal;font-weight:400;color:#C8361E;">Wire</em></div><div class="footer-copy" style="max-width:none;color:#6B6459;font:9px/1.55 'IBM Plex Mono',monospace;letter-spacing:.08em;text-align:right;text-transform:uppercase;white-space:nowrap;">End of transmission · human-reviewed · <span style="white-space:nowrap;">${escapeHtml(formatCalendarDate(window.weekEnding, timeZone))}</span></div></footer>
  </div>
</body></html>`;
}

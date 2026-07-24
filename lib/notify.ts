import { SITE_NAME } from './config';
import type { Article } from './types';

// Review-ready notifications go out through Resend. The feature is opt-in:
// without RESEND_API_KEY and REVIEW_NOTIFY_EMAIL the send is skipped, and a
// failed send never breaks the pipeline — the article is already in review.

export interface NotifyDeps {
  fetchFn?: typeof fetch;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'http://localhost:3000';
}

function reviewReadyHtml(article: Article, thumbnailUrl: string | null, reviewUrl: string): string {
  const title = escapeHtml(article.title ?? 'Untitled');
  const summary = article.summary ? escapeHtml(article.summary) : '';
  const persona = article.persona ? escapeHtml(article.persona) : null;
  const tag = article.tags?.primary ? escapeHtml(article.tags.primary) : null;
  const byline = [persona && `By ${persona}`, tag && `Filed under ${tag}`].filter(Boolean).join(' · ');
  // Blob thumbnails are https URLs; placeholder data: URLs don't render in email clients.
  const thumbnail = thumbnailUrl?.startsWith('http')
    ? `<img src="${escapeHtml(thumbnailUrl)}" alt="" width="552" style="width:100%;height:auto;display:block;border-radius:4px;margin:0 0 20px;" />`
    : '';

  return `<div style="margin:0;padding:32px 16px;background-color:#F4F0E8;font-family:Georgia,'Times New Roman',serif;color:#191713;">
  <div style="max-width:600px;margin:0 auto;background-color:#FDFBF6;border:1px solid rgba(25,23,19,0.25);border-radius:6px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:3px solid #C8361E;">
      <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#C8361E;font-weight:bold;">${escapeHtml(SITE_NAME)}</div>
      <div style="font-size:12px;color:#6B6459;margin-top:4px;">A new dispatch is ready for your review</div>
    </div>
    <div style="padding:24px;">
      ${thumbnail}
      <h1 style="margin:0 0 8px;font-size:24px;line-height:1.25;font-weight:bold;">${title}</h1>
      ${byline ? `<div style="font-size:13px;color:#6B6459;margin:0 0 16px;">${byline}</div>` : ''}
      ${summary ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#403B33;">${summary}</p>` : ''}
      <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;padding:12px 24px;background-color:#C8361E;color:#FDFBF6;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;letter-spacing:0.5px;border-radius:4px;">Review article</a>
    </div>
    <div style="padding:16px 24px;border-top:1px solid rgba(25,23,19,0.15);font-size:12px;color:#6B6459;">
      Article #${article.id} · from the ${escapeHtml(article.source_feed)} feed
    </div>
  </div>
</div>`;
}

export async function sendReviewReadyEmail(
  article: Article,
  thumbnailUrl: string | null,
  deps: NotifyDeps = {}
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REVIEW_NOTIFY_EMAIL;
  if (!apiKey || !to) return false;

  const fetchFn = deps.fetchFn ?? fetch;
  const from = process.env.REVIEW_NOTIFY_FROM ?? `${SITE_NAME} <onboarding@resend.dev>`;
  const reviewUrl = `${appUrl()}/review/${article.id}`;

  try {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Ready for review: ${article.title ?? `article #${article.id}`}`,
        html: reviewReadyHtml(article, thumbnailUrl, reviewUrl),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.log(`[notify] article ${article.id}: Resend responded ${res.status} (${body})`);
      return false;
    }
    console.log(`[notify] article ${article.id}: review email sent to ${to}`);
    return true;
  } catch (err) {
    console.log(`[notify] article ${article.id}: email failed (${(err as Error).message})`);
    return false;
  }
}

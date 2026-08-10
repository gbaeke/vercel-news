import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_NEWSLETTER_MAX_ARTICLES,
  generateNewsletterDraft,
  getNewsletterArticles,
  newsletterWindowForWeekEnding,
  previousNewsletterWindow,
  renderNewsletterHtml,
  type NewsletterArticle,
  type NewsletterDraft,
  type NewsletterWindow,
} from './newsletter';
import { sendNewsletterEmail, type NewsletterMailConfig, type NewsletterMailResult } from './newsletterMailer';

export interface NewsletterRunConfig {
  appUrl: string;
  dryRun: boolean;
  weekEnding?: string;
  maxArticles?: number;
  outputDir?: string;
  mail?: NewsletterMailConfig;
}

export interface NewsletterRunDeps {
  now?: Date;
  getArticles?: (window: NewsletterWindow, maxArticles: number) => Promise<NewsletterArticle[]>;
  generateDraft?: (window: NewsletterWindow, articles: NewsletterArticle[]) => Promise<NewsletterDraft>;
  sendEmail?: (input: NewsletterMailConfig & { subject: string; html: string }) => Promise<NewsletterMailResult>;
  writeFile?: (filePath: string, html: string) => Promise<void>;
}

export interface NewsletterRunResult {
  window: NewsletterWindow;
  articles: NewsletterArticle[];
  draft: NewsletterDraft;
  html: string;
  previewPath: string | null;
  sent: boolean;
  providerId: string | null;
}

function defaultWriteFile(filePath: string, html: string): Promise<void> {
  return fs.mkdir(path.dirname(filePath), { recursive: true })
    .then(() => fs.writeFile(filePath, html, 'utf8'));
}

export async function runWeeklyNewsletter(
  config: NewsletterRunConfig,
  deps: NewsletterRunDeps = {}
): Promise<NewsletterRunResult> {
  if (!config.appUrl.trim()) throw new Error('APP_URL is not set');
  const window = config.weekEnding
    ? newsletterWindowForWeekEnding(config.weekEnding)
    : previousNewsletterWindow(deps.now);
  const maxArticles = config.maxArticles ?? DEFAULT_NEWSLETTER_MAX_ARTICLES;
  const getArticles = deps.getArticles ?? getNewsletterArticles;
  const articles = await getArticles(window, maxArticles);
  if (articles.length === 0) {
    throw new Error(`No published articles were found for the newsletter window ending ${window.weekEnding}.`);
  }
  console.log(`[newsletter] found ${articles.length} unique published article(s) for ${window.periodStart} through ${window.periodEnd}`);

  const generateDraft = deps.generateDraft ?? generateNewsletterDraft;
  const draft = await generateDraft(window, articles);
  const html = renderNewsletterHtml(window, articles, draft, config.appUrl);

  if (config.dryRun) {
    const outputDir = config.outputDir ?? 'newsletter-previews';
    const previewPath = path.resolve(outputDir, `weekly-newsletter-${window.weekEnding}.html`);
    await (deps.writeFile ?? defaultWriteFile)(previewPath, html);
    console.log(`[newsletter] dry-run: wrote inspectable preview to ${previewPath}`);
    return { window, articles, draft, html, previewPath, sent: false, providerId: null };
  }

  if (!config.mail) throw new Error('newsletter mail configuration is required unless NEWSLETTER_DRY_RUN is enabled');
  const sendEmail = deps.sendEmail ?? sendNewsletterEmail;
  const sent = await sendEmail({ ...config.mail, subject: draft.subject, html });
  console.log(`[newsletter] sent weekly newsletter to ${config.mail.recipients.length} recipient(s)${sent.id ? ` (Resend ${sent.id})` : ''}`);
  return { window, articles, draft, html, previewPath: null, sent: true, providerId: sent.id };
}

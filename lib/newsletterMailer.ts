import { SITE_NAME } from './config';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const DEFAULT_REVIEW_NOTIFY_FROM = `${SITE_NAME} <onboarding@resend.dev>`;

export interface NewsletterMailConfig {
  apiKey: string;
  from: string;
  recipients: string[];
  replyTo?: string;
}

export interface NewsletterMailInput extends NewsletterMailConfig {
  subject: string;
  html: string;
}

export interface NewsletterMailResult {
  id: string | null;
}

export interface NewsletterMailDeps {
  fetchFn?: typeof fetch;
}

export function newsletterMailConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): NewsletterMailConfig {
  const recipientsValue = env.NEWSLETTER_RECIPIENTS?.trim()
    || env.REVIEW_NOTIFY_EMAIL?.trim();
  if (!recipientsValue) {
    throw new Error('NEWSLETTER_RECIPIENTS or REVIEW_NOTIFY_EMAIL is not set');
  }
  return {
    apiKey: env.RESEND_API_KEY?.trim() ?? '',
    from: env.NEWSLETTER_FROM?.trim()
      || env.REVIEW_NOTIFY_FROM?.trim()
      || DEFAULT_REVIEW_NOTIFY_FROM,
    recipients: parseNewsletterRecipients(recipientsValue),
    replyTo: env.NEWSLETTER_REPLY_TO?.trim() || undefined,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseNewsletterRecipients(value: string): string[] {
  const recipients = value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = [...new Set(recipients)];
  const invalid = unique.filter((recipient) => !EMAIL_PATTERN.test(recipient));
  if (unique.length === 0) throw new Error('NEWSLETTER_RECIPIENTS must contain at least one email address');
  if (invalid.length > 0) throw new Error(`invalid newsletter recipient(s): ${invalid.join(', ')}`);
  return unique;
}

export function validateNewsletterMailConfig(config: NewsletterMailConfig): void {
  if (!config.apiKey.trim()) throw new Error('RESEND_API_KEY is not set');
  if (!config.from.trim()) throw new Error('NEWSLETTER_FROM is not set');
  if (!EMAIL_PATTERN.test(config.from.match(/<([^>]+)>/)?.[1] ?? config.from.trim())) {
    throw new Error('NEWSLETTER_FROM must contain a valid sender email address');
  }
  if (config.recipients.length === 0) throw new Error('newsletter recipients are not configured');
  if (config.recipients.some((recipient) => !EMAIL_PATTERN.test(recipient))) {
    throw new Error('newsletter recipients contain an invalid email address');
  }
  if (config.replyTo && !EMAIL_PATTERN.test(config.replyTo)) {
    throw new Error('NEWSLETTER_REPLY_TO must be a valid email address');
  }
}

export async function sendNewsletterEmail(
  input: NewsletterMailInput,
  deps: NewsletterMailDeps = {}
): Promise<NewsletterMailResult> {
  validateNewsletterMailConfig(input);
  const fetchFn = deps.fetchFn ?? fetch;
  const body: Record<string, unknown> = {
    from: input.from,
    to: input.recipients,
    subject: input.subject,
    html: input.html,
  };
  if (input.replyTo) body.reply_to = input.replyTo;

  const response = await fetchFn(RESEND_EMAILS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Resend newsletter send failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }
  let id: string | null = null;
  try {
    const parsed = JSON.parse(responseText) as { id?: unknown };
    if (typeof parsed.id === 'string') id = parsed.id;
  } catch {
    // Resend normally returns JSON, but a successful provider response is still
    // a successful send if a proxy strips the response body.
  }
  return { id };
}

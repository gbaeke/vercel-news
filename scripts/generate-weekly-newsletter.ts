import dotenv from 'dotenv';
import { newsletterMailConfigFromEnv } from '../lib/newsletterMailer';
import { runWeeklyNewsletter, type NewsletterRunConfig } from '../lib/newsletterRunner';

dotenv.config({ path: '.env.local' });

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function booleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase() ?? 'false';
  if (['1', 'true', 'yes'].includes(value)) return true;
  if (['0', 'false', 'no', ''].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${name} must be an integer between 1 and 100`);
  }
  return value;
}

function validateAppUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    return value.replace(/\/+$/, '');
  } catch {
    throw new Error('APP_URL must be an absolute http(s) URL');
  }
}

export function configFromEnv(): NewsletterRunConfig {
  // The action connects to Neon directly, so fail before the LLM call when
  // the required production data connection is missing.
  requiredEnv('DATABASE_URL');
  const appUrl = validateAppUrl(requiredEnv('APP_URL'));
  const dryRun = booleanEnv('NEWSLETTER_DRY_RUN');
  const config: NewsletterRunConfig = {
    appUrl,
    dryRun,
    weekEnding: process.env.NEWSLETTER_WEEK_ENDING?.trim() || undefined,
    maxArticles: positiveIntegerEnv('NEWSLETTER_MAX_ARTICLES', 20),
    outputDir: process.env.NEWSLETTER_OUTPUT_DIR?.trim() || 'newsletter-previews',
  };

  if (!dryRun) {
    requiredEnv('RESEND_API_KEY');
    config.mail = newsletterMailConfigFromEnv(process.env);
  }
  return config;
}

async function main(): Promise<void> {
  const config = configFromEnv();
  console.log(
    `[newsletter] starting ${config.dryRun ? 'dry-run' : 'send'}; `
    + `week ending ${config.weekEnding ?? '(previous local day)'}; max articles ${config.maxArticles}`
  );
  await runWeeklyNewsletter(config);
}

main().catch((error) => {
  console.error(`[newsletter] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

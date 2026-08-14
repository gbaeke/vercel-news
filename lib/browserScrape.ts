import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { parsePublicHttpUrl, resolvePublicAddresses } from './safeFetch';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RENDERED_HTML_BYTES = 5 * 1024 * 1024;
const BLOCKED_RESOURCE_TYPES = new Set(['font', 'image', 'media']);

function normalizedHost(hostname: string): string {
  return hostname.replace(/^www\./i, '').toLowerCase();
}

function browserHostRestrictions(): string[] | null {
  const configured = process.env.BROWSER_SCRAPE_HOSTS
    ?.split(',')
    .map((host) => normalizedHost(host.trim()))
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : null;
}

function hostMatchesRestriction(hostname: string): boolean {
  const host = normalizedHost(hostname);
  const restrictions = browserHostRestrictions();
  return !restrictions || restrictions.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function browserScrapeHostAllowed(rawUrl: string): boolean {
  try {
    const url = parsePublicHttpUrl(rawUrl);
    return hostMatchesRestriction(url.hostname);
  } catch {
    return false;
  }
}

function localChromePath(): string | null {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => existsSync(path)) ?? null;
}

async function launchBrowser(): Promise<Browser> {
  const localPath = process.env.VERCEL ? null : localChromePath();
  if (localPath) {
    return puppeteer.launch({
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
      executablePath: localPath,
      headless: true,
    });
  }

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: { deviceScaleFactor: 1, height: 900, width: 1280 },
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  });
}

/**
 * Render a JavaScript-heavy page and return its post-hydration DOM. Normal
 * scraping continues to use the cheaper SSRF-checked HTTP path; this fallback
 * validates the original URL and every browser-loaded host before continuing.
 */
export async function renderJavaScriptPage(rawUrl: string): Promise<string | null> {
  const url = parsePublicHttpUrl(rawUrl);
  if (!hostMatchesRestriction(url.hostname)) return null;
  await resolvePublicAddresses(url);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const pageHost = normalizedHost(url.hostname);
    const publicHostChecks = new Map<string, Promise<boolean>>();

    const isPublicRequest = (requestUrl: URL): Promise<boolean> => {
      const host = requestUrl.hostname.toLowerCase();
      const cached = publicHostChecks.get(host);
      if (cached) return cached;
      const check = resolvePublicAddresses(requestUrl).then(
        () => true,
        () => false
      );
      publicHostChecks.set(host, check);
      return check;
    };

    await page.setJavaScriptEnabled(true);
    await page.setUserAgent(
      'Mozilla/5.0 (compatible; AIWireBot/1.0; +https://news.baeke.info/bot)'
    );
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      void (async () => {
        if (request.isInterceptResolutionHandled()) return;
        let requestUrl: URL;
        try {
          requestUrl = new URL(request.url());
        } catch {
          await request.abort();
          return;
        }

        const sameOriginNavigation = !request.isNavigationRequest()
          || normalizedHost(requestUrl.hostname) === pageHost;
        const allowedScheme = requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:';
        const allowedResource = !BLOCKED_RESOURCE_TYPES.has(request.resourceType());
        const allowed = allowedScheme
          && sameOriginNavigation
          && allowedResource
          && await isPublicRequest(requestUrl);

        if (request.isInterceptResolutionHandled()) return;
        if (allowed) await request.continue();
        else await request.abort();
      })().catch(() => {
        if (!request.isInterceptResolutionHandled()) {
          void request.abort().catch(() => {
            // The page may close while an intercepted request is being resolved.
          });
        }
      });
    });

    await page.goto(url.toString(), {
      timeout: Number(process.env.BROWSER_SCRAPE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => Boolean(document.body?.innerText?.trim()),
      { timeout: 8_000 }
    ).catch(() => {
      // Some valid pages keep loading background resources indefinitely.
    });

    const html = await page.content();
    if (Buffer.byteLength(html, 'utf8') > MAX_RENDERED_HTML_BYTES) {
      throw new Error(`rendered page exceeds the ${MAX_RENDERED_HTML_BYTES}-byte limit`);
    }
    return html;
  } finally {
    await browser.close();
  }
}

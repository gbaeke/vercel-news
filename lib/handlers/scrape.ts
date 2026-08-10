import { extractFromHtml } from '@extractus/article-extractor';
import { query } from '../db';
import { htmlToText, htmlToTextWithLinks } from '../text';
import {
  assessSource,
  MAX_SOURCE_LENGTH,
  MIN_PAGE_SOURCE_LENGTH,
  MIN_RSS_SOURCE_LENGTH,
} from '../sourceQuality';
import type { Article } from '../types';
import { safeFetchText } from '../safeFetch';
import {
  fetchYouTubeTranscript,
  formatTranscript,
  MAX_VIDEO_TRANSCRIPT_LENGTH,
  prepareTranscriptForPipeline,
  type TranscriptSummarizer,
  type YouTubeTranscriptFetcher,
} from '../youtubeTranscript';

const MAX_FETCH_ATTEMPTS = 2;
const MAX_SCRAPE_CYCLES = 3;
const RETRY_DELAY_MINUTES = 10;
const TRANSCRIPT_RETRY_DELAY_MINUTES = 1;
const MAX_TRANSCRIPT_JOB_AGE_MS = 50 * 60 * 1000;
const MIN_TRANSCRIPT_LENGTH = 200;

export interface ScrapeDeps {
  extract?: (url: string) => Promise<string | null>;
  sleep?: (milliseconds: number) => Promise<void>;
  fetchYouTubeTranscript?: YouTubeTranscriptFetcher;
  summarizeTranscript?: TranscriptSummarizer;
  sourceProvider?: string;
}

async function failYouTubeScrape(article: Article, reason: string): Promise<string> {
  await query(
    `UPDATE articles SET
       status = 'failed', failed_from = 'new', error = $1, claimed_at = NULL,
       source_last_attempt_at = now(), source_next_retry_at = NULL,
       source_fallback_reason = $1, updated_at = now()
     WHERE id = $2`,
    [`YouTube transcript failed: ${reason}`, article.id]
  );
  return 'failed';
}

async function retryYouTubeScrape(article: Article, reason: string): Promise<string> {
  const cycle = (article.source_attempt_count ?? 0) + 1;
  if (cycle >= MAX_SCRAPE_CYCLES) {
    return failYouTubeScrape(article, `provider failed after ${cycle} attempts: ${reason}`);
  }
  await query(
    `UPDATE articles SET
       status = 'scrape_retry', claimed_at = NULL, source_attempt_count = $1,
       source_last_attempt_at = now(), source_next_retry_at = now() + ($2 * interval '1 minute'),
       source_fallback_reason = $3, updated_at = now()
     WHERE id = $4`,
    [cycle, TRANSCRIPT_RETRY_DELAY_MINUTES, reason, article.id]
  );
  return 'scrape_retry';
}

async function scrapeYouTube(article: Article, deps: ScrapeDeps): Promise<string> {
  const fetchTranscript = deps.fetchYouTubeTranscript ?? fetchYouTubeTranscript;
  const provider = deps.sourceProvider ?? 'supadata';
  if (article.source_external_job_id && article.source_job_started_at) {
    const jobAge = Date.now() - new Date(article.source_job_started_at).getTime();
    if (Number.isFinite(jobAge) && jobAge > MAX_TRANSCRIPT_JOB_AGE_MS) {
      return failYouTubeScrape(article, 'speech-to-text job did not finish within 50 minutes');
    }
  }

  let result;
  try {
    result = await fetchTranscript({
      url: article.trigger_url,
      jobId: article.source_external_job_id,
    });
  } catch (error) {
    return retryYouTubeScrape(article, (error as Error).message);
  }

  if (result.kind === 'unavailable') {
    return failYouTubeScrape(article, result.reason);
  }
  if (result.kind === 'pending') {
    await query(
      `UPDATE articles SET
         status = 'scrape_retry', claimed_at = NULL,
         source_attempt_count = source_attempt_count + CASE WHEN source_external_job_id IS NULL THEN 1 ELSE 0 END,
         source_last_attempt_at = now(), source_next_retry_at = now() + ($1 * interval '1 minute'),
         source_extraction_method = 'youtube-asr-pending', source_provider = $2,
         source_external_job_id = $3, source_job_started_at = COALESCE(source_job_started_at, now()),
         source_fallback_reason = 'speech-to-text job is still processing', updated_at = now()
       WHERE id = $4`,
      [TRANSCRIPT_RETRY_DELAY_MINUTES, provider, result.jobId, article.id]
    );
    return 'scrape_retry';
  }

  const transcript = formatTranscript(result.segments);
  if (transcript.length < MIN_TRANSCRIPT_LENGTH) {
    return failYouTubeScrape(article, `transcript is only ${transcript.length} characters`);
  }
  if (transcript.length > MAX_VIDEO_TRANSCRIPT_LENGTH) {
    return failYouTubeScrape(
      article,
      `transcript exceeds the ${MAX_VIDEO_TRANSCRIPT_LENGTH}-character safety limit`
    );
  }

  const prepared = await prepareTranscriptForPipeline(transcript, deps.summarizeTranscript);
  await query(
    `UPDATE articles SET
       trigger_content = $1, source_transcript = $2, status = 'scraped', claimed_at = NULL,
       source_extraction_method = $3, source_content_length = $4,
       source_attempt_count = source_attempt_count + CASE WHEN source_external_job_id IS NULL THEN 1 ELSE 0 END,
       source_last_attempt_at = now(),
       source_next_retry_at = NULL, source_fallback_reason = $5, source_capped = false,
       source_transcript_lang = $6, source_provider = $7,
       source_external_job_id = NULL, source_job_started_at = NULL, updated_at = now()
     WHERE id = $8`,
    [
      prepared.content,
      transcript,
      result.method,
      transcript.length,
      prepared.summarized ? `long transcript analyzed in ${prepared.chunkCount} sections` : null,
      result.language,
      provider,
      article.id,
    ]
  );
  return 'scraped';
}

function collectArticleBodies(value: unknown, bodies: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectArticleBodies(item, bodies);
    return bodies;
  }
  if (typeof value !== 'object' || value === null) return bodies;

  const record = value as Record<string, unknown>;
  if (typeof record.articleBody === 'string') bodies.push(record.articleBody);
  for (const child of Object.values(record)) collectArticleBodies(child, bodies);
  return bodies;
}

// Some publishers render the visible article dynamically but include a stable
// Article JSON-LD payload in the response. It is an independent fallback to
// readability extraction and avoids relying on social-preview metadata.
export function extractStructuredArticleBody(html: string): string | null {
  const candidates: string[] = [];
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      collectArticleBodies(JSON.parse(match[1]), candidates);
    } catch {
      // Ignore malformed structured data and let the readability candidate win.
    }
  }
  return candidates.sort((a, b) => htmlToText(b).length - htmlToText(a).length)[0] ?? null;
}

async function defaultExtract(url: string): Promise<string | null> {
  const res = await safeFetchText(url, {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    timeoutMs: 10_000,
    maxBytes: 5 * 1024 * 1024,
    allowedContentTypes: ['text/html', 'application/xhtml+xml', 'text/plain'],
  });
  if (!res.ok) return null;
  const html = res.text;
  const article = await extractFromHtml(html, url);
  const candidates = [article?.content ?? null, extractStructuredArticleBody(html)]
    .filter((candidate): candidate is string => Boolean(candidate));
  return candidates.sort((a, b) => htmlToText(b).length - htmlToText(a).length)[0] ?? null;
}

export async function scrapeHandler(article: Article, deps: ScrapeDeps = {}): Promise<string> {
  if (article.source_type === 'youtube' && article.youtube_video_id) {
    return scrapeYouTube(article, deps);
  }

  const extract = deps.extract ?? defaultExtract;
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  let content: string | null = null;
  let method: 'page' | 'rss-fallback' | null = null;
  let fallbackReason: string | null = null;
  let sourceCapped = false;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const extracted = await extract(article.trigger_url);
      const plainText = extracted ? htmlToText(extracted) : '';
      sourceCapped ||= plainText.length > MAX_SOURCE_LENGTH;
      const assessment = assessSource(plainText, MIN_PAGE_SOURCE_LENGTH);
      if (assessment.ok) {
        content = htmlToTextWithLinks(extracted!, article.trigger_url);
        method = 'page';
        break;
      }
      fallbackReason = `page extraction ${assessment.reason ?? 'was unusable'}`;
    } catch (err) {
      fallbackReason = `page extraction failed: ${(err as Error).message}`;
      console.log(`[scrape] article ${article.id}: ${fallbackReason}`);
    }
    if (attempt < MAX_FETCH_ATTEMPTS) {
      await sleep(250);
    }
  }

  const rssContent = article.source_rss_content ?? article.trigger_content;
  if (!content && rssContent) {
    const plainFallback = htmlToText(rssContent);
    sourceCapped ||= plainFallback.length > MAX_SOURCE_LENGTH;
    const assessment = assessSource(plainFallback, MIN_RSS_SOURCE_LENGTH);
    if (assessment.ok) {
      content = htmlToTextWithLinks(rssContent, article.trigger_url);
      method = 'rss-fallback';
    } else {
      fallbackReason = [fallbackReason, `RSS fallback ${assessment.reason ?? 'was unusable'}`]
        .filter(Boolean)
        .join('; ');
    }
  }

  if (!content) {
    const cycle = (article.source_attempt_count ?? 0) + 1;
    const reason = fallbackReason ?? 'no usable content from page extraction or RSS fallback';
    if (cycle >= MAX_SCRAPE_CYCLES) {
      await query(
        `UPDATE articles SET
           status = 'failed', failed_from = 'new', error = $1, claimed_at = NULL,
           source_attempt_count = $3, source_last_attempt_at = now(), source_next_retry_at = NULL,
           source_extraction_method = 'none', source_fallback_reason = $1, source_capped = $2, updated_at = now()
         WHERE id = $4`,
        [`scrape failed after ${cycle} cycles: ${reason}`, sourceCapped, cycle, article.id]
      );
      return 'failed';
    }

    await query(
      `UPDATE articles SET
         status = 'scrape_retry', claimed_at = NULL, source_attempt_count = $1,
         source_last_attempt_at = now(), source_next_retry_at = now() + ($2 * interval '1 minute'),
         source_extraction_method = 'none', source_fallback_reason = $3, source_capped = $4, updated_at = now()
       WHERE id = $5`,
      [cycle, RETRY_DELAY_MINUTES, reason, sourceCapped, article.id]
    );
    console.log(`[scrape] article ${article.id}: retrying later (${reason})`);
    return 'scrape_retry';
  }

  console.log(`[scrape] article ${article.id}: succeeded via ${method}`);
  await query(
    `UPDATE articles SET
       trigger_content = $1, status = 'scraped', claimed_at = NULL,
       source_extraction_method = $2, source_content_length = $3,
       source_attempt_count = $4, source_last_attempt_at = now(), source_next_retry_at = NULL,
       source_fallback_reason = $5, source_capped = false, updated_at = now()
     WHERE id = $6`,
    [
      content,
      method,
      content.length,
      (article.source_attempt_count ?? 0) + 1,
      method === 'rss-fallback' ? fallbackReason : null,
      article.id,
    ]
  );
  return 'scraped';
}

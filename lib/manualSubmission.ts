import { enqueueArticle, type EnqueueArticleResult } from './articleQueue';

const MAX_STORY_URL_LENGTH = 2_048;

export type ManualStoryResult =
  | { ok: false; error: string }
  | { ok: true; url: string; queue: EnqueueArticleResult };

export async function submitManualStory(rawUrl: unknown): Promise<ManualStoryResult> {
  if (typeof rawUrl !== 'string') {
    return { ok: false, error: 'Enter a story URL.' };
  }

  const url = rawUrl.trim();
  if (!url) return { ok: false, error: 'Enter a story URL.' };
  if (url.length > MAX_STORY_URL_LENGTH) {
    return { ok: false, error: 'That URL is too long.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'Enter a valid absolute URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'The story URL must use http or https.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Story URLs cannot contain a username or password.' };
  }

  const sourceFeed = parsed.hostname.replace(/^www\./i, '') || 'manual';
  const queue = await enqueueArticle({
    sourceFeed,
    url,
    title: null,
    content: null,
  });
  return { ok: true, url, queue };
}

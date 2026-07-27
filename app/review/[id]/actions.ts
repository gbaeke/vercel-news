'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { runTick } from '../../../lib/tick';
import { ingestFeeds } from '../../../lib/ingest';
import { enqueueArticleAudioById, runAudioTick } from '../../../lib/audio';
import {
  approveAndPublishById,
  requestRewriteById,
  requestNewImageById,
  declineArticleById,
  retryArticleById,
  unpublishArticleById,
  deleteArticleById,
  type ReviewMutationResult,
} from '../../../lib/reviewActions';
import { parseArticleId, validateRewriteFeedback } from '../../../lib/reviewInput';

type FeedbackKind = 'notice' | 'error';

const MAX_FEEDBACK_MESSAGE_LENGTH = 1_500;

function feedbackUrl(path: string, kind: FeedbackKind, message: string): string {
  const safeMessage = message.length <= MAX_FEEDBACK_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_FEEDBACK_MESSAGE_LENGTH - 1)}…`;
  const params = new URLSearchParams({ [kind]: safeMessage });
  return `${path}?${params}`;
}

function articlePath(id: number): string {
  return `/review/${id}`;
}

function validArticleId(value: unknown): number {
  const id = parseArticleId(value);
  if (id === null) {
    redirect(feedbackUrl('/review', 'error', 'That article reference is invalid.'));
  }
  return id;
}

function mutationFailureMessage(result: ReviewMutationResult): string | null {
  if (result.ok) return null;
  if (result.reason === 'not_found') return 'That article no longer exists.';
  return `The article is now “${result.status}”, so that action was not applied. Refresh and try again if needed.`;
}

function logUnexpected(action: string, context: Record<string, unknown>, error: unknown): void {
  console.error(`[desk] ${action} failed`, context, error);
}

function revalidateArticleViews(): void {
  revalidatePath('/');
  revalidatePath('/articles/[slug]', 'page');
  revalidatePath('/podcast.xml');
  revalidatePath('/review');
}

export async function approveArticle(rawId: number) {
  const id = validArticleId(rawId);
  let result: Awaited<ReturnType<typeof approveAndPublishById>>;
  try {
    result = await approveAndPublishById(id);
  } catch (error) {
    logUnexpected('approve and publish', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not approve this article right now. Please try again.'));
  }

  revalidateArticleViews();
  if (!result.ok) {
    redirect(feedbackUrl(articlePath(id), 'error', mutationFailureMessage(result) ?? 'Could not approve this article.'));
  }
  if (result.outcome === 'queued') {
    redirect(
      feedbackUrl(
        articlePath(id),
        'error',
        'The article was approved, but publishing failed. It remains queued and the next scheduled run will retry it.'
      )
    );
  }
  redirect(feedbackUrl(articlePath(id), 'notice', 'Article published.'));
}

export async function requestRewrite(rawId: number, formData: FormData) {
  const id = validArticleId(rawId);
  const feedback = validateRewriteFeedback(formData.get('feedback'));
  if (!feedback.ok) {
    redirect(feedbackUrl(articlePath(id), 'error', feedback.error));
  }

  let result: ReviewMutationResult;
  try {
    result = await requestRewriteById(id, feedback.value);
  } catch (error) {
    logUnexpected('request rewrite', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not request a rewrite right now. Please try again.'));
  }

  revalidatePath('/review');
  const failure = mutationFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Rewrite requested.'));
}

export async function requestNewImage(rawId: number) {
  const id = validArticleId(rawId);
  let result: ReviewMutationResult;
  try {
    result = await requestNewImageById(id);
  } catch (error) {
    logUnexpected('request new image', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not request a new thumbnail right now. Please try again.'));
  }

  revalidatePath('/review');
  const failure = mutationFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'New thumbnail requested.'));
}

export async function declineArticle(rawId: number) {
  const id = validArticleId(rawId);
  let result: ReviewMutationResult;
  try {
    result = await declineArticleById(id);
  } catch (error) {
    logUnexpected('decline article', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not decline this article right now. Please try again.'));
  }

  revalidatePath('/review');
  const failure = mutationFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Article declined.'));
}

export async function retryArticle(rawId: number) {
  const id = validArticleId(rawId);
  let result: ReviewMutationResult;
  try {
    result = await retryArticleById(id);
  } catch (error) {
    logUnexpected('retry article', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not retry this article right now. Please try again.'));
  }

  revalidatePath('/review');
  const failure = mutationFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Article queued for retry.'));
}

export async function unpublishArticle(rawId: number) {
  const id = validArticleId(rawId);
  let result: ReviewMutationResult;
  try {
    result = await unpublishArticleById(id);
  } catch (error) {
    logUnexpected('unpublish article', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not unpublish this article right now. Please try again.'));
  }

  revalidateArticleViews();
  const failure = mutationFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Article unpublished and returned to review.'));
}

export async function retryArticleAudio(rawId: number) {
  const id = validArticleId(rawId);
  let result: Awaited<ReturnType<typeof enqueueArticleAudioById>>;
  try {
    result = await enqueueArticleAudioById(id, { forceRetry: true });
  } catch (error) {
    logUnexpected('queue article audio', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not queue the audio right now. Please try again.'));
  }

  revalidateArticleViews();
  if (!result.ok) {
    const message = result.reason === 'not_found'
      ? 'That article no longer exists.'
      : 'Only a published article can be narrated.';
    redirect(feedbackUrl(articlePath(id), 'error', message));
  }
  redirect(feedbackUrl(articlePath(id), 'notice', 'Audio queued. The next processing run will generate it.'));
}

// The detail page is gone once the row is, so land the operator back on the
// desk with a receipt instead of a 404.
export async function deleteArticle(rawId: number) {
  const id = validArticleId(rawId);
  let result: ReviewMutationResult;
  try {
    result = await deleteArticleById(id);
  } catch (error) {
    logUnexpected('delete article', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not delete this article right now. Please try again.'));
  }

  revalidateArticleViews();
  const failure = mutationFailureMessage(result);
  if (failure) redirect(feedbackUrl('/review', 'error', failure));
  redirect(feedbackUrl('/review', 'notice', `Article #${id} deleted — it will not be ingested again.`));
}

const MAX_TICK_SUMMARY_ITEMS = 8;
const MAX_TICK_MESSAGE_LENGTH = 1_400;

function shortened(value: string, max = 160): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export async function runTickNow() {
  let ingested: Awaited<ReturnType<typeof ingestFeeds>>;
  let processed: Awaited<ReturnType<typeof runTick>>;
  let audio: Awaited<ReturnType<typeof runAudioTick>>;
  try {
    ingested = await ingestFeeds();
    processed = await runTick();
    audio = await runAudioTick();
  } catch (error) {
    logUnexpected('run tick now', {}, error);
    redirect(
      feedbackUrl(
        '/review',
        'error',
        'Processing could not finish because a service was unavailable. No completed work was rolled back; please try again.'
      )
    );
  }

  if (processed.some((p) => p.to === 'published')) {
    revalidatePath('/');
    revalidatePath('/articles/[slug]', 'page');
  }
  if (audio.some((item) => item.to === 'ready')) {
    revalidatePath('/podcast.xml');
    revalidatePath('/articles/[slug]', 'page');
  }
  revalidatePath('/review');

  // Summarize per feed, then per article: each article's last transition is
  // where it ended up after this tick.
  const feedParts = ingested.slice(0, MAX_TICK_SUMMARY_ITEMS).map((r) =>
    r.error ? `${r.feed} failed (${shortened(r.error)})` : `${r.feed} +${r.inserted}`
  );
  if (ingested.length > MAX_TICK_SUMMARY_ITEMS) {
    feedParts.push(`+${ingested.length - MAX_TICK_SUMMARY_ITEMS} more feeds`);
  }

  const finalState = new Map<number, string>();
  for (const p of processed) finalState.set(p.id, p.to);
  const articleStates = Array.from(finalState);
  const articleParts = articleStates
    .slice(0, MAX_TICK_SUMMARY_ITEMS)
    .map(([id, to]) => `#${id} → ${to}`);
  if (articleStates.length > MAX_TICK_SUMMARY_ITEMS) {
    articleParts.push(`+${articleStates.length - MAX_TICK_SUMMARY_ITEMS} more articles`);
  }

  const summary = shortened([
    feedParts.length > 0 ? `ingest: ${feedParts.join(', ')}` : 'ingest: no feeds configured',
    articleParts.length > 0 ? `processed: ${articleParts.join(', ')}` : 'processed: queue empty',
    audio.length > 0
      ? `audio: ${audio.map((item) => `#${item.articleId} → ${item.to}`).join(', ')}`
      : 'audio: queue empty',
  ].join(' · '), MAX_TICK_MESSAGE_LENGTH);

  const key = ingested.some((r) => r.error)
    || processed.some((p) => p.to === 'failed')
    || audio.some((item) => item.to === 'failed')
    ? 'error'
    : 'notice';
  redirect(feedbackUrl('/review', key, `Processing complete — ${summary}`));
}

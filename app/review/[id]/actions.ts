'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { releasePendingScrapeRetries, runTick } from '../../../lib/tick';
import { ingestFeeds } from '../../../lib/ingest';
import { enqueueArticleAudioById, runAudioTick } from '../../../lib/audio';
import {
  approveAndPublishById,
  approveRssFirstReviewById,
  approveRssFinalReviewAndPublishById,
  requestRewriteById,
  requestNewImageById,
  refreshArticleSourceById,
  declineArticleById,
  retryArticleById,
  unpublishArticleById,
  deleteArticleById,
  type ReviewMutationResult,
} from '../../../lib/reviewActions';
import { parseArticleId, validateRewriteFeedback } from '../../../lib/reviewInput';
import { requireReviewSession } from '../../../lib/reviewSession';
import {
  approveArticleDiagramById,
  deleteArticleDiagramById,
  generateArticleDiagramById,
  parseArticleDiagramInput,
  parseEditableArticleDiagram,
  parsePlacementAfterParagraph,
  saveArticleDiagramById,
  updateArticleDiagramPlacementById,
  ArticleDiagramGenerationError,
  type DiagramMutationResult,
} from '../../../lib/articleDiagrams';

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
  await requireReviewSession();
  const id = validArticleId(rawId);
  let firstReview: Awaited<ReturnType<typeof approveRssFirstReviewById>>;
  try {
    firstReview = await approveRssFirstReviewById(id);
  } catch (error) {
    logUnexpected('approve RSS source', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not approve this article right now. Please try again.'));
  }

  if (firstReview.ok) {
    revalidatePath('/review');
    redirect(feedbackUrl(articlePath(id), 'notice', 'Source approved. It is queued for drafting; no thumbnail or publication has been authorized yet.'));
  }

  let finalReview: Awaited<ReturnType<typeof approveRssFinalReviewAndPublishById>>;
  try {
    finalReview = await approveRssFinalReviewAndPublishById(id);
  } catch (error) {
    logUnexpected('approve RSS draft', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not approve this draft right now. Please try again.'));
  }

  if (finalReview.ok) {
    revalidateArticleViews();
    if (finalReview.outcome === 'queued') {
      redirect(feedbackUrl(articlePath(id), 'error', 'Final approval was recorded, but publishing failed. It remains queued and the next scheduled run will retry it.'));
    }
    redirect(feedbackUrl(articlePath(id), 'notice', 'Final approval recorded. Thumbnail generated and article published.'));
  }

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
  await requireReviewSession();
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
  await requireReviewSession();
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

function diagramFailureMessage(result: DiagramMutationResult): string | null {
  return result.ok ? null : result.message;
}

function errorSummary(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, 500) };
  }
  return { name: typeof error, message: String(error).slice(0, 500) };
}

function diagramGenerationFailure(error: unknown, articleId: number): string {
  if (error instanceof ArticleDiagramGenerationError) {
    console.error('[desk] generate article diagram failed', {
      articleId,
      stage: error.stage,
      error: errorSummary(error.cause),
    });
    if (error.stage === 'validation') {
      return 'The AI returned a diagram that did not match the site format. Try a simpler instruction.';
    }
    if (error.stage === 'persistence') {
      return 'The diagram was generated but could not be saved. Please try again.';
    }
    return 'The AI service did not return a usable diagram. Please try again.';
  }

  console.error('[desk] generate article diagram failed', {
    articleId,
    error: errorSummary(error),
  });
  return 'Could not generate the diagram. Try refining the instruction or try again.';
}

export async function generateArticleDiagramAction(rawId: number, formData: FormData) {
  await requireReviewSession();
  const id = validArticleId(rawId);
  let input: ReturnType<typeof parseArticleDiagramInput>;
  try {
    input = parseArticleDiagramInput(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The diagram settings are invalid.';
    redirect(feedbackUrl(articlePath(id), 'error', message));
  }

  let result: DiagramMutationResult;
  try {
    result = await generateArticleDiagramById(id, input);
  } catch (error) {
    redirect(feedbackUrl(articlePath(id), 'error', diagramGenerationFailure(error, id)));
  }

  revalidateArticleViews();
  const failure = diagramFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Diagram draft generated. Review and approve it below.'));
}

export async function saveArticleDiagramAction(rawId: number, formData: FormData) {
  await requireReviewSession();
  const id = validArticleId(rawId);
  let edited: ReturnType<typeof parseEditableArticleDiagram>;
  try {
    edited = parseEditableArticleDiagram(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The diagram source is invalid.';
    redirect(feedbackUrl(articlePath(id), 'error', message));
  }

  let result: DiagramMutationResult;
  try {
    result = await saveArticleDiagramById(id, edited);
  } catch (error) {
    logUnexpected('save article diagram', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not save the diagram right now. Please try again.'));
  }

  revalidateArticleViews();
  const failure = diagramFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Diagram changes saved as a draft.'));
}

export async function updateArticleDiagramPlacementAction(rawId: number, formData: FormData) {
  await requireReviewSession();
  const id = validArticleId(rawId);
  let placement: number;
  try {
    placement = parsePlacementAfterParagraph(formData.get('placement_after_paragraph'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The diagram placement is invalid.';
    redirect(feedbackUrl(articlePath(id), 'error', message));
  }

  let result: DiagramMutationResult;
  try {
    result = await updateArticleDiagramPlacementById(id, placement);
  } catch (error) {
    logUnexpected('update article diagram placement', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not update the diagram placement right now.'));
  }

  revalidateArticleViews();
  const failure = diagramFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Diagram placement updated. Review and approve the new layout.'));
}

export async function approveArticleDiagramAction(rawId: number) {
  await requireReviewSession();
  const id = validArticleId(rawId);
  let result: DiagramMutationResult;
  try {
    result = await approveArticleDiagramById(id);
  } catch (error) {
    logUnexpected('approve article diagram', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not approve the diagram right now. Please try again.'));
  }

  revalidateArticleViews();
  const failure = diagramFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Diagram approved. It will appear with the published article.'));
}

export async function deleteArticleDiagramAction(rawId: number) {
  await requireReviewSession();
  const id = validArticleId(rawId);
  let result: DiagramMutationResult;
  try {
    result = await deleteArticleDiagramById(id);
  } catch (error) {
    logUnexpected('delete article diagram', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not remove the diagram right now. Please try again.'));
  }

  revalidateArticleViews();
  const failure = diagramFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Diagram removed.'));
}

export async function refreshArticleSource(rawId: number) {
  await requireReviewSession();
  const id = validArticleId(rawId);
  let result: ReviewMutationResult;
  try {
    result = await refreshArticleSourceById(id);
  } catch (error) {
    logUnexpected('refresh source', { articleId: id }, error);
    redirect(feedbackUrl(articlePath(id), 'error', 'Could not refresh the source right now. Please try again.'));
  }

  revalidatePath('/review');
  const failure = mutationFailureMessage(result);
  redirect(feedbackUrl(articlePath(id), failure ? 'error' : 'notice', failure ?? 'Source refresh queued.'));
}

export async function declineArticle(rawId: number) {
  await requireReviewSession();
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
  await requireReviewSession();
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
  await requireReviewSession();
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
  await requireReviewSession();
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
  await requireReviewSession();
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
  await requireReviewSession();
  let ingested: Awaited<ReturnType<typeof ingestFeeds>>;
  let processed: Awaited<ReturnType<typeof runTick>>;
  let audio: Awaited<ReturnType<typeof runAudioTick>>;
  try {
    ingested = await ingestFeeds();
    await releasePendingScrapeRetries();
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

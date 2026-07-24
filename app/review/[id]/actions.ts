'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { runTick } from '../../../lib/tick';
import { ingestFeeds } from '../../../lib/ingest';
import {
  approveAndPublishById,
  requestRewriteById,
  requestNewImageById,
  declineArticleById,
  retryArticleById,
  unpublishArticleById,
} from '../../../lib/reviewActions';

export async function approveArticle(id: number) {
  await approveAndPublishById(id);
  revalidatePath('/');
  revalidatePath('/articles/[slug]', 'page');
  revalidatePath('/review');
}

export async function requestRewrite(id: number, formData: FormData) {
  await requestRewriteById(id, String(formData.get('feedback') ?? ''));
  revalidatePath('/review');
}

export async function requestNewImage(id: number) {
  await requestNewImageById(id);
  revalidatePath('/review');
}

export async function declineArticle(id: number) {
  await declineArticleById(id);
  revalidatePath('/review');
}

export async function retryArticle(id: number) {
  await retryArticleById(id);
  revalidatePath('/review');
}

export async function unpublishArticle(id: number) {
  await unpublishArticleById(id);
  revalidatePath('/');
  revalidatePath('/articles/[slug]', 'page');
  revalidatePath('/review');
}

export async function runTickNow() {
  const ingested = await ingestFeeds();
  const processed = await runTick();

  if (processed.some((p) => p.to === 'published')) {
    revalidatePath('/');
    revalidatePath('/articles/[slug]', 'page');
  }
  revalidatePath('/review');

  // Summarize per feed, then per article: each article's last transition is
  // where it ended up after this tick.
  const feedParts = ingested.map((r) =>
    r.error ? `${r.feed} failed (${r.error})` : `${r.feed} +${r.inserted}`
  );
  const finalState = new Map<number, string>();
  for (const p of processed) finalState.set(p.id, p.to);
  const articleParts = Array.from(finalState, ([id, to]) => `#${id} → ${to}`);

  const summary = [
    feedParts.length > 0 ? `ingest: ${feedParts.join(', ')}` : 'ingest: no feeds configured',
    articleParts.length > 0 ? `processed: ${articleParts.join(', ')}` : 'processed: queue empty',
  ].join(' · ');

  const key = ingested.some((r) => r.error) || processed.some((p) => p.to === 'failed') ? 'error' : 'notice';
  redirect(`/review?${key}=${encodeURIComponent(`tick done — ${summary}`)}`);
}

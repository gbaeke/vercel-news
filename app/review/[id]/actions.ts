'use server';

import { revalidatePath } from 'next/cache';
import { runTick } from '../../../lib/tick';
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
  const processed = await runTick();
  if (processed.some((p) => p.to === 'published')) {
    revalidatePath('/');
    revalidatePath('/articles/[slug]', 'page');
  }
  revalidatePath('/review');
}

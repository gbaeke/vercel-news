import { put } from '@vercel/blob';
import { query } from '../db';
import { deleteThumbnailIfOrphaned, type BlobDeleter } from '../blobCleanup';
import { loadPrompt } from '../prompts';
import { placeholderSvgDataUrl } from '../placeholder';
import { generateImageBytes } from '../llm';
import { sendReviewReadyEmail } from '../notify';
import type { Article } from '../types';

export interface ThumbnailDeps {
  generateImage?: (prompt: string) => Promise<Buffer>;
  uploadBlob?: (name: string, data: Buffer | string, contentType: string) => Promise<string>;
  notify?: (article: Article, thumbnailUrl: string | null) => Promise<boolean>;
  del?: BlobDeleter;
  nextStatus?: string;
}

async function defaultUploadBlob(name: string, data: Buffer | string, contentType: string): Promise<string> {
  const blob = await put(name, data, { access: 'public', contentType });
  return blob.url;
}

export async function thumbnailHandler(article: Article, deps: ThumbnailDeps = {}): Promise<string> {
  const generateImage = deps.generateImage ?? generateImageBytes;
  const uploadBlob = deps.uploadBlob ?? defaultUploadBlob;
  const notify = deps.notify ?? sendReviewReadyEmail;
  const nextStatus = deps.nextStatus ?? 'in_review';

  let thumbnailUrl: string;
  let generated = false;
  try {
    const prompt = loadPrompt('thumbnail', { title: article.title ?? '', summary: article.summary ?? '' });
    const imageBuffer = await generateImage(prompt);
    thumbnailUrl = await uploadBlob(`thumbnails/${article.id}-${Date.now()}.png`, imageBuffer, 'image/png');
    generated = true;
  } catch (err) {
    console.log(`[thumbnail] article ${article.id}: generation failed (${(err as Error).message}), using placeholder`);
    thumbnailUrl = placeholderSvgDataUrl(article.title ?? String(article.id));
  }

  await query(
    `UPDATE articles SET thumbnail_url = $1, status = $2, claimed_at = NULL, updated_at = now() WHERE id = $3`,
    [thumbnailUrl, nextStatus, article.id]
  );

  // Sweep the image we just replaced. Strictly after the UPDATE, so the new
  // one is committed before the old one can be considered an orphan — and only
  // when we actually generated a replacement, since a placeholder fallback is
  // no reason to destroy the picture the reviewer already had.
  if (generated && article.thumbnail_url && article.thumbnail_url !== thumbnailUrl) {
    await deleteThumbnailIfOrphaned(article.thumbnail_url, { del: deps.del });
  }

  // Only a fresh article (written -> in_review) warrants an email; image
  // regeneration means the reviewer is already looking at it.
  if (article.status === 'written') {
    await notify(article, thumbnailUrl);
  }

  return 'in_review';
}

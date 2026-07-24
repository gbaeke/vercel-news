import { put } from '@vercel/blob';
import { query } from '../db';
import { loadPrompt } from '../prompts';
import { placeholderSvgDataUrl } from '../placeholder';
import { generateImageBytes } from '../llm';
import { sendReviewReadyEmail } from '../notify';
import type { Article } from '../types';

export interface ThumbnailDeps {
  generateImage?: (prompt: string) => Promise<Buffer>;
  uploadBlob?: (name: string, data: Buffer | string, contentType: string) => Promise<string>;
  notify?: (article: Article, thumbnailUrl: string | null) => Promise<boolean>;
}

async function defaultUploadBlob(name: string, data: Buffer | string, contentType: string): Promise<string> {
  const blob = await put(name, data, { access: 'public', contentType });
  return blob.url;
}

export async function thumbnailHandler(article: Article, deps: ThumbnailDeps = {}): Promise<string> {
  const generateImage = deps.generateImage ?? generateImageBytes;
  const uploadBlob = deps.uploadBlob ?? defaultUploadBlob;
  const notify = deps.notify ?? sendReviewReadyEmail;

  let thumbnailUrl: string;
  try {
    const prompt = loadPrompt('thumbnail', { title: article.title ?? '', summary: article.summary ?? '' });
    const imageBuffer = await generateImage(prompt);
    thumbnailUrl = await uploadBlob(`thumbnails/${article.id}-${Date.now()}.png`, imageBuffer, 'image/png');
  } catch (err) {
    console.log(`[thumbnail] article ${article.id}: generation failed (${(err as Error).message}), using placeholder`);
    thumbnailUrl = placeholderSvgDataUrl(article.title ?? String(article.id));
  }

  await query(
    `UPDATE articles SET thumbnail_url = $1, status = 'in_review', claimed_at = NULL, updated_at = now() WHERE id = $2`,
    [thumbnailUrl, article.id]
  );

  // Only a fresh article (written -> in_review) warrants an email; image
  // regeneration means the reviewer is already looking at it.
  if (article.status === 'written') {
    await notify(article, thumbnailUrl);
  }

  return 'in_review';
}

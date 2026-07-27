import { del } from '@vercel/blob';
import { query } from './db';

export type BlobDeleter = (url: string) => Promise<void>;

export interface BlobCleanupDeps {
  del?: BlobDeleter;
}

const BLOB_HOST_SUFFIX = '.blob.vercel-storage.com';
const THUMBNAIL_PREFIX = '/thumbnails/';
const AUDIO_PREFIX = '/audio/';

// A whitelist, not a blacklist: the value has to parse as an https URL on our
// own blob host under the expected prefix. Placeholder data: URLs, anything on
// another host, and host-suffix look-alikes all fall through to false.
function isOwnBlobUnder(url: string | null | undefined, prefix: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (!parsed.hostname.endsWith(BLOB_HOST_SUFFIX)) return false;
  return parsed.pathname.startsWith(prefix);
}

export function isOwnThumbnailBlob(url: string | null | undefined): boolean {
  return isOwnBlobUnder(url, THUMBNAIL_PREFIX);
}

export function isOwnAudioBlob(url: string | null | undefined): boolean {
  return isOwnBlobUnder(url, AUDIO_PREFIX);
}

// The safety net. Callers must have already removed or replaced the reference
// in the database, so anything still pointing here is a live article and the
// blob must survive.
async function isStillReferenced(url: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM articles WHERE thumbnail_url = $1 LIMIT 1`, [url]);
  return rows.length > 0;
}

async function isAudioStillReferenced(url: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM article_audio WHERE blob_url = $1 LIMIT 1`, [url]);
  return rows.length > 0;
}

/**
 * Delete a thumbnail blob if and only if it is ours and no article row points
 * at it. Returns whether anything was deleted. Never throws: losing a blob to
 * a leak is a rounding error, breaking a publish or a delete is not.
 */
export async function deleteThumbnailIfOrphaned(
  url: string | null | undefined,
  deps: BlobCleanupDeps = {}
): Promise<boolean> {
  if (!isOwnThumbnailBlob(url)) return false;
  const target = url as string;

  try {
    if (await isStillReferenced(target)) {
      console.log(`[blob] kept ${target} — still referenced by an article`);
      return false;
    }
    await (deps.del ?? ((u: string) => del(u).then(() => undefined)))(target);
    console.log(`[blob] deleted orphaned thumbnail ${target}`);
    return true;
  } catch (err) {
    console.log(`[blob] could not delete ${target}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Delete an MP3 only after its article_audio reference has been removed or
 * replaced. Like thumbnail cleanup, this is best effort and never turns an
 * otherwise successful editorial action into a failure.
 */
export async function deleteAudioIfOrphaned(
  url: string | null | undefined,
  deps: BlobCleanupDeps = {}
): Promise<boolean> {
  if (!isOwnAudioBlob(url)) return false;
  const target = url as string;

  try {
    if (await isAudioStillReferenced(target)) {
      console.log(`[blob] kept ${target} — still referenced by article audio`);
      return false;
    }
    await (deps.del ?? ((u: string) => del(u).then(() => undefined)))(target);
    console.log(`[blob] deleted orphaned audio ${target}`);
    return true;
  } catch (err) {
    console.log(`[blob] could not delete ${target}: ${(err as Error).message}`);
    return false;
  }
}

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { addTag, deleteTag, normalizeTagName } from '../../../lib/tags';
import { addFeed, deleteFeed, getFeeds, normalizeFeedName } from '../../../lib/feeds';
import { validateFeed } from '../../../lib/feedValidator';

function done(params: { notice?: string; error?: string } = {}): never {
  const qs = new URLSearchParams();
  if (params.notice) qs.set('notice', params.notice);
  if (params.error) qs.set('error', params.error);
  revalidatePath('/review/settings');
  redirect(qs.size > 0 ? `/review/settings?${qs}` : '/review/settings');
}

export async function createTag(formData: FormData) {
  const name = normalizeTagName(String(formData.get('name') ?? ''));
  if (!name) {
    done({ error: 'tag names must be 1-30 chars: lowercase letters, digits, dashes' });
  }
  await addTag(name);
  revalidatePath('/');
  done({ notice: `tag "${name}" added` });
}

export async function removeTag(name: string) {
  const result = await deleteTag(name);
  if (!result.deleted) {
    done({ error: result.reason });
  }
  revalidatePath('/');
  done({ notice: `tag "${name}" deleted` });
}

export async function createFeed(formData: FormData) {
  const name = normalizeFeedName(String(formData.get('name') ?? ''));
  const url = String(formData.get('url') ?? '').trim();
  if (!name) {
    done({ error: 'feed names must be 1-30 chars: lowercase letters, digits, dashes' });
  }

  const check = await validateFeed(url);
  if (!check.ok) {
    done({ error: `feed not added — ${check.error}` });
  }

  await addFeed(name, url);
  done({
    notice: `feed "${name}" added — "${check.title}", ${check.itemCount} item(s)${check.warning ? ` (${check.warning})` : ''}`,
  });
}

export async function removeFeed(name: string) {
  await deleteFeed(name);
  done({ notice: `feed "${name}" deleted` });
}

export async function testFeed(name: string) {
  const feed = (await getFeeds()).find((f) => f.name === name);
  if (!feed) {
    done({ error: `feed "${name}" not found` });
  }

  const check = await validateFeed(feed.url);
  if (!check.ok) {
    done({ error: `feed "${name}" failed: ${check.error}` });
  }
  done({
    notice: `feed "${name}" works — "${check.title}", ${check.itemCount} item(s)${check.warning ? ` (${check.warning})` : ''}`,
  });
}

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  addTag,
  deleteTag,
  normalizeTagName,
  updateTagPersona,
} from '../../../lib/tags';
import { addFeed, deleteFeed, getFeeds, normalizeFeedName } from '../../../lib/feeds';
import { validateFeed } from '../../../lib/feedValidator';
import { findPersona } from '../../../lib/personas';

const MAX_FEEDBACK_MESSAGE_LENGTH = 1_500;

function done(params: { notice?: string; error?: string } = {}): never {
  const qs = new URLSearchParams();
  if (params.notice) qs.set('notice', params.notice.slice(0, MAX_FEEDBACK_MESSAGE_LENGTH));
  if (params.error) qs.set('error', params.error.slice(0, MAX_FEEDBACK_MESSAGE_LENGTH));
  revalidatePath('/review/settings');
  redirect(qs.size > 0 ? `/review/settings?${qs}` : '/review/settings');
}

function unexpected(action: string, error: unknown): never {
  console.error(`[desk settings] ${action} failed`, error);
  done({ error: `Could not ${action} right now. Please try again.` });
}

export async function createTag(formData: FormData) {
  const name = normalizeTagName(String(formData.get('name') ?? ''));
  const personaId = String(formData.get('persona') ?? '');
  if (!name) {
    done({ error: 'tag names must be 1-30 chars: lowercase letters, digits, dashes' });
  }
  if (!findPersona(personaId)) {
    done({ error: 'Choose a valid persona for that tag.' });
  }
  let added: boolean;
  try {
    added = await addTag(name, personaId);
  } catch (error) {
    unexpected('add that tag', error);
  }

  revalidatePath('/');
  done({
    notice: added
      ? `Tag “${name}” added with persona “${personaId}”.`
      : `Tag “${name}” already exists.`,
  });
}

export async function assignTagPersona(name: string, formData: FormData) {
  const personaId = String(formData.get('persona') ?? '');
  if (!findPersona(personaId)) {
    done({ error: 'Choose a valid persona for that tag.' });
  }

  let updated: boolean;
  try {
    updated = await updateTagPersona(name, personaId);
  } catch (error) {
    unexpected('assign that persona', error);
  }

  done(updated
    ? { notice: `Tag “${name}” now uses “${personaId}”.` }
    : { error: `Tag “${name}” no longer exists.` });
}

export async function removeTag(name: string) {
  let result: Awaited<ReturnType<typeof deleteTag>>;
  try {
    result = await deleteTag(name);
  } catch (error) {
    unexpected('delete that tag', error);
  }

  if (!result.deleted) {
    done({
      error: result.reason === 'last_tag'
        ? 'Cannot delete the last tag — the tagging step needs at least one.'
        : `Tag “${name}” no longer exists.`,
    });
  }
  revalidatePath('/');
  done({ notice: `Tag “${name}” deleted.` });
}

export async function createFeed(formData: FormData) {
  const name = normalizeFeedName(String(formData.get('name') ?? ''));
  const url = String(formData.get('url') ?? '').trim();
  if (!name) {
    done({ error: 'feed names must be 1-30 chars: lowercase letters, digits, dashes' });
  }

  let check: Awaited<ReturnType<typeof validateFeed>>;
  try {
    check = await validateFeed(url);
  } catch (error) {
    unexpected('validate that feed', error);
  }

  if (!check.ok) {
    done({ error: `feed not added — ${check.error}` });
  }

  let result: Awaited<ReturnType<typeof addFeed>>;
  try {
    result = await addFeed(name, url);
  } catch (error) {
    unexpected('save that feed', error);
  }

  if (!result.ok) {
    const owner = result.existingName ? ` by “${result.existingName}”` : '';
    done({ error: `That feed URL is already used${owner}.` });
  }

  done({
    notice: result.changed
      ? `Feed “${name}” saved — “${check.title}”, ${check.itemCount} item(s)${check.warning ? ` (${check.warning})` : ''}.`
      : `Feed “${name}” is already configured with that URL.`,
  });
}

export async function removeFeed(name: string) {
  let deleted: boolean;
  try {
    deleted = await deleteFeed(name);
  } catch (error) {
    unexpected('delete that feed', error);
  }

  done(deleted
    ? { notice: `Feed “${name}” deleted.` }
    : { error: `Feed “${name}” no longer exists.` });
}

export async function testFeed(name: string) {
  let feed: Awaited<ReturnType<typeof getFeeds>>[number] | undefined;
  try {
    feed = (await getFeeds()).find((item) => item.name === name);
  } catch (error) {
    unexpected('load that feed', error);
  }

  if (!feed) {
    done({ error: `feed "${name}" not found` });
  }

  let check: Awaited<ReturnType<typeof validateFeed>>;
  try {
    check = await validateFeed(feed.url);
  } catch (error) {
    unexpected('test that feed', error);
  }

  if (!check.ok) {
    done({ error: `feed "${name}" failed: ${check.error}` });
  }
  done({
    notice: `feed "${name}" works — "${check.title}", ${check.itemCount} item(s)${check.warning ? ` (${check.warning})` : ''}`,
  });
}

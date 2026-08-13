const MAX_SHARED_VALUE_LENGTH = 4_096;

function asHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Pick a URL out of the fields commonly supplied by native share sheets. */
export function sharedStoryUrl(input: { url?: unknown; text?: unknown }): string {
  for (const value of [input.url, input.text]) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().slice(0, MAX_SHARED_VALUE_LENGTH);
    const direct = asHttpUrl(trimmed);
    if (direct) return direct;

    // Some apps put the title and URL together in the text field. Strip the
    // punctuation most often placed immediately after a shared link.
    const match = trimmed.match(/https?:\/\/[^\s<>"']+/i)?.[0];
    if (!match) continue;
    const embedded = asHttpUrl(match.replace(/[.,;:!?\]\}]+$/, ''));
    if (embedded) return embedded;
  }
  return '';
}

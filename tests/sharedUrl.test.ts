import { describe, expect, it } from 'vitest';
import { sharedStoryUrl } from '../lib/sharedUrl';

describe('sharedStoryUrl', () => {
  it('prefers a directly shared URL', () => {
    expect(sharedStoryUrl({
      url: 'https://example.com/story',
      text: 'https://example.com/other',
    })).toBe('https://example.com/story');
  });

  it('extracts a URL from shared text', () => {
    expect(sharedStoryUrl({ text: 'Interesting story: https://example.com/news?id=1.' }))
      .toBe('https://example.com/news?id=1');
  });

  it('rejects non-web and malformed values', () => {
    expect(sharedStoryUrl({ url: 'javascript:alert(1)', text: 'no link here' })).toBe('');
  });
});

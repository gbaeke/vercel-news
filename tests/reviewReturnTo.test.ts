import { describe, expect, it } from 'vitest';
import { reviewLoginErrorUrl, safeReviewReturnTo } from '../lib/reviewReturnTo';

describe('safeReviewReturnTo', () => {
  it('keeps Desk paths and their query string', () => {
    expect(safeReviewReturnTo('/review/42?notice=ready')).toBe('/review/42?notice=ready');
    expect(safeReviewReturnTo('/review/settings')).toBe('/review/settings');
  });

  it('falls back to the Desk home for external and non-Desk URLs', () => {
    expect(safeReviewReturnTo('https://example.com/review/42')).toBe('/review');
    expect(safeReviewReturnTo('//example.com/review/42')).toBe('/review');
    expect(safeReviewReturnTo('/public')).toBe('/review');
  });

  it('rejects path traversal, backslashes, and the login page itself', () => {
    expect(safeReviewReturnTo('/review/../admin')).toBe('/review');
    expect(safeReviewReturnTo('/review\\@example.com')).toBe('/review');
    expect(safeReviewReturnTo('/review/login?next=/review/42')).toBe('/review');
  });

  it('falls back for missing, malformed, and oversized values', () => {
    expect(safeReviewReturnTo(undefined)).toBe('/review');
    expect(safeReviewReturnTo('%')).toBe('/review');
    expect(safeReviewReturnTo(`/review/${'a'.repeat(2048)}`)).toBe('/review');
  });
});

describe('reviewLoginErrorUrl', () => {
  it('preserves a non-default return path across failed attempts', () => {
    expect(reviewLoginErrorUrl('invalid', '/review/42?tab=story')).toBe(
      '/review/login?error=invalid&next=%2Freview%2F42%3Ftab%3Dstory'
    );
  });

  it('does not add a redundant return path for the Desk home', () => {
    expect(reviewLoginErrorUrl('config', '/review')).toBe('/review/login?error=config');
  });
});

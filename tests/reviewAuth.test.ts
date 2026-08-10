import { describe, it, expect } from 'vitest';
import { verifyReviewPassword } from '../lib/reviewAuth';
import {
  REVIEW_SESSION_MAX_AGE_SECONDS,
  reviewSessionToken,
  verifyReviewSessionToken,
} from '../lib/reviewCookie';

describe('verifyReviewPassword', () => {
  it('accepts the correct password', () => {
    process.env.REVIEW_PASSWORD = 'correct-horse';
    expect(verifyReviewPassword('correct-horse')).toBe(true);
  });

  it('rejects a wrong password', () => {
    process.env.REVIEW_PASSWORD = 'correct-horse';
    expect(verifyReviewPassword('wrong')).toBe(false);
  });
});

describe('reviewSessionToken', () => {
  it('is deterministic for a fixed expiry and never contains either secret', async () => {
    const a = await reviewSessionToken('correct-horse', 'independent-key', 2_000_000_000);
    const b = await reviewSessionToken('correct-horse', 'independent-key', 2_000_000_000);
    expect(a).toBe(b);
    expect(a).toMatch(/^v1\.2000000000\.[0-9a-f]{64}$/);
    expect(a).not.toContain('correct-horse');
    expect(a).not.toContain('independent-key');
  });

  it('verifies only before expiry with the current password and signing key', async () => {
    const token = await reviewSessionToken('one', 'signing-key', 2_000_000_000);
    expect(await verifyReviewSessionToken(token, 'one', 'signing-key', 1_999_999_999)).toBe(true);
    expect(await verifyReviewSessionToken(token, 'two', 'signing-key', 1_999_999_999)).toBe(false);
    expect(await verifyReviewSessionToken(token, 'one', 'other-key', 1_999_999_999)).toBe(false);
    expect(await verifyReviewSessionToken(token, 'one', 'signing-key', 2_000_000_000)).toBe(false);
  });

  it('rejects tokens beyond the configured session lifetime', async () => {
    const now = 1_800_000_000;
    const token = await reviewSessionToken(
      'one',
      'signing-key',
      now + REVIEW_SESSION_MAX_AGE_SECONDS + 1
    );
    expect(await verifyReviewSessionToken(token, 'one', 'signing-key', now)).toBe(false);
  });
});

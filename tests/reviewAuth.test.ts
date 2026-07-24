import { describe, it, expect } from 'vitest';
import { verifyReviewPassword } from '../lib/reviewAuth';
import { reviewSessionToken } from '../lib/reviewCookie';

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
  it('is deterministic, hex, and never contains the password', async () => {
    const a = await reviewSessionToken('correct-horse');
    const b = await reviewSessionToken('correct-horse');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('correct-horse');
  });

  it('differs for different passwords', async () => {
    expect(await reviewSessionToken('one')).not.toBe(await reviewSessionToken('two'));
  });
});

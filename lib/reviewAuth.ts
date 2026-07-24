import { timingSafeEqual } from 'node:crypto';

export function verifyReviewPassword(password: string): boolean {
  const expected = process.env.REVIEW_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

import { timingSafeEqual } from 'node:crypto';

export function isAuthorized(headerValue: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !headerValue) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

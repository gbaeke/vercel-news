import { timingSafeEqual } from 'node:crypto';

/**
 * Authenticate personal capture clients such as an Apple Shortcut.
 *
 * This deliberately uses a separate secret from CRON_SECRET and the Desk
 * password so a lost phone can be revoked without affecting either system.
 */
export function isCaptureAuthorized(headerValue: string | null): boolean {
  const token = process.env.CAPTURE_TOKEN;
  if (!token || !headerValue) return false;

  const expected = `Bearer ${token}`;
  const actualBytes = Buffer.from(headerValue);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

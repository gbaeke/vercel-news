import { describe, expect, it } from 'vitest';
import {
  clearRateLimit,
  consumeRateLimit,
  rateLimitKey,
  requestRateLimitKey,
} from '../lib/rateLimit';

describe('persistent request rate limiting', () => {
  it('allows only the configured number of attempts in a window', async () => {
    const key = 'rate-limit-test-key';
    expect((await consumeRateLimit(key, 2, 600)).allowed).toBe(true);
    expect((await consumeRateLimit(key, 2, 600)).allowed).toBe(true);
    const blocked = await consumeRateLimit(key, 2, 600);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('can clear a successful login throttle', async () => {
    const key = 'clear-rate-limit-test-key';
    await consumeRateLimit(key, 1, 600);
    await clearRateLimit(key);
    expect((await consumeRateLimit(key, 1, 600)).allowed).toBe(true);
  });

  it('uses an HMAC of the requester address instead of storing it', async () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.8, 10.0.0.1' });
    const key = await requestRateLimitKey('search', headers);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203.0.113.8');
  });

  it('can derive an application-wide key without storing the identifier', async () => {
    const key = await rateLimitKey('search', 'global');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('global');
  });
});

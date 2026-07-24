import { describe, it, expect } from 'vitest';
import { isAuthorized } from '../../lib/auth';

describe('isAuthorized', () => {
  it('accepts the correct bearer token', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(isAuthorized(`Bearer test-secret`)).toBe(true);
  });

  it('rejects a missing header', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(isAuthorized(null)).toBe(false);
  });

  it('rejects a wrong token', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(isAuthorized('Bearer wrong')).toBe(false);
  });
});

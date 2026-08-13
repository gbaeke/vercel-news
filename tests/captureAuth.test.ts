import { afterEach, describe, expect, it } from 'vitest';
import { isCaptureAuthorized } from '../lib/captureAuth';

const originalToken = process.env.CAPTURE_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.CAPTURE_TOKEN;
  else process.env.CAPTURE_TOKEN = originalToken;
});

describe('isCaptureAuthorized', () => {
  it('accepts the configured bearer token', () => {
    process.env.CAPTURE_TOKEN = 'phone-secret';
    expect(isCaptureAuthorized('Bearer phone-secret')).toBe(true);
  });

  it('rejects absent, malformed, and incorrect credentials', () => {
    process.env.CAPTURE_TOKEN = 'phone-secret';
    expect(isCaptureAuthorized(null)).toBe(false);
    expect(isCaptureAuthorized('phone-secret')).toBe(false);
    expect(isCaptureAuthorized('Bearer wrong')).toBe(false);
  });

  it('fails closed when capture is not configured', () => {
    delete process.env.CAPTURE_TOKEN;
    expect(isCaptureAuthorized('Bearer phone-secret')).toBe(false);
  });
});

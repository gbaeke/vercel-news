import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { REVIEW_COOKIE_NAME, reviewSessionToken } from '../lib/reviewCookie';

const originalPassword = process.env.REVIEW_PASSWORD;
const originalAppSecret = process.env.APP_SECRET;

afterEach(() => {
  if (originalPassword === undefined) delete process.env.REVIEW_PASSWORD;
  else process.env.REVIEW_PASSWORD = originalPassword;
  if (originalAppSecret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = originalAppSecret;
});

describe('Desk middleware', () => {
  it('sends unauthenticated deep links to login with a return path', async () => {
    process.env.REVIEW_PASSWORD = 'desk-secret';
    process.env.APP_SECRET = 'test-app-secret';
    const response = await proxy(
      new NextRequest('https://wire.example/review/42?notice=ready')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://wire.example/review/login?next=%2Freview%2F42%3Fnotice%3Dready'
    );
  });

  it('sends the Desk home to a clean login URL', async () => {
    process.env.REVIEW_PASSWORD = 'desk-secret';
    process.env.APP_SECRET = 'test-app-secret';
    const response = await proxy(new NextRequest('https://wire.example/review'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://wire.example/review/login');
  });

  it('does not intercept the login page', async () => {
    const response = await proxy(new NextRequest('https://wire.example/review/login'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('accepts a current HMAC-signed review session', async () => {
    process.env.REVIEW_PASSWORD = 'desk-secret';
    process.env.APP_SECRET = 'test-app-secret';
    const token = await reviewSessionToken('desk-secret', 'test-app-secret');
    const request = new NextRequest('https://wire.example/review', {
      headers: { cookie: `${REVIEW_COOKIE_NAME}=${token}` },
    });
    const response = await proxy(request);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('still protects paths that merely resemble the login URL', async () => {
    process.env.REVIEW_PASSWORD = 'desk-secret';
    process.env.APP_SECRET = 'test-app-secret';
    const response = await proxy(
      new NextRequest('https://wire.example/review/login-history')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://wire.example/review/login?next=%2Freview%2Flogin-history'
    );
  });
});

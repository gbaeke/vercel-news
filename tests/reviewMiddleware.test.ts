import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const originalPassword = process.env.REVIEW_PASSWORD;

afterEach(() => {
  if (originalPassword === undefined) delete process.env.REVIEW_PASSWORD;
  else process.env.REVIEW_PASSWORD = originalPassword;
});

describe('Desk middleware', () => {
  it('sends unauthenticated deep links to login with a return path', async () => {
    process.env.REVIEW_PASSWORD = 'desk-secret';
    const response = await middleware(
      new NextRequest('https://wire.example/review/42?notice=ready')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://wire.example/review/login?next=%2Freview%2F42%3Fnotice%3Dready'
    );
  });

  it('sends the Desk home to a clean login URL', async () => {
    process.env.REVIEW_PASSWORD = 'desk-secret';
    const response = await middleware(new NextRequest('https://wire.example/review'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://wire.example/review/login');
  });

  it('does not intercept the login page', async () => {
    const response = await middleware(new NextRequest('https://wire.example/review/login'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('still protects paths that merely resemble the login URL', async () => {
    process.env.REVIEW_PASSWORD = 'desk-secret';
    const response = await middleware(
      new NextRequest('https://wire.example/review/login-history')
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://wire.example/review/login?next=%2Freview%2Flogin-history'
    );
  });
});

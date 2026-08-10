'use server';

import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyReviewPassword } from '../../../lib/reviewAuth';
import {
  REVIEW_COOKIE_NAME,
  REVIEW_SESSION_MAX_AGE_SECONDS,
  reviewSessionToken,
} from '../../../lib/reviewCookie';
import { reviewLoginErrorUrl, safeReviewReturnTo } from '../../../lib/reviewReturnTo';
import { clearRateLimit, consumeRateLimit, requestRateLimitKey } from '../../../lib/rateLimit';

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

export async function login(formData: FormData) {
  const returnTo = safeReviewReturnTo(formData.get('next'));

  if (!process.env.REVIEW_PASSWORD || !process.env.APP_SECRET) {
    console.error('[desk] login unavailable: REVIEW_PASSWORD or APP_SECRET is not configured');
    redirect(reviewLoginErrorUrl('config', returnTo));
  }

  let rateLimitKey: string;
  let rateLimit: Awaited<ReturnType<typeof consumeRateLimit>>;
  try {
    rateLimitKey = await requestRateLimitKey('review-login', await headers());
    rateLimit = await consumeRateLimit(
      rateLimitKey,
      LOGIN_ATTEMPT_LIMIT,
      LOGIN_WINDOW_SECONDS
    );
  } catch (error) {
    // A broken throttle must fail closed for the administrative login.
    console.error('[desk] login rate limiter unavailable', error);
    redirect(reviewLoginErrorUrl('unavailable', returnTo));
  }
  if (!rateLimit.allowed) {
    redirect(reviewLoginErrorUrl('rate_limit', returnTo));
  }

  const password = String(formData.get('password') ?? '');
  if (!verifyReviewPassword(password)) {
    redirect(reviewLoginErrorUrl('invalid', returnTo));
  }

  let token: string;
  try {
    token = await reviewSessionToken(
      process.env.REVIEW_PASSWORD,
      process.env.APP_SECRET
    );
    await clearRateLimit(rateLimitKey);
  } catch (error) {
    console.error('[desk] could not create review session', error);
    redirect(reviewLoginErrorUrl('unavailable', returnTo));
  }

  const cookieStore = await cookies();
  cookieStore.set(REVIEW_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/review',
    secure: process.env.NODE_ENV === 'production',
    maxAge: REVIEW_SESSION_MAX_AGE_SECONDS,
    priority: 'high',
  });
  redirect(returnTo);
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.set(REVIEW_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/review',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
  redirect('/review/login');
}

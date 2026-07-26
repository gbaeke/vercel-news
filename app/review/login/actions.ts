'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyReviewPassword } from '../../../lib/reviewAuth';
import { REVIEW_COOKIE_NAME, reviewSessionToken } from '../../../lib/reviewCookie';
import { reviewLoginErrorUrl, safeReviewReturnTo } from '../../../lib/reviewReturnTo';

export async function login(formData: FormData) {
  const returnTo = safeReviewReturnTo(formData.get('next'));

  if (!process.env.REVIEW_PASSWORD) {
    console.error('[desk] login unavailable: REVIEW_PASSWORD is not configured');
    redirect(reviewLoginErrorUrl('config', returnTo));
  }

  const password = String(formData.get('password') ?? '');
  if (!verifyReviewPassword(password)) {
    redirect(reviewLoginErrorUrl('invalid', returnTo));
  }

  let token: string;
  try {
    token = await reviewSessionToken(password);
  } catch (error) {
    console.error('[desk] could not create review session', error);
    redirect(reviewLoginErrorUrl('unavailable', returnTo));
  }

  cookies().set(REVIEW_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(returnTo);
}

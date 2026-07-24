'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyReviewPassword } from '../../../lib/reviewAuth';
import { REVIEW_COOKIE_NAME, reviewSessionToken } from '../../../lib/reviewCookie';

export async function login(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (!verifyReviewPassword(password)) {
    redirect('/review/login?error=1');
  }
  const token = await reviewSessionToken(password);
  cookies().set(REVIEW_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect('/review');
}

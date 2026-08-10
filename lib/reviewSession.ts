import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { REVIEW_COOKIE_NAME, verifyReviewSessionToken } from './reviewCookie';

export async function hasValidReviewSession(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyReviewSessionToken(
    cookieStore.get(REVIEW_COOKIE_NAME)?.value,
    process.env.REVIEW_PASSWORD,
    process.env.APP_SECRET
  );
}

export async function requireReviewSession(): Promise<void> {
  if (!(await hasValidReviewSession())) {
    redirect('/review/login?error=session');
  }
}

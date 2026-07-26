import { NextRequest, NextResponse } from 'next/server';
import { REVIEW_COOKIE_NAME, reviewSessionToken } from './lib/reviewCookie';

export async function middleware(req: NextRequest) {
  const isLoginPath =
    req.nextUrl.pathname === '/review/login' || req.nextUrl.pathname.startsWith('/review/login/');
  if (isLoginPath) return NextResponse.next();

  const cookie = req.cookies.get(REVIEW_COOKIE_NAME);
  const password = process.env.REVIEW_PASSWORD;
  const expected = password ? await reviewSessionToken(password) : null;
  if (!expected || cookie?.value !== expected) {
    const returnTo = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    const url = req.nextUrl.clone();
    url.pathname = '/review/login';
    url.search = '';
    if (returnTo !== '/review') url.searchParams.set('next', returnTo);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/review/:path*'],
};

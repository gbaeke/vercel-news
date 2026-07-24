import { NextRequest, NextResponse } from 'next/server';
import { REVIEW_COOKIE_NAME, reviewSessionToken } from './lib/reviewCookie';

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/review/login')) return NextResponse.next();

  const cookie = req.cookies.get(REVIEW_COOKIE_NAME);
  const password = process.env.REVIEW_PASSWORD;
  const expected = password ? await reviewSessionToken(password) : null;
  if (!expected || cookie?.value !== expected) {
    const url = req.nextUrl.clone();
    url.pathname = '/review/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/review/:path*'],
};

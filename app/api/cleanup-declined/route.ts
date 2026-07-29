export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth';
import { cleanupDeclinedArticles } from '../../../lib/declinedCleanup';

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await cleanupDeclinedArticles();
  return NextResponse.json({ ok: true, ...result });
}

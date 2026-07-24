export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth';
import { ingestFeeds } from '../../../lib/ingest';

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const ingested = await ingestFeeds();
  return NextResponse.json({ ok: true, ingested });
}

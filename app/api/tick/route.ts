export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { isAuthorized } from '../../../lib/auth';
import { runTick } from '../../../lib/tick';
import { ingestFeeds } from '../../../lib/ingest';

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let ingested: Awaited<ReturnType<typeof ingestFeeds>> = [];
  if (req.nextUrl.searchParams.get('ingest') === '1') {
    ingested = await ingestFeeds();
  }

  const processed = await runTick();
  if (processed.some((p) => p.to === 'published')) {
    revalidatePath('/');
    revalidatePath('/articles/[slug]', 'page');
  }
  return NextResponse.json({ ingested, processed });
}

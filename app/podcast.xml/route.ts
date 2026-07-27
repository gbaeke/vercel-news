import type { NextRequest } from 'next/server';
import { buildPodcastFeed, getPodcastEpisodes } from '../../lib/podcast';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicBaseUrl(req: NextRequest): string {
  if (process.env.APP_URL) {
    try {
      const configured = new URL(process.env.APP_URL);
      if (configured.protocol === 'http:' || configured.protocol === 'https:') {
        return configured.toString().replace(/\/+$/, '');
      }
    } catch {
      console.warn('[podcast] APP_URL is not an absolute URL; using the request origin');
    }
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  try {
    const episodes = await getPodcastEpisodes();
    return new Response(buildPodcastFeed(publicBaseUrl(req), episodes), {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('[podcast] could not build feed', error);
    return new Response('Podcast feed is temporarily unavailable.', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
}

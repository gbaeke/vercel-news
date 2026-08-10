const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

export interface YouTubeVideoUrl {
  videoId: string;
  canonicalUrl: string;
}

export function isYouTubeHost(hostname: string): boolean {
  return YOUTUBE_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ''));
}

export function parseYouTubeVideoUrl(value: string | URL): YouTubeVideoUrl | null {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!isYouTubeHost(hostname)) return null;

  let videoId: string | null = null;
  if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v');
  } else {
    const [kind, id] = url.pathname.split('/').filter(Boolean);
    if (kind === 'shorts' || kind === 'live' || kind === 'embed') videoId = id ?? null;
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) return null;
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function youtubeEmbedUrl(videoId: string): string | null {
  if (!VIDEO_ID_PATTERN.test(videoId)) return null;
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

import { youtubeEmbedUrl } from '../lib/youtube';

export function YouTubeEmbed({
  videoId,
  title,
  variant = 'public',
}: {
  videoId: string;
  title: string;
  variant?: 'public' | 'review';
}) {
  const src = youtubeEmbedUrl(videoId);
  if (!src) return null;

  return (
    <figure className={`youtube-embed youtube-embed--${variant}`}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
      <figcaption className={variant === 'public' ? 'mono wire-figcaption' : 'meta'}>
        Embedded from YouTube
      </figcaption>
    </figure>
  );
}

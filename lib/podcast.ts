import { query } from './db';

export const PODCAST_TITLE = 'The AI Wire Audio';
export const PODCAST_AUTHOR = 'The AI Wire';
export const PODCAST_CATEGORY = 'Technology';
export const PODCAST_DESCRIPTION =
  'Short AI news dispatches and a two-speaker weekly review from The AI Wire, using AI-generated voices.';

export interface PodcastEpisode {
  kind: 'article' | 'weekly';
  id: string;
  version: number;
  source_hash: string;
  title: string;
  summary: string | null;
  slug: string | null;
  week_key: string | null;
  show_notes: string | null;
  published_at: string;
  blob_url: string;
  byte_length: string;
  media_type: string;
  duration_seconds: string | null;
}

export async function getPodcastEpisodes(): Promise<PodcastEpisode[]> {
  return query<PodcastEpisode>(
    `SELECT * FROM (
       SELECT
         'article'::text AS kind,
         articles.id::text AS id,
         articles.version,
         article_audio.source_hash,
         articles.title,
         articles.summary,
         articles.slug,
         NULL::text AS week_key,
         NULL::text AS show_notes,
         articles.published_at,
         article_audio.blob_url,
         article_audio.byte_length,
         article_audio.media_type,
         NULL::numeric AS duration_seconds
       FROM articles
       JOIN article_audio ON article_audio.article_id = articles.id
       WHERE articles.status = 'published'
         AND articles.title IS NOT NULL
         AND articles.slug IS NOT NULL
         AND articles.published_at IS NOT NULL
         AND article_audio.status = 'ready'
         AND article_audio.article_version = articles.version
         AND article_audio.blob_url IS NOT NULL
         AND article_audio.byte_length IS NOT NULL
         AND article_audio.media_type IS NOT NULL

       UNION ALL

       SELECT
         'weekly'::text AS kind,
         weekly_episodes.id::text AS id,
         weekly_episodes.script_version AS version,
         weekly_episodes.script_hash AS source_hash,
         weekly_episodes.title,
         weekly_episodes.summary,
         NULL::text AS slug,
         weekly_episodes.week_key,
         weekly_episodes.show_notes,
         weekly_episodes.published_at,
         weekly_episodes.blob_url,
         weekly_episodes.byte_length,
         weekly_episodes.media_type,
         weekly_episodes.duration_seconds
       FROM weekly_episodes
       WHERE weekly_episodes.status = 'ready'
         AND weekly_episodes.title IS NOT NULL
         AND weekly_episodes.script_hash IS NOT NULL
         AND weekly_episodes.published_at IS NOT NULL
         AND weekly_episodes.blob_url IS NOT NULL
         AND weekly_episodes.byte_length IS NOT NULL
         AND weekly_episodes.media_type IS NOT NULL
     ) AS podcast_episodes
     ORDER BY published_at DESC`
  );
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

export function buildPodcastFeed(baseUrl: string, episodes: PodcastEpisode[]): string {
  const feedUrl = absoluteUrl(baseUrl, '/podcast.xml');
  const siteUrl = absoluteUrl(baseUrl, '/');
  const artworkUrl = absoluteUrl(baseUrl, '/podcast-artwork.png');
  const lastBuildDate = episodes[0]?.published_at
    ? new Date(episodes[0].published_at).toUTCString()
    : new Date(0).toUTCString();

  const items = episodes.map((episode) => {
    const itemUrl = episode.kind === 'article' && episode.slug
      ? absoluteUrl(baseUrl, `/articles/${encodeURIComponent(episode.slug)}`)
      : siteUrl;
    const description = [
      episode.summary,
      episode.show_notes,
      episode.kind === 'weekly'
        ? 'The two voices in this episode are AI-generated.'
        : 'This episode is narrated by an AI-generated voice.',
    ].filter(Boolean).join(' ');
    const guid = episode.kind === 'weekly'
      ? `urn:the-ai-wire:weekly:${episode.week_key}:v${episode.version}:${episode.source_hash.slice(0, 12)}`
      : `urn:the-ai-wire:article:${episode.id}:v${episode.version}:${episode.source_hash.slice(0, 12)}`;
    const duration = episode.duration_seconds
      ? `\n      <itunes:duration>${Math.round(Number(episode.duration_seconds))}</itunes:duration>`
      : '';
    return `    <item>
      <title>${xmlEscape(episode.title)}</title>
      <link>${xmlEscape(itemUrl)}</link>
      <guid isPermaLink="false">${xmlEscape(guid)}</guid>
      <pubDate>${new Date(episode.published_at).toUTCString()}</pubDate>
      <description>${xmlEscape(description)}</description>
      <itunes:author>${xmlEscape(PODCAST_AUTHOR)}</itunes:author>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>false</itunes:explicit>
      <enclosure url="${xmlEscape(episode.blob_url)}" length="${xmlEscape(episode.byte_length)}" type="${xmlEscape(episode.media_type)}" />${duration}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${xmlEscape(PODCAST_TITLE)}</title>
    <link>${xmlEscape(siteUrl)}</link>
    <description>${xmlEscape(PODCAST_DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml" />
    <itunes:author>${xmlEscape(PODCAST_AUTHOR)}</itunes:author>
    <itunes:summary>${xmlEscape(PODCAST_DESCRIPTION)}</itunes:summary>
    <itunes:type>episodic</itunes:type>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="${xmlEscape(PODCAST_CATEGORY)}" />
    <itunes:image href="${xmlEscape(artworkUrl)}" />
    <image>
      <url>${xmlEscape(artworkUrl)}</url>
      <title>${xmlEscape(PODCAST_TITLE)}</title>
      <link>${xmlEscape(siteUrl)}</link>
    </image>
${items}
  </channel>
</rss>
`;
}

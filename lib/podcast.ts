import { query } from './db';

export const PODCAST_TITLE = 'The AI Wire Audio';
export const PODCAST_AUTHOR = 'The AI Wire';
export const PODCAST_CATEGORY = 'Technology';
export const PODCAST_DESCRIPTION =
  'AI news dispatches from The AI Wire, narrated by an AI-generated voice.';

export interface PodcastEpisode {
  id: number;
  version: number;
  source_hash: string;
  title: string;
  summary: string | null;
  slug: string;
  published_at: string;
  blob_url: string;
  byte_length: string;
  media_type: string;
}

export async function getPodcastEpisodes(): Promise<PodcastEpisode[]> {
  return query<PodcastEpisode>(
    `SELECT
       articles.id,
       articles.version,
       article_audio.source_hash,
       articles.title,
       articles.summary,
       articles.slug,
       articles.published_at,
       article_audio.blob_url,
       article_audio.byte_length,
       article_audio.media_type
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
     ORDER BY articles.published_at DESC`
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
    const articleUrl = absoluteUrl(baseUrl, `/articles/${encodeURIComponent(episode.slug)}`);
    const description = [
      episode.summary,
      'This episode is narrated by an AI-generated voice.',
    ].filter(Boolean).join(' ');
    const guid = `urn:the-ai-wire:article:${episode.id}:v${episode.version}:${episode.source_hash.slice(0, 12)}`;
    return `    <item>
      <title>${xmlEscape(episode.title)}</title>
      <link>${xmlEscape(articleUrl)}</link>
      <guid isPermaLink="false">${xmlEscape(guid)}</guid>
      <pubDate>${new Date(episode.published_at).toUTCString()}</pubDate>
      <description>${xmlEscape(description)}</description>
      <itunes:author>${xmlEscape(PODCAST_AUTHOR)}</itunes:author>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>false</itunes:explicit>
      <enclosure url="${xmlEscape(episode.blob_url)}" length="${xmlEscape(episode.byte_length)}" type="${xmlEscape(episode.media_type)}" />
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

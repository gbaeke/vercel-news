import { SITE_NAME, SITE_TAGLINE } from './config';
import { xmlEscape } from './xml';
import type { Article } from './types';

export type ArticleFeedItem = Pick<
  Article,
  | 'id'
  | 'title'
  | 'content_html'
  | 'summary'
  | 'slug'
  | 'tags'
  | 'published_at'
>;

function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export function buildArticleFeed(baseUrl: string, articles: ArticleFeedItem[]): string {
  const feedUrl = absoluteUrl(baseUrl, '/feed.xml');
  const siteUrl = absoluteUrl(baseUrl, '/');
  const lastBuildDate = articles[0]?.published_at
    ? new Date(articles[0].published_at).toUTCString()
    : new Date(0).toUTCString();

  const items = articles.map((article) => {
    const articleUrl = absoluteUrl(baseUrl, `/articles/${encodeURIComponent(article.slug!)}`);
    const description = article.summary ?? '';
    const category = article.tags?.primary
      ? `\n      <category>${xmlEscape(article.tags.primary)}</category>`
      : '';
    const content = article.content_html
      ? `\n      <content:encoded>${cdata(article.content_html)}</content:encoded>`
      : '';

    return `    <item>
      <title>${xmlEscape(article.title!)}</title>
      <link>${xmlEscape(articleUrl)}</link>
      <guid isPermaLink="false">urn:the-ai-wire:article:${article.id}</guid>
      <pubDate>${new Date(article.published_at!).toUTCString()}</pubDate>
      <description>${xmlEscape(description)}</description>${category}${content}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xmlEscape(SITE_NAME)}</title>
    <link>${xmlEscape(siteUrl)}</link>
    <description>${xmlEscape(SITE_TAGLINE)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}

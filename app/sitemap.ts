import type { MetadataRoute } from 'next';
import { getPublishedArticles } from '../lib/publicQueries';
import { getPublicBaseUrl } from '../lib/config';

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicBaseUrl();
  const articles = await getPublishedArticles();
  const publishedArticles = articles.filter((article) => article.slug && article.published_at);
  const latestPublishedAt = publishedArticles[0]?.published_at;

  return [
    {
      url: baseUrl,
      ...(latestPublishedAt ? { lastModified: new Date(latestPublishedAt) } : {}),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...publishedArticles.map((article) => ({
      url: new URL(`/articles/${article.slug}`, `${baseUrl}/`).toString(),
      lastModified: new Date(article.published_at as string),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
      ...(article.thumbnail_url ? { images: [article.thumbnail_url] } : {}),
    })),
  ];
}

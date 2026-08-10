import type { MetadataRoute } from 'next';
import { getPublishedArticles } from '../lib/publicQueries';
import { getPublicBaseUrl } from '../lib/config';

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getPublicBaseUrl();
  const articles = await getPublishedArticles();

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...articles
      .filter((article) => article.slug && article.published_at)
      .map((article) => ({
        url: new URL(`/articles/${article.slug}`, `${baseUrl}/`).toString(),
        lastModified: article.published_at as string,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
        ...(article.thumbnail_url ? { images: [article.thumbnail_url] } : {}),
      })),
  ];
}

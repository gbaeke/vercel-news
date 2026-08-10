import type { MetadataRoute } from 'next';
import { getPublicBaseUrl } from '../lib/config';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getPublicBaseUrl();

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/review/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

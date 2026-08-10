export const SITE_NAME = 'The AI Wire';
export const SITE_TAGLINE = 'Machine-drafted, human-approved AI industry news';

export function getPublicBaseUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString().replace(/\/+$/, '');
      }
    } catch {
      // Fall through to the Vercel or production-domain fallback.
    }
  }

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) return `https://${productionUrl.replace(/\/+$/, '')}`;

  const deploymentUrl = process.env.VERCEL_URL?.trim();
  if (deploymentUrl) return `https://${deploymentUrl.replace(/\/+$/, '')}`;

  return 'https://news.baeke.info';
}

import type { MetadataRoute } from 'next';
import { SITE_NAME, SITE_TAGLINE } from '../lib/config';

// Makes the wire installable on a phone home screen. No service worker on
// purpose: nothing is cached or intercepted, so a browser visit behaves
// exactly as it did before.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: 'AI Wire',
    description: SITE_TAGLINE,
    start_url: '/',
    display: 'standalone',
    background_color: '#F4F0E8',
    theme_color: '#F4F0E8',
    icons: [
      { src: '/icon1', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}

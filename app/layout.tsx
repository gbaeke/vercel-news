import type { Metadata, Viewport } from 'next';
import { Newsreader, IBM_Plex_Mono } from 'next/font/google';
import { SITE_NAME, SITE_TAGLINE } from '../lib/config';
import './globals.css';

const body = Newsreader({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  appleWebApp: { capable: true, title: 'AI Wire', statusBarStyle: 'default' },
};

// Paper and night-mode paper, so the iOS status bar matches the page. This
// keys off the OS setting, not the wire's own theme toggle — the two can
// disagree if you flip the toggle against your system preference.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F0E8' },
    { media: '(prefers-color-scheme: dark)', color: '#171310' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

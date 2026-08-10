import type { Metadata, Viewport } from 'next';
import { Newsreader, IBM_Plex_Mono } from 'next/font/google';
import { getPublicBaseUrl, SITE_NAME, SITE_TAGLINE } from '../lib/config';
import './globals.css';

const body = Newsreader({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });

export const metadata: Metadata = {
  metadataBase: new URL(getPublicBaseUrl()),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  alternates: { canonical: '/', types: { 'application/rss+xml': '/feed.xml' } },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_TAGLINE,
  },
  appleWebApp: { capable: true, title: 'AI Wire', statusBarStyle: 'default' },
  // iOS reads the apple-prefixed name; Chrome deprecated it in favour of the
  // standardised one and warns in the console. Ship both.
  other: { 'mobile-web-app-capable': 'yes' },
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

// Applies the persisted night theme before first paint. It goes on <html>
// because the root layout is never re-rendered — client-side navigations
// cannot drop it, so the wire never flashes light on the way to a new page.
const THEME_SCRIPT = `try{if(localStorage.getItem('aiwire-theme')==='night')document.documentElement.classList.add('night')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Bricolage_Grotesque, Newsreader, Spline_Sans_Mono } from 'next/font/google';
import { SITE_NAME, SITE_TAGLINE } from '../lib/config';
import './globals.css';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' });
const body = Newsreader({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-body' });
const mono = Spline_Sans_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

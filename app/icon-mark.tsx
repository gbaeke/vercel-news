// The app marks, drawn at build time by next/og so there are no binary images
// to keep in sync with the palette. Full-bleed squares — iOS applies its own
// rounded mask, and anything within ~10% of an edge gets clipped by it.
//
// Two marks on purpose: the stacked wordmark is for sizes where you can read
// it (home screen, PWA), and the lone W is for the 32px browser tab, where
// "AI / WIRE" would collapse into mush.

import fs from 'node:fs';
import path from 'node:path';

const PAPER = '#F4F0E8';
const INK = '#191713';
const RED = '#C8361E';

// Newsreader Bold — the masthead face, SIL Open Font License. Read off disk
// rather than fetched: these routes are prerendered at build time, when there
// is no origin to resolve an asset URL against.
export function loadFont(): Buffer {
  return fs.readFileSync(path.join(process.cwd(), 'app', 'newsreader-700.ttf'));
}

const serif = {
  fontFamily: 'Newsreader',
  fontWeight: 700,
  color: PAPER,
  lineHeight: 1,
} as const;

const field = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: INK,
} as const;

export function WordmarkMark({ size }: { size: number }) {
  return (
    <div style={field}>
      <div style={{ ...serif, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontSize: size * 0.3 }}>AI</div>
        <div
          style={{
            width: size * 0.46,
            height: size * 0.03,
            background: RED,
            margin: `${size * 0.045}px 0`,
          }}
        />
        <div style={{ display: 'flex', fontSize: size * 0.22 }}>WIRE</div>
      </div>
    </div>
  );
}

export function LetterMark({ size }: { size: number }) {
  return (
    <div style={field}>
      <div style={{ ...serif, display: 'flex', fontSize: size * 0.8 }}>W</div>
    </div>
  );
}

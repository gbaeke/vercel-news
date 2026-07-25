import { ImageResponse } from 'next/og';
import { loadFont, LetterMark } from './icon-mark';

// Browser tab / bookmark size — the lone W, since the wordmark is illegible here.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  const font = loadFont();
  return new ImageResponse(<LetterMark size={size.width} />, {
    ...size,
    fonts: [{ name: 'Newsreader', data: font, weight: 700, style: 'normal' }],
  });
}

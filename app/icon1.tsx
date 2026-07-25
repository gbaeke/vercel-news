import { ImageResponse } from 'next/og';
import { loadFont, WordmarkMark } from './icon-mark';

// The large PWA icon the manifest points at (Android install, task switchers).
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  const font = loadFont();
  return new ImageResponse(<WordmarkMark size={size.width} />, {
    ...size,
    fonts: [{ name: 'Newsreader', data: font, weight: 700, style: 'normal' }],
  });
}

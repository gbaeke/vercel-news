import { ImageResponse } from 'next/og';
import { IconMark } from './icon-mark';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(<IconMark size={size.width} />, size);
}

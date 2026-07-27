import { ImageResponse } from 'next/og';
import { loadFont, WordmarkMark } from '../icon-mark';

export const runtime = 'nodejs';

export async function GET() {
  const size = 1_400;
  const font = loadFont();
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#191713',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: 930, height: 930, display: 'flex' }}>
        <WordmarkMark size={930} />
      </div>
      <div
        style={{
          display: 'flex',
          color: '#F4F0E8',
          fontFamily: 'Newsreader',
          fontSize: 94,
          fontWeight: 700,
          letterSpacing: 24,
          marginTop: -120,
          paddingLeft: 24,
        }}
      >
        AUDIO
      </div>
    </div>,
    {
      width: size,
      height: size,
      fonts: [{ name: 'Newsreader', data: font, weight: 700, style: 'normal' }],
    }
  );
}

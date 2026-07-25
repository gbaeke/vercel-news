// The home-screen / tab mark, drawn at build time by next/og so there are no
// binary assets to keep in sync with the palette. Full-bleed square — iOS
// applies its own rounded mask.
export function IconMark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: size * 0.06,
        background: '#F4F0E8',
        color: '#191713',
        borderTop: `${Math.round(size * 0.1)}px solid #191713`,
        borderBottom: `${Math.round(size * 0.1)}px solid #191713`,
      }}
    >
      <div style={{ display: 'flex', fontSize: size * 0.52, lineHeight: 1 }}>W</div>
      {/* The live-wire dot from the topbar. */}
      <div
        style={{
          width: size * 0.09,
          height: size * 0.09,
          borderRadius: '50%',
          background: '#C8361E',
        }}
      />
    </div>
  );
}

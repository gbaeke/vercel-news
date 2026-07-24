function hashHue(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function placeholderSvgDataUrl(title: string): string {
  const hue = hashHue(title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 70%, 45%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 60) % 360}, 70%, 30%)"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

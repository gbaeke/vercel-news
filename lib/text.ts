import sanitizeHtml from 'sanitize-html';

// Scraped article bodies and RSS descriptions arrive as HTML; the pipeline
// stores and prompts with plain text only.
export function htmlToText(html: string): string {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SourceLink {
  label: string;
  url: string;
}

const SOURCE_LINKS_HEADING = 'Links from the original article:';

function markdownLink(label: string, url: string): string {
  const escapedLabel = label
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
  return `[${escapedLabel}](${url.replace(/\)/g, '%29')})`;
}

function safeUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function sameUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = '';
    b.hash = '';
    return a.href === b.href;
  } catch {
    return left === right;
  }
}

/**
 * Keeps the readable source text while preserving article-body links as a
 * compact Markdown list. The list is source material for the writer and is
 * also available for publication when a story refers to a linked item.
 */
export function htmlToTextWithLinks(html: string, baseUrl: string): string {
  const text = htmlToText(html);
  const safeHtml = sanitizeHtml(html, {
    allowedTags: ['a'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https'],
  });
  const links: SourceLink[] = [];
  const seen = new Set<string>();
  const anchors = safeHtml.matchAll(/<a\s+href="([^"]+)">([\s\S]*?)<\/a>/gi);

  for (const match of anchors) {
    const url = safeUrl(match[1], baseUrl);
    const label = htmlToText(match[2]);
    if (!url || !label || sameUrl(url, baseUrl) || seen.has(url)) continue;
    seen.add(url);
    links.push({ label, url });
  }

  if (links.length === 0) return text;
  return `${text}\n\n${SOURCE_LINKS_HEADING}\n${links.map((link) => `- ${markdownLink(link.label, link.url)}`).join('\n')}`;
}

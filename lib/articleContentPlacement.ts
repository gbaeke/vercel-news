export interface ArticleHtmlSplit {
  beforeHtml: string;
  afterHtml: string;
}

export function countArticleParagraphs(html: string): number {
  return html.match(/<p(?:\s[^>]*)?>/gi)?.length ?? 0;
}

export function splitArticleHtmlAfterParagraph(
  html: string,
  afterParagraph: number
): ArticleHtmlSplit {
  if (!Number.isInteger(afterParagraph) || afterParagraph <= 0) {
    return { beforeHtml: '', afterHtml: html };
  }

  const closingParagraph = /<\/p\s*>/gi;
  let boundary = -1;
  for (let paragraph = 0; paragraph < afterParagraph; paragraph += 1) {
    const match = closingParagraph.exec(html);
    if (!match) return { beforeHtml: html, afterHtml: '' };
    boundary = match.index + match[0].length;
  }

  return {
    beforeHtml: html.slice(0, boundary).trim(),
    afterHtml: html.slice(boundary).trim(),
  };
}

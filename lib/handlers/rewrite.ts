import { query } from '../db';
import { complete, structured } from '../llm';
import { loadPrompt } from '../prompts';
import { renderMarkdown } from '../markdown';
import type { Article } from '../types';

interface FinishResult {
  title: string;
  content_md: string;
  summary: string;
}

const FINISH_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content_md: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'content_md', 'summary'],
  additionalProperties: false,
};

export async function rewriteHandler(article: Article): Promise<string> {
  const rewritten = await complete(
    loadPrompt('rewrite-system'),
    loadPrompt('rewrite-user', { feedback: article.feedback ?? '', content: article.content_md ?? '' })
  );

  const finished = await structured<FinishResult>(
    loadPrompt('finish-system'),
    loadPrompt('finish-user', { content: rewritten }),
    FINISH_SCHEMA
  );

  const contentHtml = renderMarkdown(finished.content_md);

  await query(
    `UPDATE articles SET
       title = $1, content_md = $2, content_html = $3, summary = $4,
       version = version + 1, status = 'in_review', claimed_at = NULL, updated_at = now()
     WHERE id = $5`,
    [finished.title, finished.content_md, contentHtml, finished.summary, article.id]
  );
  return 'in_review';
}

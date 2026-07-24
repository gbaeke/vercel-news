import { query } from '../db';
import { structured } from '../llm';
import { loadPrompt } from '../prompts';
import { getTags } from '../tags';
import type { Article } from '../types';

interface TagResult {
  relevant: boolean;
  primary: string;
  secondary: string[];
}

function tagSchema(tags: string[]) {
  return {
    type: 'object',
    properties: {
      relevant: { type: 'boolean' },
      primary: { type: 'string', enum: tags },
      secondary: { type: 'array', items: { type: 'string', enum: tags }, maxItems: 3 },
    },
    required: ['relevant', 'primary', 'secondary'],
    additionalProperties: false,
  };
}

export async function tagHandler(article: Article): Promise<string> {
  const tags = await getTags();
  if (tags.length === 0) {
    throw new Error('no tags configured — add tags on the review settings page');
  }

  const system = loadPrompt('tag-system', { tags: tags.join(', ') });
  const user = loadPrompt('tag-user', { content: article.trigger_content ?? '' });
  const result = await structured<TagResult>(system, user, tagSchema(tags));

  // Declining is terminal — only do it on an explicit verdict. Malformed
  // output must throw (-> failed, retryable), never silently decline.
  if (typeof result.relevant !== 'boolean') {
    throw new Error('tagging returned malformed output (missing relevant verdict)');
  }

  if (!result.relevant) {
    await query(
      `UPDATE articles SET status = 'declined', error = $1, claimed_at = NULL, updated_at = now() WHERE id = $2`,
      ['auto-declined: not AI-industry news', article.id]
    );
    return 'declined';
  }

  await query(
    `UPDATE articles SET tags = $1, status = 'tagged', claimed_at = NULL, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ primary: result.primary, secondary: result.secondary }), article.id]
  );
  return 'tagged';
}

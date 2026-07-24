import { claimNext } from './claim';
import { query } from './db';
import { HANDLERS, type Handler } from './handlers/registry';

const DEFAULT_BUDGET_MS = 240_000;

export interface TickResult {
  id: number;
  from: string;
  to: string;
}

export async function runTick(
  handlers: Record<string, Handler> = HANDLERS,
  budgetMs: number = Number(process.env.TICK_BUDGET_MS ?? DEFAULT_BUDGET_MS)
): Promise<TickResult[]> {
  const deadline = Date.now() + budgetMs;
  const processed: TickResult[] = [];

  while (Date.now() < deadline) {
    const article = await claimNext();
    if (!article) break;

    const handler = handlers[article.status];
    if (!handler) {
      await query(`UPDATE articles SET claimed_at = NULL WHERE id = $1`, [article.id]);
      break;
    }

    try {
      const to = await handler(article);
      console.log(`[tick] article ${article.id}: ${article.status} -> ${to}`);
      processed.push({ id: article.id, from: article.status, to });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE articles SET status = 'failed', failed_from = $1, error = $2, claimed_at = NULL, updated_at = now() WHERE id = $3`,
        [article.status, message, article.id]
      );
      console.log(`[tick] article ${article.id}: ${article.status} -> failed (${message})`);
      processed.push({ id: article.id, from: article.status, to: 'failed' });
    }
  }

  return processed;
}

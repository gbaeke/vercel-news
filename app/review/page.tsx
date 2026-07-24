import Link from 'next/link';
import { query } from '../../lib/db';
import { formatDateTime } from '../../lib/format';
import { runTickNow } from './[id]/actions';
import { StatusChip } from '../ui';
import type { Article } from '../../lib/types';

export const dynamic = 'force-dynamic';

const GROUPS = [
  { title: 'Waiting for you', statuses: ['in_review'] },
  { title: 'Failed', statuses: ['failed'] },
  {
    title: 'In the pipeline',
    statuses: ['new', 'scraped', 'tagged', 'written', 'rewrite_requested', 'image_requested', 'approved'],
  },
  { title: 'Recently closed', statuses: ['published', 'declined'] },
];

export default async function ReviewListPage() {
  const articles = await query<Article>(`SELECT * FROM articles ORDER BY updated_at DESC LIMIT 200`);

  return (
    <div className="shell">
      <header className="desk-bar">
        <Link href="/review" className="desk-mark">
          The AI Wire — <em>Desk</em>
        </Link>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <Link href="/review/settings" className="btn">
            Settings
          </Link>
          <form action={runTickNow}>
            <button type="submit" className="btn">
              Run tick now
            </button>
          </form>
        </div>
      </header>

      {articles.length === 0 && (
        <div className="empty-state">
          <span className="meta">desk clear</span>
          <p>No articles yet. The next scheduled tick will pull from the feeds, or run one now.</p>
        </div>
      )}

      {GROUPS.map((group) => {
        const rows = articles.filter((a) => group.statuses.includes(a.status));
        if (rows.length === 0) return null;
        return (
          <section key={group.title}>
            <h2 className="section-head">
              {group.title} ({rows.length})
            </h2>
            <ul className="desk-list">
              {rows.map((a) => (
                <li key={a.id} className="desk-row">
                  <StatusChip status={a.status} />
                  <Link href={`/review/${a.id}`} className="desk-row-title">
                    {a.title ?? a.trigger_title ?? a.trigger_url}
                  </Link>
                  <span className="meta">{formatDateTime(a.updated_at)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

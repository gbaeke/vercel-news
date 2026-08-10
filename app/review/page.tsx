import Link from 'next/link';
import { query } from '../../lib/db';
import { formatDateTime } from '../../lib/format';
import { runTickNow } from './[id]/actions';
import { submitStoryUrl } from './actions';
import { SubmitButton } from './submit-button';
import { RefreshButton } from './refresh-button';
import { logout } from './login/actions';
import { StatusChip } from '../ui';
import type { Article } from '../../lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const GROUPS = [
  { title: 'Waiting for source approval', statuses: ['rss_pending_review'] },
  { title: 'Waiting for final approval', statuses: ['rss_final_review', 'in_review'] },
  { title: 'Failed', statuses: ['failed'] },
  {
    title: 'In the pipeline',
    statuses: ['new', 'scraped', 'tagged', 'written', 'rewrite_requested', 'image_requested', 'approved'],
  },
  { title: 'Recently closed', statuses: ['published', 'declined'] },
];

export default async function ReviewListPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const articles = await query<Article>(`SELECT * FROM articles ORDER BY updated_at DESC LIMIT 200`);

  return (
    <div className="shell">
      <header className="desk-bar">
        <Link href="/review" className="desk-mark">
          The AI Wire — <em>Desk</em>
        </Link>
        <div className="desk-actions">
          <Link href="/" className="btn">
            View the wire ↗
          </Link>
          <Link href="/review/settings" className="btn">
            Settings
          </Link>
          <form action={logout}>
            <button type="submit" className="btn">Sign out</button>
          </form>
          <RefreshButton />
          <form action={runTickNow} className="desk-actions__wide">
            <SubmitButton
              label="Check feeds & process"
              pendingLabel="Checking feeds & processing…"
            />
          </form>
        </div>
      </header>

      {params.error && <p className="error-note">{params.error}</p>}
      {params.notice && <p className="notice-note">{params.notice}</p>}

      <section>
        <h2 className="section-head">Submit a story</h2>
        <p className="meta">
          Paste a source URL to put it in the same processing queue as a story discovered through RSS.
        </p>
        <form action={submitStoryUrl} className="settings-form">
          <input
            type="url"
            name="url"
            placeholder="https://example.com/story"
            required
            maxLength={2048}
            className="settings-input settings-input--wide"
            aria-label="Story URL"
          />
          <SubmitButton
            label="Submit story"
            pendingLabel="Submitting story…"
            className="btn btn--primary"
          />
        </form>
      </section>

      {articles.length === 0 && (
        <div className="empty-state">
          <span className="meta">desk clear</span>
          <p>No articles yet. The next scheduled run will check the feeds, or you can process them now.</p>
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

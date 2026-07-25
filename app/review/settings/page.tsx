import Link from 'next/link';
import { getTags } from '../../../lib/tags';
import { getFeeds } from '../../../lib/feeds';
import { createTag, removeTag, createFeed, removeFeed, testFeed } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { notice?: string; error?: string };
}) {
  const [tags, feeds] = await Promise.all([getTags(), getFeeds()]);

  return (
    <div className="shell">
      <header className="desk-bar">
        <Link href="/review" className="desk-mark">
          The AI Wire — <em>Desk</em>
        </Link>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <Link href="/" className="btn">
            View the wire ↗
          </Link>
          <Link href="/review" className="btn">
            Back to desk
          </Link>
        </div>
      </header>

      {searchParams.error && <p className="error-note">{searchParams.error}</p>}
      {searchParams.notice && <p className="notice-note">{searchParams.notice}</p>}

      <section>
        <h2 className="section-head">Tags ({tags.length})</h2>
        <p className="meta">
          The tagging step only assigns tags from this list; the public wire filter shows them all.
        </p>
        <ul className="settings-list">
          {tags.map((tag) => (
            <li key={tag} className="settings-row">
              <span className="tag-chip">{tag}</span>
              <form action={removeTag.bind(null, tag)}>
                <button type="submit" className="btn btn--danger">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={createTag} className="settings-form">
          <input
            type="text"
            name="name"
            placeholder="new-tag"
            required
            maxLength={30}
            className="settings-input"
          />
          <button type="submit" className="btn btn--primary">
            Add tag
          </button>
        </form>
      </section>

      <section>
        <h2 className="section-head">RSS feeds ({feeds.length})</h2>
        <p className="meta">
          The daily ingest polls each feed for new articles. New feeds are validated before they are
          added; use Test to re-check one at any time.
        </p>
        <ul className="settings-list">
          {feeds.map((feed) => (
            <li key={feed.name} className="settings-row">
              <span className="settings-feed-name">{feed.name}</span>
              <span className="settings-feed-url">{feed.url}</span>
              <form action={testFeed.bind(null, feed.name)}>
                <button type="submit" className="btn">
                  Test
                </button>
              </form>
              <form action={removeFeed.bind(null, feed.name)}>
                <button type="submit" className="btn btn--danger">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={createFeed} className="settings-form">
          <input
            type="text"
            name="name"
            placeholder="feed-name"
            required
            maxLength={30}
            className="settings-input"
          />
          <input
            type="url"
            name="url"
            placeholder="https://example.com/rss.xml"
            required
            className="settings-input settings-input--wide"
          />
          <button type="submit" className="btn btn--primary">
            Validate &amp; add
          </button>
        </form>
      </section>
    </div>
  );
}

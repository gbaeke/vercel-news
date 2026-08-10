import Link from 'next/link';
import { getTagConfigs } from '../../../lib/tags';
import { getFeeds } from '../../../lib/feeds';
import { getPersonas } from '../../../lib/personas';
import {
  assignTagPersona,
  createTag,
  removeTag,
  createFeed,
  removeFeed,
  testFeed,
} from './actions';
import { SubmitButton } from '../submit-button';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [tags, feeds] = await Promise.all([getTagConfigs(), getFeeds()]);
  const personas = getPersonas();

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
          <Link href="/review" className="btn">
            Back to desk
          </Link>
        </div>
      </header>

      {params.error && <p className="error-note">{params.error}</p>}
      {params.notice && <p className="notice-note">{params.notice}</p>}

      <section>
        <h2 className="section-head">Tags ({tags.length})</h2>
        <p className="meta">
          The tagging step only assigns tags from this list. Each tag chooses the writing persona
          used when it is the article&apos;s primary tag.
        </p>
        <ul className="settings-list">
          {tags.map((tag) => (
            <li key={tag.name} className="settings-row settings-row--tag">
              <span className="tag-chip">{tag.name}</span>
              <form
                action={assignTagPersona.bind(null, tag.name)}
                className="settings-tag-persona"
              >
                <select
                  name="persona"
                  defaultValue={tag.personaId}
                  className="settings-input settings-persona-select"
                  aria-label={`Persona for ${tag.name}`}
                >
                  {!personas.some((persona) => persona.name === tag.personaId) && (
                    <option value={tag.personaId}>Unknown: {tag.personaId}</option>
                  )}
                  {personas.map((persona) => (
                    <option key={persona.name} value={persona.name}>
                      {persona.name}
                    </option>
                  ))}
                </select>
                <SubmitButton label="Save" pendingLabel="Saving…" />
              </form>
              <form action={removeTag.bind(null, tag.name)}>
                <SubmitButton
                  label="Delete"
                  pendingLabel="Deleting…"
                  className="btn btn--danger"
                />
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
          <select
            name="persona"
            required
            defaultValue=""
            className="settings-input settings-persona-select"
            aria-label="Persona for new tag"
          >
            <option value="" disabled>
              Choose persona
            </option>
            {personas.map((persona) => (
              <option key={persona.name} value={persona.name}>
                {persona.name}
              </option>
            ))}
          </select>
          <SubmitButton
            label="Add tag"
            pendingLabel="Adding tag…"
            className="btn btn--primary"
          />
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
            <li key={feed.name} className="settings-row settings-row--feed">
              <span className="settings-feed-name">{feed.name}</span>
              <span className="settings-feed-url">{feed.url}</span>
              <form
                action={testFeed.bind(null, feed.name)}
                className="settings-feed-action settings-feed-action--test"
              >
                <SubmitButton label="Test" pendingLabel="Testing…" />
              </form>
              <form
                action={removeFeed.bind(null, feed.name)}
                className="settings-feed-action settings-feed-action--delete"
              >
                <SubmitButton
                  label="Delete"
                  pendingLabel="Deleting…"
                  className="btn btn--danger"
                />
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
          <SubmitButton
            label="Validate & add"
            pendingLabel="Validating feed…"
            className="btn btn--primary"
          />
        </form>
      </section>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { sharedStoryUrl } from '../../../lib/sharedUrl';
import { submitStoryUrl } from '../actions';
import { SubmitButton } from '../submit-button';

export const metadata: Metadata = {
  title: 'Send to AI Wire',
  robots: { index: false, follow: false },
};

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; text?: string; title?: string }>;
}) {
  const params = await searchParams;
  const url = sharedStoryUrl(params);

  return (
    <div className="shell shell--capture">
      <header className="desk-bar">
        <Link href="/review" className="desk-mark">
          The AI Wire — <em>Desk</em>
        </Link>
        <Link href="/review" className="btn">Cancel</Link>
      </header>

      <section>
        <p className="kicker">PHONE CAPTURE</p>
        <h1 className="capture-title">Send to AI Wire</h1>
        <p className="meta">
          Confirm the source URL and it will enter the normal article pipeline.
        </p>
        {params.title && <p className="capture-source-title">{params.title}</p>}
        <form action={submitStoryUrl} className="settings-form capture-form">
          <input
            type="url"
            name="url"
            defaultValue={url}
            placeholder="https://example.com/story"
            required
            maxLength={2048}
            autoFocus={!url}
            className="settings-input settings-input--wide"
            aria-label="Story URL"
          />
          <SubmitButton
            label="Queue story"
            pendingLabel="Queueing…"
            className="btn btn--primary"
          />
        </form>
      </section>
    </div>
  );
}

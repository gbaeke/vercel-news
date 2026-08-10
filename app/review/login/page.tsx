import Link from 'next/link';
import { login } from './actions';
import { SubmitButton } from '../submit-button';
import { safeReviewReturnTo } from '../../../lib/reviewReturnTo';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReviewReturnTo(params.next);
  const errorMessage = params.error === 'config'
    ? 'The desk password is not configured on the server.'
    : params.error === 'unavailable'
      ? 'The desk could not create a session. Please try again.'
      : params.error === 'rate_limit'
        ? 'Too many login attempts. Wait 15 minutes and try again.'
        : params.error === 'session'
          ? 'Your desk session expired. Sign in again.'
          : params.error
        ? 'Wrong password. Try again.'
        : null;

  return (
    <div className="login-wrap">
      <main className="login-card">
        <span className="wordmark">
          The AI <em>Wire</em>
        </span>
        <p className="meta" style={{ marginTop: '0.35rem' }}>
          Editor&apos;s desk
        </p>
        <form action={login}>
          <input type="hidden" name="next" value={returnTo} />
          <label htmlFor="password">Desk password</label>
          <input id="password" type="password" name="password" autoFocus required />
          <SubmitButton
            label="Open the desk"
            pendingLabel="Opening desk…"
            className="btn btn--primary btn--wide"
          />
          {errorMessage && (
            <p className="error-note" style={{ margin: 0 }}>
              {errorMessage}
            </p>
          )}
        </form>
        {/* The public footer links here, so readers who wander in need a way out. */}
        <Link href="/" className="meta login-back">
          ← Back to the wire
        </Link>
      </main>
    </div>
  );
}

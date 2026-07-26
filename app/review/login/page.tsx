import Link from 'next/link';
import { login } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const errorMessage = searchParams.error === 'config'
    ? 'The desk password is not configured on the server.'
    : searchParams.error === 'unavailable'
      ? 'The desk could not create a session. Please try again.'
      : searchParams.error
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
          <label htmlFor="password">Desk password</label>
          <input id="password" type="password" name="password" autoFocus required />
          <button type="submit" className="btn btn--primary btn--wide">
            Open the desk
          </button>
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

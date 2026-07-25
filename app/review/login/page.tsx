import Link from 'next/link';
import { login } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
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
          {searchParams.error && (
            <p className="error-note" style={{ margin: 0 }}>
              Wrong password. Try again.
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

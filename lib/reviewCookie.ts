export const REVIEW_COOKIE_NAME = 'newsroom_review_session';

// The cookie stores a digest of the password, never the password itself.
// Web Crypto so it runs in both the Edge middleware and Node server actions.
export async function reviewSessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`newsroom-review:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

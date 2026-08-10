export const REVIEW_COOKIE_NAME = 'newsroom_review_session';
export const REVIEW_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(value: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/.test(value)) return null;
  return Uint8Array.from(
    value.match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16)
  ).buffer as ArrayBuffer;
}

async function hmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage
  );
}

function sessionMessage(expiresAt: number, password: string): ArrayBuffer {
  return new TextEncoder().encode(
    `newsroom-review:v1:${expiresAt}:${password}`
  ).buffer as ArrayBuffer;
}

// The cookie is an expiring HMAC bearer token. The signing key is independent
// from the review password, while including the current password in the signed
// message means rotating either secret revokes every existing session.
export async function reviewSessionToken(
  password: string,
  secret: string,
  expiresAt = Math.floor(Date.now() / 1000) + REVIEW_SESSION_MAX_AGE_SECONDS
): Promise<string> {
  if (!password || !secret) throw new Error('review session configuration is incomplete');
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, ['sign']),
    sessionMessage(expiresAt, password)
  );
  return `v1.${expiresAt}.${hex(signature)}`;
}

export async function verifyReviewSessionToken(
  token: string | null | undefined,
  password: string | undefined,
  secret: string | undefined,
  now = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!token || !password || !secret) return false;
  const [version, rawExpiry, rawSignature, ...rest] = token.split('.');
  if (version !== 'v1' || rest.length > 0 || !/^\d{10}$/.test(rawExpiry)) return false;
  const expiresAt = Number(rawExpiry);
  if (
    !Number.isSafeInteger(expiresAt)
    || expiresAt <= now
    || expiresAt > now + REVIEW_SESSION_MAX_AGE_SECONDS
  ) return false;
  const signature = fromHex(rawSignature);
  if (!signature) return false;
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret, ['verify']),
    signature,
    sessionMessage(expiresAt, password)
  );
}

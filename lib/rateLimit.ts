import { query } from './db';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-vercel-forwarded-for')
    ?? headers.get('x-forwarded-for')
    ?? headers.get('x-real-ip');
  return forwarded?.split(',')[0]?.trim().slice(0, 128) || 'unknown';
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function rateLimitKey(scope: string, identifier: string): Promise<string> {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET is not set');
  return hmacHex(secret, `${scope}:${identifier}`);
}

export async function requestRateLimitKey(scope: string, headers: Headers): Promise<string> {
  return rateLimitKey(scope, clientAddress(headers));
}

export async function consumeRateLimit(
  keyHash: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const [row] = await query<{
    attempts: number;
    retry_after_seconds: number;
  }>(
    `INSERT INTO rate_limits (key_hash, attempts, window_started_at)
     VALUES ($1, 1, now())
     ON CONFLICT (key_hash) DO UPDATE SET
       attempts = CASE
         WHEN rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN 1
         ELSE rate_limits.attempts + 1
       END,
       window_started_at = CASE
         WHEN rate_limits.window_started_at <= now() - ($2 * interval '1 second') THEN now()
         ELSE rate_limits.window_started_at
       END
     RETURNING attempts,
       GREATEST(0, CEIL(EXTRACT(EPOCH FROM
         (window_started_at + ($2 * interval '1 second') - now())
       )))::integer AS retry_after_seconds`,
    [keyHash, windowSeconds]
  );
  const attempts = row?.attempts ?? limit + 1;
  return {
    allowed: attempts <= limit,
    remaining: Math.max(0, limit - attempts),
    retryAfterSeconds: row?.retry_after_seconds ?? windowSeconds,
  };
}

export async function clearRateLimit(keyHash: string): Promise<void> {
  await query(`DELETE FROM rate_limits WHERE key_hash = $1`, [keyHash]);
}

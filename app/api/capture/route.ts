export const runtime = 'nodejs';

import { isCaptureAuthorized } from '../../../lib/captureAuth';
import { submitManualStory } from '../../../lib/manualSubmission';

const MAX_CAPTURE_BODY_BYTES = 4_096;

function json(body: object, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function submittedUrl(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_CAPTURE_BODY_BYTES) throw new Error('body_too_large');

  if (contentType === 'application/json') {
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return parsed && typeof parsed === 'object' ? (parsed as { url?: unknown }).url : undefined;
  }
  if (contentType === 'application/x-www-form-urlencoded') {
    return new URLSearchParams(new TextDecoder().decode(body)).get('url');
  }
  if (contentType === 'multipart/form-data') {
    const formRequest = new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': request.headers.get('content-type') ?? contentType },
      body,
    });
    return (await formRequest.formData()).get('url');
  }
  throw new Error('unsupported_content_type');
}

export async function POST(request: Request): Promise<Response> {
  if (!isCaptureAuthorized(request.headers.get('authorization'))) {
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_CAPTURE_BODY_BYTES) {
    return json({ ok: false, error: 'Request body is too large.' }, 413);
  }

  let url: unknown;
  try {
    url = await submittedUrl(request);
  } catch (error) {
    if (error instanceof Error && error.message === 'body_too_large') {
      return json({ ok: false, error: 'Request body is too large.' }, 413);
    }
    if (error instanceof Error && error.message === 'unsupported_content_type') {
      return json({ ok: false, error: 'Use a JSON or form request body.' }, 415);
    }
    return json({ ok: false, error: 'The request body is not valid.' }, 400);
  }
  // Shortcuts may serialize a single URL variable as a one-item JSON list.
  if (Array.isArray(url) && url.length === 1) url = url[0];

  let result: Awaited<ReturnType<typeof submitManualStory>>;
  try {
    result = await submitManualStory(url);
  } catch (error) {
    console.error('[capture] story submission failed', error);
    return json({ ok: false, error: 'Could not queue that story right now.' }, 500);
  }

  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  if (result.queue.outcome === 'deleted') {
    return json({
      ok: false,
      outcome: 'deleted',
      error: 'That URL was previously deleted and will not be added again.',
    }, 409);
  }

  const duplicate = result.queue.outcome === 'duplicate';
  const message = duplicate
    ? `Already queued as article #${result.queue.id}.`
    : `Queued as article #${result.queue.id}.`;

  return json({
    ok: true,
    outcome: result.queue.outcome,
    articleId: result.queue.id,
    status: result.queue.status,
    url: result.url,
    reviewUrl: new URL(`/review/${result.queue.id}`, request.url).toString(),
    message,
  }, duplicate ? 200 : 201);
}

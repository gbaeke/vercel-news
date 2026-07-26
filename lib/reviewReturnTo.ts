const REVIEW_HOME = '/review';
const LOGIN_PATH = '/review/login';
const VALIDATION_ORIGIN = 'https://desk.local';

export function safeReviewReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return REVIEW_HOME;

  const candidate = value.trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return REVIEW_HOME;
  }

  try {
    const url = new URL(candidate, VALIDATION_ORIGIN);
    const isReviewPath = url.pathname === REVIEW_HOME || url.pathname.startsWith(`${REVIEW_HOME}/`);
    const isLoginPath = url.pathname === LOGIN_PATH || url.pathname.startsWith(`${LOGIN_PATH}/`);

    if (url.origin !== VALIDATION_ORIGIN || !isReviewPath || isLoginPath) return REVIEW_HOME;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return REVIEW_HOME;
  }
}

export function reviewLoginErrorUrl(error: string, returnTo: string): string {
  const params = new URLSearchParams({ error });
  if (returnTo !== REVIEW_HOME) params.set('next', returnTo);
  return `${LOGIN_PATH}?${params}`;
}

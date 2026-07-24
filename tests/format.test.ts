import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime } from '../lib/format';

describe('formatDate', () => {
  it('parses raw Postgres timestamptz strings (microseconds + bare offset)', () => {
    expect(formatDate('2026-07-24 12:05:27.100484+00')).toBe('24 Jul 2026');
  });

  it('parses ISO strings', () => {
    expect(formatDate('2026-07-24T12:05:27.000Z')).toBe('24 Jul 2026');
  });

  it('returns empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });
});

describe('formatDateTime', () => {
  it('includes the time', () => {
    expect(formatDateTime('2026-07-24 12:05:27.100484+00')).toMatch(/24 Jul.*\d{2}:\d{2}/);
  });
});

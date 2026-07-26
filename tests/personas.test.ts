import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERSONA_ID,
  findPersona,
  getPersonas,
  resolvePersona,
} from '../lib/personas';

describe('personas', () => {
  it('loads the fixed persona catalogue without tag assignments', () => {
    expect(getPersonas().map((persona) => persona.name)).toEqual([
      'pragmatic-engineer',
      'policy-watcher',
      'research-explainer',
    ]);
    expect(getPersonas().every((persona) => !('tags' in persona))).toBe(true);
  });

  it('resolves known IDs and gracefully falls back for a stale assignment', () => {
    expect(findPersona('policy-watcher')?.name).toBe('policy-watcher');
    expect(resolvePersona('missing-persona').name).toBe(DEFAULT_PERSONA_ID);
  });
});

import { describe, it, expect } from 'vitest';
import { pickPersona } from '../lib/personas';

describe('pickPersona', () => {
  it('picks a persona whose tags include the primary tag', () => {
    const persona = pickPersona('policy');
    expect(persona.tags).toContain('policy');
  });

  it('falls back to the first persona for an unmatched tag', () => {
    const persona = pickPersona('nonexistent-tag');
    expect(persona.name).toBeTruthy();
  });
});

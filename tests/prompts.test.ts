import { describe, it, expect } from 'vitest';
import { loadPrompt } from '../lib/prompts';

describe('loadPrompt', () => {
  it('substitutes {{ placeholder }} tokens', () => {
    const text = loadPrompt('tag-user', { content: 'hello world' });
    expect(text).toContain('hello world');
    expect(text).not.toContain('{{ content }}');
  });

  it('keeps persona as a light influence and explicitly rejects forced urgency', () => {
    const text = loadPrompt('draft-system', { persona_style: 'Measured test voice.' });
    expect(text).toContain('Measured test voice.');
    expect(text).toContain('light stylistic influence');
    expect(text).toContain('Do not force every story');
    expect(text).toContain('"Monday morning"');
    expect(text).not.toContain('{{ persona_style }}');
  });

  it('builds a weekly dialogue prompt without unresolved source placeholders', () => {
    const text = loadPrompt('weekly-user', {
      week_key: '2026-W30',
      period_start: '2026-07-19T22:00:00.000Z',
      period_end: '2026-07-26T22:00:00.000Z',
      articles: 'ARTICLE 1\nTitle: A model release',
    });
    expect(text).toContain('2026-W30');
    expect(text).toContain('ARTICLE 1');
    expect(text).not.toContain('{{');
  });
});

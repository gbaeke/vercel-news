import { describe, expect, it } from 'vitest';
import Parser from 'rss-parser';
import { buildArticleFeed, type ArticleFeedItem } from '../lib/articleFeed';

const article: ArticleFeedItem = {
  id: 7,
  title: 'Models & <tools>',
  content_html: '<p>Read this &amp; that.</p><p>Closing ]]> safely.</p>',
  summary: 'What "changed" & why',
  slug: 'models-tools',
  tags: { primary: 'models', secondary: [] },
  published_at: '2026-07-27T10:00:00.000Z',
};

describe('article RSS', () => {
  it('builds an escaped RSS feed with canonical links and full article content', async () => {
    const xml = buildArticleFeed('https://wire.example/', [article]);
    const parsed = await new Parser().parseString(xml);

    expect(parsed.title).toBe('The AI Wire');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].guid).toBe('urn:the-ai-wire:article:7');
    expect(parsed.items[0]['content:encoded']).toContain('Closing ]]> safely.');
    expect(xml).toContain('<title>The AI Wire</title>');
    expect(xml).toContain('href="https://wire.example/feed.xml"');
    expect(xml).toContain('<link>https://wire.example/articles/models-tools</link>');
    expect(xml).toContain('<guid isPermaLink="false">urn:the-ai-wire:article:7</guid>');
    expect(xml).toContain('Models &amp; &lt;tools&gt;');
    expect(xml).toContain('What &quot;changed&quot; &amp; why');
    expect(xml).toContain('<category>models</category>');
    expect(xml).toContain('<content:encoded><![CDATA[<p>Read this &amp; that.</p><p>Closing ]]]]><![CDATA[> safely.</p>]]></content:encoded>');
  });

  it('returns a valid empty channel', () => {
    const xml = buildArticleFeed('https://wire.example', []);
    expect(xml).toContain('<channel>');
    expect(xml).toContain('</channel>');
    expect(xml).not.toContain('<item>');
  });
});

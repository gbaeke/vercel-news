import { describe, expect, it } from 'vitest';
import { isYouTubeHost, parseYouTubeVideoUrl, youtubeEmbedUrl } from '../lib/youtube';

describe('YouTube URL handling', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?t=20',
    'https://m.youtube.com/shorts/dQw4w9WgXcQ',
    'https://youtube.com/live/dQw4w9WgXcQ?feature=share',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc',
  ])('extracts and canonicalizes a direct video URL: %s', (url) => {
    expect(parseYouTubeVideoUrl(url)).toEqual({
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });

  it.each([
    'https://youtube.com/@openai',
    'https://youtube.com/playlist?list=abc',
    'https://youtube.com/watch?v=too-short',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
  ])('does not treat a non-video or spoofed URL as a YouTube video: %s', (url) => {
    expect(parseYouTubeVideoUrl(url)).toBeNull();
  });

  it('recognizes only exact supported YouTube hosts', () => {
    expect(isYouTubeHost('WWW.YouTube.com')).toBe(true);
    expect(isYouTubeHost('youtube.com.evil.example')).toBe(false);
  });

  it('constructs embed URLs only from validated IDs', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    );
    expect(youtubeEmbedUrl('bad/id')).toBeNull();
  });
});

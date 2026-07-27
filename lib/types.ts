export interface Article {
  id: number;
  source_feed: string;
  trigger_url: string;
  trigger_title: string | null;
  trigger_content: string | null;
  tags: { primary: string; secondary: string[] } | null;
  persona: string | null;
  title: string | null;
  content_md: string | null;
  content_html: string | null;
  summary: string | null;
  seo_summary: string | null;
  slug: string | null;
  thumbnail_url: string | null;
  feedback: string | null;
  version: number;
  status: string;
  failed_from: string | null;
  error: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  embedding?: string | null;
  embedding_model?: string | null;
  embedded_at?: string | null;
}

export interface FeedState {
  feed_name: string;
  last_url: string | null;
}

export type ArticleAudioStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface ArticleAudio {
  article_id: number;
  article_version: number;
  source_hash: string;
  status: ArticleAudioStatus;
  model: string;
  voice: string;
  blob_url: string | null;
  byte_length: string | null;
  media_type: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  claimed_at: string | null;
  last_error: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

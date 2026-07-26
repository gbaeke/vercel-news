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

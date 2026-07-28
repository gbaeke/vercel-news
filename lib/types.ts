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

export type WeeklyEpisodeStatus =
  | 'preparing'
  | 'scripted'
  | 'generating'
  | 'ready'
  | 'failed';

export type WeeklySegmentStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type WeeklySpeaker = 'host' | 'analyst';

export interface WeeklyDialogueTurn {
  speaker: WeeklySpeaker;
  text: string;
  delivery: string;
}

export interface WeeklyEpisode {
  id: string;
  week_key: string;
  period_start: string;
  period_end: string;
  status: WeeklyEpisodeStatus;
  title: string | null;
  summary: string | null;
  show_notes: string | null;
  script: { turns: WeeklyDialogueTurn[] } | null;
  script_version: number;
  source_hash: string;
  script_hash: string | null;
  provider: string;
  model: string;
  host_voice: string | null;
  analyst_voice: string | null;
  blob_url: string | null;
  byte_length: string | null;
  media_type: string | null;
  duration_seconds: string | null;
  attempt_count: number;
  claimed_at: string | null;
  last_error: string | null;
  generated_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyEpisodeSource {
  episode_id: string;
  position: number;
  article_id: number | null;
  article_version: number;
  title: string;
  url: string;
}

export interface WeeklyEpisodeSegment {
  episode_id: string;
  position: number;
  turns: WeeklyDialogueTurn[];
  source_hash: string;
  status: WeeklySegmentStatus;
  blob_url: string | null;
  byte_length: string | null;
  media_type: string | null;
  duration_seconds: string | null;
  attempt_count: number;
  last_error: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

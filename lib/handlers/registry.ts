import type { Article } from '../types';
import { scrapeHandler } from './scrape';
import { tagHandler } from './tag';
import { writeHandler } from './write';
import { rewriteHandler } from './rewrite';
import { thumbnailHandler } from './thumbnail';
import { publishHandler } from './publish';

export type Handler = (article: Article) => Promise<string>;

export const HANDLERS: Record<string, Handler> = {
  new: scrapeHandler,
  scraped: tagHandler,
  tagged: writeHandler,
  written: thumbnailHandler,
  rewrite_requested: rewriteHandler,
  image_requested: thumbnailHandler,
  approved: publishHandler,
};

const CHIP_CLASS: Record<string, string> = {
  in_review: 'chip--review',
  failed: 'chip--failed',
  published: 'chip--live',
  declined: 'chip--dead',
};

const CHIP_LABEL: Record<string, string> = {
  new: 'ingested',
  scraped: 'scraped',
  tagged: 'tagged',
  written: 'written',
  in_review: 'in review',
  rewrite_requested: 'rewriting',
  image_requested: 'new image',
  approved: 'approved',
  published: 'live',
  declined: 'declined',
  failed: 'failed',
};

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${CHIP_CLASS[status] ?? 'chip--flight'}`}>{CHIP_LABEL[status] ?? status}</span>;
}

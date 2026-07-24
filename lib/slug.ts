function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function generateSlug(
  title: string,
  slugExists: (slug: string) => Promise<boolean>
): Promise<string> {
  const base = slugify(title) || 'article';
  let candidate = base;
  let suffix = 1;
  while (await slugExists(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

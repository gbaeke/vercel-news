'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MAX_SEARCH_LENGTH } from '../lib/searchInput';

export function SearchForm({
  query,
  activeTag,
  clearHref,
}: {
  query: string;
  activeTag: string;
  clearHref: string;
}) {
  const [pending, setPending] = useState(false);

  return (
    <form
      action="/"
      method="get"
      className="mono wire-search"
      aria-label="Search the wire"
      aria-busy={pending}
      onSubmit={() => setPending(true)}
    >
      <label htmlFor="wire-search-input" className="wire-search-label">
        Search /
      </label>
      {activeTag !== 'all' && <input type="hidden" name="tag" value={activeTag} />}
      <div className="wire-search-control">
        <input
          id="wire-search-input"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search the wire…"
          maxLength={MAX_SEARCH_LENGTH}
          className="wire-search-input"
        />
        <button
          type="submit"
          className="wire-search-submit"
          aria-label="Search"
          title="Search"
          disabled={pending}
        >
          {pending ? '…' : '→'}
        </button>
      </div>
      {query && (
        <Link href={clearHref} className="wire-search-clear">
          Clear
        </Link>
      )}
    </form>
  );
}

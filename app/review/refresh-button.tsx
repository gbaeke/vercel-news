'use client';

import { useRouter } from 'next/navigation';

export function RefreshButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="btn"
      onClick={() => router.refresh()}
      aria-label="Refresh the desk"
    >
      Refresh list
    </button>
  );
}

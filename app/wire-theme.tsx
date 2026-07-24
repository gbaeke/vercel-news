'use client';

import { useEffect, useState } from 'react';

const KEY = 'aiwire-theme';

export function ThemeToggle() {
  const [night, setNight] = useState(false);

  // The inline script in WireShell applies the saved theme before paint on
  // full page loads, but it does not run on client-side navigations — so
  // re-apply the class here on every mount, and sync the button label.
  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(KEY) === 'night';
    } catch {}
    setNight(saved);
    document.getElementById('wire-root')?.classList.toggle('night', saved);
  }, []);

  function toggle() {
    const next = !night;
    setNight(next);
    document.getElementById('wire-root')?.classList.toggle('night', next);
    try {
      localStorage.setItem(KEY, next ? 'night' : 'day');
    } catch {}
  }

  return (
    <button type="button" className="pill pill--toggle" onClick={toggle}>
      {night ? '☀ day mode' : '☾ night mode'}
    </button>
  );
}

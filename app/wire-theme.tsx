'use client';

const KEY = 'aiwire-theme';

// No React state on purpose. The theme is a class on <html> (set before first
// paint by the root layout, flipped here) and the label is chosen in CSS from
// that same class — so nothing has to catch up after a render or a navigation.
export function ThemeToggle() {
  function toggle() {
    const night = document.documentElement.classList.toggle('night');
    try {
      localStorage.setItem(KEY, night ? 'night' : 'day');
    } catch {}
  }

  return (
    <button type="button" className="pill pill--toggle" onClick={toggle}>
      <span className="theme-label theme-label--night">☾ night mode</span>
      <span className="theme-label theme-label--day">☀ day mode</span>
    </button>
  );
}

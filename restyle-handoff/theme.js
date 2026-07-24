// Night-mode toggle, shared by every page. Persists in localStorage ("aiwire-theme").
(function () {
  const KEY = 'aiwire-theme';
  const btn = document.getElementById('theme-toggle');
  function apply(night) {
    document.body.classList.toggle('night', night);
    if (btn) btn.textContent = night ? '☀ day mode' : '☾ night mode';
  }
  let night = false;
  try { night = localStorage.getItem(KEY) === 'night'; } catch (e) {}
  apply(night);
  if (btn) btn.onclick = function () {
    night = !night;
    apply(night);
    try { localStorage.setItem(KEY, night ? 'night' : 'day'); } catch (e) {}
  };
})();

// Shared by every Compass page. Chromium doesn't expose a custom browser theme to extensions, so Auto follows the
// colour scheme it does report (the system preference); the options page's Light/Dark choices override it.
(() => {
  const CACHE = 'compass-theme';
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const valid = v => v === 'light' || v === 'dark' ? v : 'auto';
  let pref = 'auto';

  function apply() {
    const theme = pref === 'auto' ? (dark.matches ? 'dark' : 'light') : pref;
    root.dataset.theme = theme;
  }
  function save(next) {
    pref = valid(next);
    try { localStorage.setItem(CACHE, pref); } catch {} // avoids a flash of the other theme on the next open
    apply();
  }

  try { pref = valid(localStorage.getItem(CACHE)); } catch {} // storage can be off: Auto stands until sync answers
  apply(); // run before the stylesheet paints

  let changed = false;
  try {
    chrome.storage.sync.get({ theme: 'auto' }).then(({ theme }) => { if (!changed) save(theme); }, () => {}); // keep the cache if storage won't answer
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'sync' || !c.theme) return;
      changed = true; // a change landed while the read above was in flight: it's newer
      save(c.theme.newValue);
    });
  } catch {} // extension reloaded under the page

  dark.addEventListener('change', () => { if (pref === 'auto') apply(); });
})();

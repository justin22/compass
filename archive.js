// Auto-archive (Arc-style): tabs untouched for 12h close themselves but stay searchable in the bar.
export const ARCHIVE_AFTER = 12 * 60 * 60 * 1000; // ponytail: fixed 12h; make it a setting if it bites

// Pure, so it can be checked without a browser (archive.test.mjs).
export function staleTabs(tabs, favUrls, now) {
  const isFav = t => favUrls.some(u => t.url.startsWith(u.replace(/\/$/, '')));
  return tabs.filter(t =>
    !t.active && !t.pinned && !t.audible && // never the tab you're on, pinned tabs, or playing media
    t.lastAccessed && now - t.lastAccessed > ARCHIVE_AFTER &&
    /^https?:/.test(t.url ?? '') && !isFav(t));
}

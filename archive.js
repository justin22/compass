import { isUnder } from './favs.js';

// Auto-archive (Arc-style): tabs untouched for 12h close themselves but stay searchable in the bar.
export const ARCHIVE_AFTER = 12 * 60 * 60 * 1000; // ponytail: fixed 12h; make it a setting if it bites

// Pure, so it can be checked without a browser (archive.test.mjs).
export function staleTabs(tabs, favUrls, now) {
  return tabs.filter(t =>
    !t.active && !t.pinned && !t.audible && !t.incognito && // never the tab you're on, pinned tabs, playing media, or private tabs (the archive is on disk)
    t.lastAccessed && now - t.lastAccessed > ARCHIVE_AFTER &&
    /^https?:/.test(t.url ?? '') && !favUrls.some(u => isUnder(t.url, u)));
}

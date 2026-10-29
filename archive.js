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

// save closed tabs so the bar can still find them: newest first, one entry per URL, max 500. Private tabs stay off disk.
export async function saveArchive(tabs) {
  const entries = [...new Map(tabs.filter(t => !t.incognito && /^https?:/.test(t.url ?? ''))
    .map(t => [t.url, { url: t.url, title: t.title, archivedAt: Date.now() }])).values()];
  if (!entries.length) return;
  const { archive = [] } = await chrome.storage.local.get('archive');
  const urls = new Set(entries.map(e => e.url));
  await chrome.storage.local.set({ archive: [...entries, ...archive.filter(a => !urls.has(a.url))].slice(0, 500) });
}

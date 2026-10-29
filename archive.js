import { isUnder, listFavs, pinnedTree, linksIn } from './favs.js';

// Auto-archive (Arc-style): tabs untouched for 12h close themselves but stay searchable in the bar.
export const ARCHIVE_AFTER = 12 * 60 * 60 * 1000; // ponytail: fixed 12h; make it a setting if it bites

// Pure, so it can be checked without a browser (archive.test.mjs).
export function staleTabs(tabs, favUrls, now) {
  return tabs.filter(t =>
    !t.active && !t.pinned && !t.audible && !t.incognito && // never the tab you're on, pinned tabs, playing media, or private tabs (the archive is on disk)
    t.lastAccessed && now - t.lastAccessed > ARCHIVE_AFTER &&
    /^https?:/.test(t.url ?? '') && !favUrls.some(u => isUnder(t.url, u)));
}

// the tabs auto-archive would close right now: the worker closes them, the sidebar's Activity popover counts them
export async function dueTabs() {
  const pins = linksIn(await pinnedTree());
  const keepUrls = [...await listFavs(), ...pins].map(f => f.url);
  const { bound = {} } = await chrome.storage.session.get('bound'); // a pinned item's tab, wherever it browsed to
  const boundIds = new Set(pins.map(b => bound[b.id])); // pins that still exist only: a stale binding mustn't keep an unpinned tab
  return staleTabs(await chrome.tabs.query({}), keepUrls, Date.now()).filter(t => !boundIds.has(t.id));
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

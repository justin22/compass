// node archive.test.mjs
import assert from 'node:assert';
import { staleTabs, ARCHIVE_AFTER } from './archive.js';

const now = Date.now(), old = now - ARCHIVE_AFTER - 1, fresh = now - 1000;
const tab = (id, extra) => ({ id, url: `https://site${id}.com/page`, lastAccessed: old, ...extra });
const tabs = [
  tab(1),                                        // stale -> archive
  tab(2, { lastAccessed: fresh }),               // recently used
  tab(3, { active: true }),                      // the tab you're on
  tab(4, { pinned: true }),                      // pinned
  tab(5, { audible: true }),                     // playing media
  tab(6, { url: 'https://fav.com/inbox' }),      // under a favorite
  tab(7, { url: 'chrome://settings' }),          // browser page
  tab(8, { lastAccessed: undefined }),           // unknown age
  tab(9, { incognito: true }),                   // private: never written to disk
];
assert.deepStrictEqual(staleTabs(tabs, ['https://fav.com/'], now).map(t => t.id), [1]);
console.log('archive ok');

import { saveArchive, dueTabs } from './archive.js';
import { favicon, hasScheme, looksLikeUrl, listFavs, addFav, removeBookmark, openTabFor, isUnder, pinnedTree, linksIn, addPin, favTile, addTile, painted, overlayKey } from './favs.js';

const favsEl = document.querySelector('#favs');
const tabsEl = document.querySelector('#tabs');
const pinnedEl = document.querySelector('#pinned');
const { id: windowId } = await chrome.windows.getCurrent(); // the side panel is per window
const PIN = document.querySelector('#dock svg').outerHTML; // same pin icon as the dock button
const embed = window.top !== window; // floating over the page vs. the native side panel
if (embed) await overlayKey();
const close = () => parent.postMessage({ arcBar: 'close' }, '*');
const clearBtn = document.querySelector('#clear'); // here, not with Clear below: render() touches it
let drag = null; // the reorder in progress
let suppressClick = false; // the click that ends a drag shouldn't also switch tabs
let cursorId = null; // keyboard cursor: the row ↑↓ moves and Enter opens (follows the mouse too)
const tabsById = new Map();
let activeTab = null; // the tab the address field shows and navigates
let renaming = null; // the Pinned row (bookmark id) or tab (tab id) to show as a name field on the next render (one-shot)
let names = {}; // tab names given here, by tab id; session storage, so gone when the browser closes
// ponytail: never pruned; tab ids aren't reused within a session so it only grows by renames. Drop keys on tabs.onRemoved if that matters
let bound = {}; // pinned item (bookmark id) -> the tab it opened or was pinned from; it stays that pin's tab wherever it browses (session storage; render() prunes it)
const closedFolders = new Set((await chrome.storage.local.get('closedFolders')).closedFolders); // collapsed Pinned folders

function setCursor(id, focus = false) {
  cursorId = id;
  for (const li of tabsEl.children) li.classList.toggle('cursor', +li.dataset.id === id);
  if (focus) tabsEl.querySelector('.cursor .t')?.focus(); // keys only (focus scrolls it into view): a re-render (pin, new folder) keeps your scroll spot
}
tabsEl.onfocusin = e => { const id = e.target.closest('li')?.dataset.id; if (id) setCursor(+id); }; // tabbing onto a row moves the cursor too

if (embed) document.documentElement.classList.add('embed');

const activate = t => {
  if (embed && !(t.active && t.windowId === windowId)) close(); // pick a tab and get out of the way; the current tab stays open so a double-click can rename it
  chrome.tabs.update(t.id, { active: true });
  if (t.windowId !== windowId) chrome.windows.update(t.windowId, { focused: true }); // a favorite open elsewhere
};
// something just went into a collapsed folder: expand it so you see it land
function openFolder(id) {
  if (closedFolders.delete(id)) chrome.storage.local.set({ closedFolders: [...closedFolders] });
}

// right-click, or drop on a Pinned folder: save the tab to Pinned, and out of Chrome's own pinned strip
async function pinTab(t, folderId) {
  if (folderId) openFolder(folderId);
  const b = await addPin(t, folderId);
  if (b) bind({ [b.id]: t.id });
  if (t.pinned) chrome.tabs.update(t.id, { pinned: false });
}

async function openFav(fav) {
  const open = await openTabFor(fav);
  if (open) return activate(open);
  if (embed) close();
  chrome.tabs.create({ url: fav.url, windowId });
}

// add and remove re-render through the bookmarks listeners below
async function renderFavs() {
  favsEl.replaceChildren(
    ...(await listFavs()).map(fav => favTile(fav, { onOpen: () => openFav(fav), onRemove: () => removeBookmark(fav) })),
    addTile(async () => addFav((await chrome.tabs.query({ active: true, windowId }))[0])),
  );
}

const tip = (el, text) => { el.dataset.tip = text; el.ariaLabel = text; }; // styled tooltip (sidebar.html), and the button's name
// once a tooltip has shown, moving to the next one skips the delay and the fade; a short pause off them resets that
let warmTimer, coolTimer;
addEventListener('pointerover', e => {
  if (!e.target.closest?.('[data-tip]')) return;
  clearTimeout(coolTimer);
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => document.documentElement.classList.add('tips-warm'), 450); // the 300ms wait + 125ms fade are done: it's showing
});
addEventListener('pointerout', e => {
  const from = e.target.closest?.('[data-tip]');
  if (!from || from.contains(e.relatedTarget)) return; // still on it (moved onto its icon)
  clearTimeout(warmTimer);
  coolTimer = setTimeout(() => document.documentElement.classList.remove('tips-warm'), 400); // time to reach the next one
});

// floating only: resting on a tab's row for 300ms shows its preview (the switcher's shot) beside the panel; the overlay draws it, there's no room inside.
// Like the tooltips: once one is showing, the next row's swaps in at once; a short pause off the rows resets that
let previewWarm = false, previewHide;
const hidePreview = () => { clearTimeout(previewHide); previewWarm = false; parent.postMessage({ arcBar: 'preview' }, '*'); };
function preview(li, tabId) {
  if (!embed) return;
  let timer;
  li.addEventListener('mouseenter', () => {
    clearTimeout(previewHide);
    timer = setTimeout(() => {
      // only the tab id crosses to the page: the overlay fetches the shot and URL through the worker, since the page can listen to these messages too
      previewWarm = true;
      parent.postMessage({ arcBar: 'preview', id: tabId, y: li.getBoundingClientRect().top }, '*');
    }, previewWarm ? 0 : 300);
  });
  li.addEventListener('mouseleave', () => { clearTimeout(timer); previewHide = setTimeout(hidePreview, 150); }); // time to reach the next row
  li.addEventListener('pointerdown', hidePreview);
}

function closeButton(t) {
  const x = document.createElement('button');
  x.className = 'x';
  x.textContent = '×';
  tip(x, 'Close tab');
  x.onclick = e => { e.stopPropagation(); chrome.tabs.remove(t.id); };
  return x;
}

// hover buttons before ×: pin a tab, back to a pinned page, ⋯
function iconButton(cls, svg, title, onClick) {
  const b = document.createElement('button');
  b.className = `x pin-btn ${cls}`;
  b.innerHTML = svg;
  tip(b, title);
  b.onclick = e => { e.stopPropagation(); onClick(); };
  return b;
}

// the row's name is a real button: Tab reaches it, screen readers read it, its click bubbles to the row
function label(text) {
  const t = document.createElement('button');
  t.className = 't';
  t.textContent = text;
  return t;
}

// --- Pinned: saved tabs and folders from the "Pinned" bookmarks folder, above the open tabs.
const FOLDER = '<svg viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const FOLDER_OPEN = '<svg viewBox="0 0 24 24"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>';
const bind = more => chrome.storage.session.set({ bound: { ...bound, ...more } }); // { bookmark id: tab id }
// a pin's tab: the one bound to it, else one still under its URL that no other pin has bound
const openTabIn = (tabs, b) => tabs.find(t => t.id === bound[b.id])
  ?? tabs.find(t => isUnder(t.url || t.pendingUrl, b.url) && !Object.values(bound).includes(t.id));
const sameUrl = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '');
async function openPin(b) {
  await bind({ [b.id]: (await chrome.tabs.create({ url: b.url, windowId })).id }); // before close(): the overlay tears this frame down at once
  if (embed) close();
}
const BACK = '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';

// ⋯ on a pinned row: the less-used actions in a menu, so the row keeps few icons. A popover: Esc and click-away close it.
const menu = document.querySelector('#menu');
let anchor; // where the ⋯ the open menu came from sits
function moreButton(items) {
  const b = iconButton('', MORE, 'More', () => { // runs before the popover toggles: fill and place it first
    menu.replaceChildren(...items.map(([text, run]) => {
      const item = document.createElement('button');
      item.role = 'menuitem';
      item.textContent = text;
      item.onclick = () => { menu.hidePopover(); run(); };
      return item;
    }));
    anchor = b.getBoundingClientRect();
    menu.style.right = `${document.documentElement.clientWidth - anchor.right}px`; // clientWidth: innerWidth counts the scrollbar
    menu.style.top = `${anchor.bottom + 4}px`;
    document.querySelector('.x.open')?.classList.remove('open');
    b.classList.add('open'); // stays lit, and shown, while its menu is open: the row's hover is gone by then
  });
  b.popoverTargetElement = menu;
  b.ariaHasPopup = 'menu';
  return b;
}
menu.addEventListener('toggle', e => {
  if (e.newState !== 'open') return document.querySelector('.x.open')?.classList.remove('open');
  if (anchor.bottom + 4 + menu.offsetHeight > innerHeight - 8) menu.style.top = `${anchor.top - 4 - menu.offsetHeight}px`; // no room below: open upwards
  menu.querySelector('button')?.focus();
});
menu.onkeydown = e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  e.stopPropagation(); // not the tab list's cursor
  const items = [...menu.children];
  items[(items.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
};

// inline name edit: Enter or click away saves, Escape keeps the old name
function renameField(current, save) {
  const input = document.createElement('input');
  input.className = 't rename';
  input.value = current;
  input.spellcheck = false;
  input.onclick = input.ondblclick = e => e.stopPropagation(); // don't toggle the folder, switch to the tab, or re-arm the rename while selecting a word
  input.onkeydown = e => {
    e.stopPropagation(); // keys belong to the field, not the tab list
    if (e.key === 'Escape') input.value = current;
    if (e.key === 'Enter' || e.key === 'Escape') input.blur();
  };
  input.onblur = () => {
    const title = input.value.trim();
    if (title && title !== current) save(title); // re-renders via the bookmarks or storage listener
    else schedule();
  };
  return input;
}
const renameBookmark = b => title => chrome.bookmarks.update(b.id, { title });
const renameTab = t => title => chrome.storage.session.set({ names: { ...names, [t.id]: title } });

function pinnedRows(node, tabOf, depth = 0) { // tabOf: bookmark id -> its open tab in this window, if any
  return (node.children ?? []).flatMap(b => {
    const li = document.createElement('li');
    li.style.paddingLeft = `${10 + depth * 16}px`;
    Object.assign(li.dataset, { parent: node.id, index: b.index, depth, bm: b.id }); // where it sits, for drag and drop; bm for rename
    li.onpointerdown = e => { if (e.button === 0 && !e.target.closest('.x, .rename')) press(li, e, pinnedDrag(b)); };
    const editing = b.id === renaming;
    if (editing) renaming = null; // used up here, so it can't linger and pop up on a later expand
    const name = editing ? renameField(b.title, renameBookmark(b)) : label(b.title || b.url);
    if (!b.url) {
      const open = !closedFolders.has(b.id);
      li.className = 'folder';
      li.dataset.folder = b.id; // a row dropped here goes in this folder
      if (open) li.dataset.open = '1';
      if (!editing) name.ariaExpanded = open;
      li.innerHTML = open ? FOLDER_OPEN : FOLDER;
      const del = document.createElement('button');
      del.className = 'x';
      del.textContent = '×';
      tip(del, 'Delete folder and everything in it');
      del.onclick = e => {
        e.stopPropagation();
        // no undo for bookmarks: a folder with things in it asks once more, right on the button
        if (b.children?.length && !del.classList.contains('confirm')) {
          del.classList.add('confirm');
          del.ariaLabel = del.textContent = 'Delete?'; // the name too: a fixed aria-label would hide the ask
          return;
        }
        chrome.bookmarks.removeTree(b.id);
      };
      li.onmouseleave = () => { del.classList.remove('confirm'); del.textContent = '×'; del.ariaLabel = del.dataset.tip; }; // walking away cancels
      li.append(name, del);
      li.onclick = () => {
        if (suppressClick) return;
        closedFolders[open ? 'add' : 'delete'](b.id);
        chrome.storage.local.set({ closedFolders: [...closedFolders] });
        schedule();
      };
      return [li, ...(open ? pinnedRows(b, tabOf, depth + 1) : [])];
    }
    const tab = tabOf.get(b.id);
    li.className = !tab ? 'closed' : tab.active ? 'active' : '';
    li.dataset.folder = node.id; // a tab dropped on a row files into the folder it sits in
    name.title = b.title;
    const img = document.createElement('img');
    img.src = favicon(b.url);
    img.alt = '';
    li.append(img, name);
    const away = tab?.url && !sameUrl(tab.url, b.url); // browsed off the pinned page (Arc-style): offer the way back, or keep where it is now
    if (away) {
      name.title = `${b.title}\nNow on: ${tab.title || tab.url}`;
      li.append(iconButton('away', BACK, 'Back to the pinned page', () => chrome.tabs.update(tab.id, { url: b.url })));
    }
    li.append(moreButton([
      ...away ? [['Pin this page instead', () => chrome.bookmarks.update(b.id, { url: tab.url })]] : [], // keeps the name
      ['Rename', () => { renaming = b.id; schedule(); }],
      ['Unpin', () => removeBookmark(b)],
    ]));
    if (tab) { li.append(closeButton(tab)); preview(li, tab.id); } // × closes the tab, keeps the pin
    li.onclick = () => { if (!suppressClick) tab ? activate(tab) : openPin(b); };
    return [li];
  });
}

// double-click a pinned item or folder to rename it; on the list, since the first click already re-rendered the row
pinnedEl.ondblclick = e => {
  const row = e.target.closest('li[data-bm]');
  if (row) { renaming = row.dataset.bm; schedule(); }
};
const clearDrop = () => document.querySelectorAll('.drop').forEach(el => el.classList.remove('drop'));

function tabItem(t) {
  const li = document.createElement('li');
  li.className = t.active ? 'active' : '';
  li.dataset.id = t.id;
  li.classList.toggle('cursor', t.id === cursorId);
  li.onmousemove = () => { if (cursorId !== t.id) setCursor(t.id); }; // one highlight, whether mouse or keys
  const img = document.createElement('img');
  img.src = favicon(t.url || t.pendingUrl);
  img.alt = '';
  const name = names[t.id] ?? (t.title || t.url);
  const title = label('');
  const text = document.createElement('span');
  text.textContent = name;
  title.append(text);
  const editing = t.id === renaming;
  if (editing) renaming = null;
  li.append(img, editing ? renameField(name, renameTab(t)) : title); // detached title: the marquee below finds nothing to slide
  if (t.pinned) {
    const pin = document.createElement('span');
    pin.className = 'pin';
    pin.title = 'Pinned in Chrome';
    pin.innerHTML = PIN;
    li.append(pin);
  }
  li.append(iconButton('', PIN, 'Pin', () => pinTab(t)), closeButton(t));

  // marquee: on hover, slide a truncated title to its end and stop there
  li.onmouseenter = () => {
    const over = title.scrollWidth - title.clientWidth;
    if (over <= 0) return;
    text.style.translate = `-${over}px 0`;
    text.style.transitionDuration = `${Math.max(0.6, over / 60)}s`; // ~60px/s, steady speed whatever the length
    li.classList.add('marquee');
  };
  li.onmouseleave = () => { li.classList.remove('marquee'); text.style.translate = ''; };
  preview(li, t.id);
  li.onclick = () => { if (!suppressClick) activate(t); };
  li.onauxclick = e => { if (e.button === 1) chrome.tabs.remove(t.id); }; // middle-click closes
  li.ondblclick = () => { renaming = t.id; schedule(); }; // the first click switched to it already; floating, that only works on the current tab
  li.onpointerdown = e => { if (e.button === 0 && !e.target.closest('.x, .rename')) press(li, e, tabDrag(t)); };
  return li;
}

// --- Reorder: the row lifts and follows the pointer; the others slide aside to preview the drop.
// Same for open tabs and Pinned; a spec says which list, which rows it may pass, and what a drop does.
const tabDrag = t => ({
  list: tabsEl,
  sameGroup: el => tabsById.get(+el.dataset.id)?.pinned === t.pinned, // Chrome-pinned and unpinned don't mix
  cross: true, // can be dropped up onto Pinned
  commit: ({ rows, i, j, folder }) => folder ? pinTab(t, folder)
    : j !== i && chrome.tabs.move(t.id, { index: tabsById.get(+rows[j].li.dataset.id).index }),
});
const pinnedDrag = b => ({
  list: pinnedEl,
  sameGroup: () => true,
  folders: true, // hovering a folder's middle drops into it
  commit: ({ rows, i, j, folder }) => {
    if (folder) { openFolder(folder); return chrome.bookmarks.move(b.id, { parentId: folder }); }
    if (j === i) return;
    const to = rows[j].li.dataset;
    // Chrome shifts the index itself when moving down within the same folder
    if (j < i) return chrome.bookmarks.move(b.id, { parentId: to.parent, index: +to.index }); // above that row
    if (to.open) return chrome.bookmarks.move(b.id, { parentId: to.folder, index: 0 }); // below an open folder's name: its first item
    return chrome.bookmarks.move(b.id, { parentId: to.parent, index: +to.index + 1 }); // below that row
  },
});

function press(li, e, spec) {
  const startY = e.clientY;
  li.setPointerCapture(e.pointerId); // keep getting moves even outside the row
  const move = ev => {
    const dy = ev.clientY - startY;
    if (!drag && Math.abs(dy) < 4) return; // still a click
    if (!drag) beginDrag(li, spec);
    updateDrag(dy);
    if (spec.cross) hoverFolder(ev);
  };
  const up = ev => {
    li.removeEventListener('pointermove', move);
    li.removeEventListener('pointerup', up);
    li.removeEventListener('pointercancel', up);
    if (drag) endDrag(ev.type === 'pointercancel'); // a cancelled drag (window lost focus, touch scroll) puts the row back
  };
  li.addEventListener('pointermove', move);
  li.addEventListener('pointerup', up);
  li.addEventListener('pointercancel', up);
}

function beginDrag(li, spec) {
  // a folder travels closed: its contents hide, so it can't be dropped into itself
  for (let el = li.nextElementSibling; li.dataset.open && el && +el.dataset.depth > +li.dataset.depth; el = el.nextElementSibling) el.style.display = 'none';
  const rows = [...spec.list.children].filter(el => el.style.display !== 'none').map(el => {
    const r = el.getBoundingClientRect();
    return { li: el, top: r.top, h: r.height };
  });
  const i = rows.findIndex(r => r.li === li);
  const group = rows.flatMap((r, k) => spec.sameGroup(r.li) ? [k] : []);
  drag = { li, spec, rows, i, j: i, lo: group[0], hi: group.at(-1) };
  li.onmouseleave?.(); // stop any title marquee
  spec.list.classList.add('reordering');
  li.classList.add('dragging');
}

function updateDrag(dy) {
  const { li, rows, i, lo, hi, spec } = drag;
  const me = rows[i];
  dy = Math.max(rows[lo].top - me.top, Math.min(rows[hi].top + rows[hi].h - me.h - me.top, dy)); // stay in the group
  li.style.translate = `0 ${dy}px`;
  // drop slot: the furthest row whose midpoint the dragged row's center has crossed
  const center = me.top + dy + me.h / 2;
  let j = i;
  for (let k = lo; k <= hi; k++) {
    const mid = rows[k].top + rows[k].h / 2;
    if (k > i && center > mid) j = k;
    if (k < i && center < mid && j === i) j = k;
  }
  // Pinned: centered over a folder (middle half of its row) means "into it"; the folder holds still to catch it
  let into = -1;
  if (spec.folders) into = rows.findIndex((r, k) => k !== i && r.li.classList.contains('folder') && Math.abs(center - (r.top + r.h / 2)) < r.h / 4);
  if (into >= 0) j = into > i ? into - 1 : into + 1;
  drag.j = j;
  drag.folder = into >= 0 ? rows[into].li.dataset.folder : null;
  clearDrop();
  if (into >= 0) rows[into].li.classList.add('drop');
  li.classList.toggle('into', into >= 0);
  rows.forEach((r, k) => {
    if (k === i) return;
    const shift = i < j && k > i && k <= j ? -me.h : j < i && k >= j && k < i ? me.h : 0;
    r.li.style.translate = shift ? `0 ${shift}px` : '';
  });
}

// a tab dragged up over Pinned files into the folder under the pointer (or the top level)
function hoverFolder(ev) {
  const id = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-folder]')?.dataset.folder;
  clearDrop();
  drag.folder = id;
  if (id) (pinnedEl.querySelector(`.folder[data-folder="${id}"]`) ?? pinnedEl).classList.add('drop');
}

function endDrag(cancelled) {
  clearDrop();
  const d = drag;
  if (d.folder || cancelled) { // everything slides back; a folder drop then moves the row there on re-render
    d.j = d.i;
    d.rows.forEach(r => { if (r.li !== d.li) r.li.style.translate = ''; });
  }
  const { li, rows, i, j, spec } = d;
  const slot = j > i
    ? rows.slice(i + 1, j + 1).reduce((s, r) => s + r.h, 0)
    : -rows.slice(j, i).reduce((s, r) => s + r.h, 0);
  li.classList.remove('into');
  li.classList.replace('dragging', 'settling');
  li.style.translate = slot ? `0 ${slot}px` : ''; // glide into the gap
  suppressClick = true;
  setTimeout(() => { suppressClick = false; });
  setTimeout(async () => {
    if (!cancelled) try { await spec.commit(d); } catch {} // a failed move just re-renders as it was
    drag = null;
    await render(); // rebuilt in the new order, which already matches what's on screen: no jump
    spec.list.classList.remove('reordering');
  }, 150);
}

async function render() {
  const [all, tree, stored] = await Promise.all([chrome.tabs.query({}), pinnedTree(), chrome.storage.session.get(['names', 'bound'])]);
  const tabs = all.filter(t => t.windowId === windowId);
  names = stored.names ?? {};
  // keep only bindings whose pin and tab (any window) still exist: a stale one would keep an unpinned tab out of auto-archive and away from other pins
  const live = new Set(all.map(t => t.id));
  const links = linksIn(tree);
  bound = Object.fromEntries(links.flatMap(b => live.has(stored.bound?.[b.id]) ? [[b.id, stored.bound[b.id]]] : []));
  activeTab = tabs.find(t => t.active) ?? null;
  showUrl();
  pinnedEl.dataset.folder = tree.id;
  const tabOf = new Map(links.map(b => [b.id, openTabIn(tabs, b)])); // each pin's tab here, once
  pinnedEl.replaceChildren(...pinnedRows(tree, tabOf));
  // bind every pin's tab, so it stays put once it browses off the pinned URL (also covers tabs from before a restart); writes the pruning too
  const fresh = Object.fromEntries([...tabOf].flatMap(([id, t]) => t && bound[id] !== t.id ? [[id, t.id]] : []));
  if (Object.keys(fresh).length || Object.keys(bound).length !== Object.keys(stored.bound ?? {}).length) bind(fresh);
  const claimed = new Set([...tabOf.values()].flatMap(t => t ? [t.id] : [])); // a pinned item's tab shows up there, not twice
  const loose = tabs.filter(t => !claimed.has(t.id));
  tabsById.clear();
  for (const t of loose) tabsById.set(t.id, t);
  if (!tabsById.has(cursorId)) cursorId = loose.find(t => t.active)?.id ?? null; // start on the current tab
  tabsEl.replaceChildren(...loose.map(tabItem)); // Chrome-pinned tabs come first in tab order already
  clearBtn.hidden = !clearable().length;
  setCursor(cursorId);
  document.querySelector('.rename')?.select(); // a rename in either list: focuses too
}

// ponytail: full re-render on any tab event, fine for normal tab counts; diff the DOM if it ever lags
let queued = false;
const schedule = () => {
  if (queued) return;
  queued = true;
  setTimeout(function run() {
    if (drag || document.activeElement?.classList.contains('rename')) return setTimeout(run, 100); // don't rebuild under a drag or a rename
    queued = false;
    render();
  }, 16);
};
for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced']) {
  chrome.tabs[ev].addListener(schedule);
}

// background asks before drawing a floating sidebar: a docked panel for this window says so
if (!embed) chrome.runtime.onMessage.addListener((msg, _, reply) => { if (msg?.dockedIn === windowId) reply(true); });

// pin: floating -> docked side panel (stays open across tabs); in the docked panel it closes it
const dock = document.querySelector('#dock');
dock.title = embed ? 'Keep open' : 'Close sidebar';
dock.onclick = () => {
  if (!embed) return window.close();
  chrome.sidePanel.open({ windowId }).then(close); // first call in the click handler: needs the gesture
};

// address field: hostname at rest, the full address while editing; Enter navigates the current tab
const urlEl = document.querySelector('#url');
const insecure = document.querySelector('#insecure');
const activeUrl = () => activeTab?.pendingUrl || activeTab?.url || '';
const short = u => { try { const { protocol, hostname } = new URL(u); return /^https?:$/.test(protocol) ? hostname.replace(/^www\./, '') : u; } catch { return u; } };
function showUrl() {
  const u = activeUrl();
  insecure.style.display = u.startsWith('http:') ? '' : 'none'; // extensions can't read the real security state; like Chrome, only flag plain http
  urlEl.title = u;
  if (document.activeElement !== urlEl) urlEl.value = short(u); // don't clobber an edit in progress
}
urlEl.onmousedown = e => { if (document.activeElement !== urlEl) { e.preventDefault(); urlEl.focus(); } }; // first click selects all instead of placing the caret
urlEl.onfocus = () => { urlEl.value = activeUrl(); urlEl.select(); };
urlEl.onblur = showUrl;
urlEl.onkeydown = e => {
  e.stopPropagation(); // ↑↓ / Enter / Esc belong to the field here, not the tab list
  if (e.key === 'Escape') urlEl.blur();
  if (e.key !== 'Enter') return;
  const q = urlEl.value.trim();
  urlEl.blur();
  if (!q || !activeTab || q === activeUrl()) return;
  if (looksLikeUrl(q)) chrome.tabs.update(activeTab.id, { url: hasScheme(q) ? q : `https://${q}` });
  else chrome.search.query({ text: q, disposition: 'CURRENT_TAB' });
  if (embed) close();
};
const copy = document.querySelector('#copy');
copy.onclick = () => {
  navigator.clipboard.writeText(activeUrl()).then(() => {
    copy.classList.add('done');
    setTimeout(() => copy.classList.remove('done'), 1000);
  }, e => console.warn('Compass: copy failed', e));
};

// clock, re-armed on each minute boundary
const clock = document.querySelector('#clock');
const tick = () => {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  clock.textContent = `${date} · ${time}`;
  setTimeout(tick, 60000 - (Date.now() % 60000));
};
tick();

// favorites and Pinned change from here, the command bar or the bookmark manager
for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) chrome.bookmarks[ev].addListener(() => { renderFavs(); schedule(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'session' && (c.names || c.bound)) schedule(); }); // a tab renamed or bound here or in the other sidebar

document.querySelector('#github').onclick = () => chrome.tabs.create({ url: 'https://github.com/justin22/compass', windowId });
document.querySelector('#newfolder').onclick = async () => {
  const f = await chrome.bookmarks.create({ parentId: (await pinnedTree()).id, title: 'New Folder' });
  renaming = f.id; // shows up with its name selected, ready to type
  schedule();
};
// Clear (Arc-style): close the open tabs below Pinned in one go, archived first so the bar finds them.
// Keeps the tab you're on (closing every tab would close the window) and Chrome-pinned tabs.
const clearable = () => [...tabsById.values()].filter(t => !t.active && !t.pinned);
const clearLabel = clearBtn.querySelector('span');
const unconfirm = () => { clearBtn.classList.remove('confirm'); clearLabel.textContent = ''; clearBtn.ariaLabel = clearBtn.dataset.tip; };
clearBtn.onclick = async () => {
  const tabs = clearable();
  if (!clearBtn.classList.contains('confirm')) { // asks once more, right on the button
    clearBtn.classList.add('confirm');
    clearBtn.ariaLabel = clearLabel.textContent = `Close ${tabs.length} tab${tabs.length === 1 ? '' : 's'}?`; // the name too: a fixed aria-label would hide the ask
    return;
  }
  unconfirm();
  await saveArchive(tabs); // only after the archive is saved
  await Promise.allSettled(tabs.map(t => chrome.tabs.remove(t.id))); // one already-closed tab mustn't block the rest
};
clearBtn.onmouseleave = clearBtn.onblur = unconfirm; // walking away cancels

// Activity (the footer's chart icon): what Compass keeps and does, so nobody has to guess. Snapshot per open; Clear previews refreshes it.
const act = document.querySelector('#activity');
const bytes = n => n < 1e6 ? `${Math.round(n / 1e3)} KB` : `${(n / 1e6).toFixed(1)} MB`;
const span = ms => { const m = Math.round(ms / 6e4); return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`; };
const el = (tag, props) => Object.assign(document.createElement(tag), props);
const row = (k, v, dim) => { const r = el('div', { className: 'row' }); r.append(el('span', { textContent: k }), el('b', { textContent: v, className: dim ? 'dim' : '' })); return r; }; // dim: an absence, not a value
const sec = (t, action) => { const s = el('div', { className: 'sec' }); s.append(el('span', { textContent: t })); if (action) s.append(action); return s; }; // the section's one action sits in its header
const key = c => c.shortcut || (c.name === 'open-bar' ? `${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}T (new tab)` : ''); // the bar isn't a bound command: it swaps in for the new tab
async function renderActivity() {
  const now = Date.now();
  const [all, due, cmds, disk, { archive = [] }, alarm, { workerStart, lastArchive }] = await Promise.all([
    chrome.tabs.query({}), dueTabs(), chrome.commands.getAll(), chrome.storage.local.getBytesInUse('archive'),
    chrome.storage.local.get('archive'), chrome.alarms.get('archive'), chrome.storage.session.get(['workerStart', 'lastArchive']),
  ]);
  const { autoArchive } = await chrome.storage.sync.get({ autoArchive: true });
  const shots = all.map(t => `shot${t.id}`); // previews exist only for open tabs, so no key listing needed
  const previews = await chrome.storage.session.getBytesInUse(shots);
  act.replaceChildren(
    sec('Tabs'),
    row('Open', all.length), row('Sleeping', all.filter(t => t.discarded).length), row('Due to archive', due.length),
    sec('Auto-archive'),
    row('Next run', !autoArchive ? 'off in options' : alarm ? `in ${span(alarm.scheduledTime - now)}` : 'not scheduled', !autoArchive || !alarm),
    row('Last run', lastArchive ? `${lastArchive.n} closed, ${span(now - lastArchive.at)} ago` : 'nothing yet', !lastArchive),
    row('Archived pages', archive.length),
    sec('Storage', el('button', { textContent: 'Clear previews', onclick: () => chrome.storage.session.remove(shots).then(renderActivity) })),
    row('Previews (memory)', bytes(previews)), row('Archive (disk)', bytes(disk)),
    sec('Settings', el('button', { textContent: 'Open', onclick: () => chrome.runtime.openOptionsPage().catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('options.html'), windowId })) })), // the page as a tab if the browser has no options dialog
    sec('Shortcuts', el('button', { textContent: 'Change', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts', windowId }) })), // an old install keeps its old keys; new commands can come up unset
    ...cmds.filter(c => c.description).map(c => row(c.description, key(c) || 'not set', !key(c))), // drops Chrome's own _execute_action (the toolbar icon)
    sec('Background worker'),
    row('Last woke', workerStart ? `${span(now - workerStart)} ago` : 'unknown', !workerStart),
  );
}
// opens on hover after a beat (passing over it shouldn't flash it), or on click for touch and keyboard. Esc, a click away or moving off closes it.
const actBtn = document.querySelector('#activity-btn');
let actTimer;
const openAct = () => renderActivity().then(() => { if (!act.matches(':popover-open')) act.showPopover(); }); // filled first: no empty flash
const leaveAct = () => { clearTimeout(actTimer); actTimer = setTimeout(() => act.matches(':popover-open') && act.hidePopover(), 250); }; // grace to cross the gap into it
actBtn.onmouseenter = () => { clearTimeout(actTimer); actTimer = setTimeout(openAct, 300); };
actBtn.onmouseleave = act.onmouseleave = leaveAct;
act.onmouseenter = () => clearTimeout(actTimer);
actBtn.onclick = () => { clearTimeout(actTimer); openAct().then(() => act.focus()); }; // focus here only: a hover mustn't steal it from the address field
document.querySelector('#new').onclick = () => chrome.runtime.sendMessage({ openBar: windowId }); // swaps this overlay for the bar
addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); // don't scroll the panel
    const ids = [...tabsById.keys()];
    const i = ids.indexOf(cursorId) + (e.key === 'ArrowDown' ? 1 : -1);
    setCursor(ids[Math.max(0, Math.min(ids.length - 1, i))], true); // stops at the ends, no wrap
  } else if (e.key === 'Enter' && !e.target.closest?.('button') && tabsById.has(cursorId)) { // a focused button handles its own Enter
    activate(tabsById.get(cursorId));
  } else if (e.key === 'Escape' && embed && !document.querySelector(':popover-open')) { // Esc closes an open menu or Activity first
    close();
  }
});
await Promise.all([render(), renderFavs()]);
if (embed) {
  await painted();
  parent.postMessage({ arcBar: 'height' }, '*'); // tells the overlay it's ready to reveal
}

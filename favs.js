// Shared by the command bar and the sidebar: Favorites and Pinned (bookmark folders), favicons, URL detection.
// Favorites live in a "Favorites" bookmarks folder: syncs, editable in the bookmark manager.

export const favicon = url => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);

// "did they type an address or a search?", shared by the bar and the sidebar's address field
export const hasScheme = q => /^[a-z]+:\/\//i.test(q);
export const looksLikeUrl = q => hasScheme(q) || /^localhost(:\d+)?(\/\S*)?$/.test(q) || /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(q);

async function bmFolder(title, key) {
  // remember the folder by id: a title search can land on another "Favorites" folder (Safari imports ship one)
  const { [key]: id } = await chrome.storage.local.get(key);
  const [known] = id ? await chrome.bookmarks.get(id).catch(() => []) : [];
  if (known) return known;
  const [folder] = (await chrome.bookmarks.search({ title })).filter(b => !b.url);
  const f = folder ?? await chrome.bookmarks.create({ title });
  await chrome.storage.local.set({ [key]: f.id });
  return f;
}
const favFolder = () => bmFolder('Favorites', 'favFolderId');

export async function listFavs() {
  return (await chrome.bookmarks.getChildren((await favFolder()).id)).filter(b => b.url);
}

export async function addFav(tab) {
  if (!tab?.url || (await listFavs()).some(f => f.url === tab.url)) return;
  await chrome.bookmarks.create({ parentId: (await favFolder()).id, title: tab.title, url: tab.url });
}

export const removeBookmark = b => chrome.bookmarks.remove(b.id); // a favorite or a pinned item

// the same page or deeper: https://x.com/a takes https://x.com/a/b and https://x.com/a?b, not https://x.com/ab or https://x.community
export const isUnder = (url, base) => {
  const b = base.replace(/\/$/, '');
  return !!url?.startsWith(b) && /^([/?#]|$)/.test(url.slice(b.length));
};
// ponytail: "already open" = a tab under the favorite's URL, else any tab on its host (a favorite saved deep in
// calendar.google.com should still find the calendar tab, wherever it went); track tab ids per favorite if that's too loose
export async function openTabFor(fav) {
  const tabs = await chrome.tabs.query({});
  const host = u => { try { return new URL(u).host; } catch { return null; } };
  const h = host(fav.url); // null for a malformed favorite: no host fallback then, or it would match any tab without a url
  return tabs.find(t => isUnder(t.url, fav.url)) ?? (h ? tabs.find(t => host(t.url) === h) : undefined);
}

// Pinned: Arc-style saved tabs in a "Pinned" bookmarks folder. Its subfolders are the sidebar's folders;
// create, rename and nest them in the bookmark manager.
export const pinnedTree = async () => (await chrome.bookmarks.getSubTree((await bmFolder('Pinned', 'pinFolderId')).id))[0];
export const linksIn = n => n.url ? [n] : (n.children ?? []).flatMap(linksIn);

// pin a tab into a folder (default: the top level); already pinned somewhere -> move it there
export async function addPin(tab, parentId) {
  if (!tab?.url) return;
  const tree = await pinnedTree();
  const known = linksIn(tree).find(b => b.url === tab.url);
  if (known) return chrome.bookmarks.move(known.id, { parentId: parentId ?? tree.id });
  return chrome.bookmarks.create({ parentId: parentId ?? tree.id, title: tab.title, url: tab.url });
}

export function favTile(fav, { title = fav.title, onOpen, onRemove }) {
  const b = document.createElement('button');
  b.className = 'tile';
  b.title = title;
  const img = document.createElement('img');
  img.src = favicon(fav.url);
  img.alt = '';
  const x = document.createElement('span'); // span, not button: buttons can't nest
  x.className = 'x';
  x.textContent = '×';
  x.title = 'Remove from favorites';
  b.append(img, x);
  b.onclick = e => { if (e.target !== x) return onOpen(); e.stopPropagation(); onRemove(); };
  b.onkeydown = e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.stopPropagation(); onRemove(); } }; // the × can't take focus
  return b;
}

export function addTile(onAdd) {
  const b = document.createElement('button');
  b.className = 'tile add';
  b.textContent = '+';
  b.title = 'Add current page to favorites';
  b.onclick = onAdd;
  return b;
}

// The frame paints separately from the page: wait for icons to decode and two frames to paint,
// so the overlay reveals finished content instead of an empty panel that fills in a frame later.
export async function painted() {
  await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

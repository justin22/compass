import { favicon, hasScheme, looksLikeUrl, listFavs, addFav, removeBookmark, openTabFor, favTile, addTile, painted } from './favs.js';

const input = document.querySelector('input');
const list = document.querySelector('ul');
const bar = document.querySelector('.bar');
const favsEl = document.querySelector('#favs');
const embed = window.top !== window; // inside the page overlay vs. the toolbar popup
const close = () => embed ? parent.postMessage({ arcBar: 'close' }, '*') : window.close();
const pill = document.querySelector('#pill');
const placeholder = input.placeholder;
let items = [], sel = 0, seq = 0, favs = [], engine = null;
const [current] = await chrome.tabs.query({ active: true, currentWindow: true }); // the page under the bar

// Tab-to-search sites. %s is the query.
// ponytail: hard-coded list; add a line per site you search often
const ENGINES = [
  { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { name: 'Gmail', url: 'https://mail.google.com/mail/u/0/#search/%s' },
  { name: 'Amazon', url: 'https://www.amazon.com/s?k=%s' },
  { name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/search/results/all/?keywords=%s' },
  { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
  { name: 'GitHub', url: 'https://github.com/search?q=%s' },
  { name: 'X', url: 'https://x.com/search?q=%s', alias: ['twitter'] },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
  { name: 'Maps', url: 'https://www.google.com/maps/search/%s' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=%s' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/?q=%s' },
  { name: 'Claude', url: 'https://claude.ai/new?q=%s' },
];
const engineHome = e => new URL(e.url).origin;
for (const e of ENGINES) e.keys = [e.name, ...(e.alias ?? [])].map(k => k.toLowerCase());

if (embed) document.documentElement.classList.add('embed');

const SEARCH_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>')}`;

async function search(q) {
  if (engine) return q ? [{ kind: 'Search', title: q, engine }] : [{ kind: 'Open', title: `Open ${engine.name}`, url: engineHome(engine) }];
  const lower = q.toLowerCase();
  const site = !/\s/.test(q) && (lower.length >= 2 || lower === 'x') && ENGINES.find(e => e.keys.some(k => k.startsWith(lower)));
  const siteRow = site ? [{ kind: 'Engine', title: `Search ${site.name}`, label: 'Press Tab', url: engineHome(site), engine: site }] : [];

  const terms = lower.split(/\s+/).filter(Boolean);
  // ponytail: all-terms substring match, swap in fuzzy scoring if ranking feels off
  const hit = x => terms.every(t => `${x.title} ${x.url}`.toLowerCase().includes(t));

  const tabs = (await chrome.tabs.query({}))
    .filter(t => t.id !== current?.id) // hide the tab you're on: Enter on an empty bar = back to the last tab
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const out = tabs.filter(hit).map(t => ({ kind: 'Tab', title: t.title || t.url, url: t.url, tab: t }));
  if (!q) return out;

  const action = looksLikeUrl(q)
    ? { kind: 'Open', title: q, url: hasScheme(q) ? q : `https://${q}` }
    : { kind: 'Search', title: q };
  const seen = new Set(out.map(x => x.url));
  const [bookmarks, history, { archive = [] }] = await Promise.all([
    chrome.bookmarks.search(q),
    chrome.history.search({ text: q, maxResults: 20, startTime: 0 }),
    chrome.storage.local.get('archive'),
  ]);
  const rest = [
    ...archive.filter(hit).map(a => ({ kind: 'Archived', title: a.title || a.url, url: a.url })),
    ...bookmarks.filter(b => b.url).map(b => ({ kind: 'Bookmark', title: b.title || b.url, url: b.url })),
    ...history.map(h => ({ kind: 'History', title: h.title || h.url, url: h.url })),
  ].filter(x => !seen.has(x.url) && seen.add(x.url));

  return [...siteRow, ...out, action, ...rest].slice(0, 50);
}

function render() {
  list.replaceChildren(...items.map((x, i) => {
    const li = document.createElement('li');
    li.className = i === sel ? 'sel' : '';
    li.id = `r${i}`;
    li.role = 'option';
    li.ariaSelected = i === sel;
    const img = document.createElement('img');
    img.src = x.engine ? favicon(engineHome(x.engine)) : x.url ? favicon(x.url) : SEARCH_ICON; // the engine is the browser's default, which extensions can't read
    img.alt = '';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = x.title;
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = x.label ?? x.kind;
    li.append(img, t, k);
    li.onmousemove = () => { if (sel !== i) { sel = i; render(); } };
    li.onclick = () => go(x);
    return li;
  }));
  list.children[sel]?.scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', items.length ? `r${sel}` : '');
}

async function go(x) {
  if (!x) return;
  if (x.kind === 'Engine') return setEngine(x.engine);
  if (x.kind === 'Tab') {
    await chrome.tabs.update(x.tab.id, { active: true });
    await chrome.windows.update(x.tab.windowId, { focused: true });
    return close(); // target first, then this one: no flash of a third tab in between
  }
  const url = x.kind === 'Search' ? (x.engine ? x.engine.url.replace('%s', encodeURIComponent(x.title)) : null) : x.url; // null: the browser's default search
  if (url) await chrome.tabs.create({ url });
  else await chrome.search.query({ text: x.title, disposition: 'NEW_TAB' });
  close();
}

async function openFav(fav) {
  const open = await openTabFor(fav);
  go(open ? { kind: 'Tab', tab: open } : { kind: 'Open', url: fav.url });
}

async function renderFavs() {
  favs = await listFavs();
  favsEl.replaceChildren(
    ...favs.map((fav, i) => favTile(fav, {
      title: `${fav.title}${i < 9 ? `  (⌘${i + 1})` : ''}`,
      onOpen: () => openFav(fav),
      onRemove: async () => { await removeBookmark(fav); renderFavs(); input.focus(); },
    })),
    addTile(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await addFav(tab);
      renderFavs();
      input.focus();
    }),
  );
}

function setEngine(e) {
  engine = e;
  pill.hidden = !e;
  if (e) {
    pill.querySelector('img').src = favicon(engineHome(e));
    pill.querySelector('span').textContent = e.name;
  }
  input.value = '';
  input.placeholder = e ? `Search ${e.name}` : placeholder;
  input.focus();
  update();
}

async function update() {
  const mine = ++seq;
  const results = await search(input.value.trim());
  if (mine !== seq) return; // a newer keystroke already won
  items = results;
  sel = items[0]?.kind === 'Engine' && items.length > 1 ? 1 : 0; // Enter acts on the first real result; Tab (or ↑) takes the engine
  render();
}

input.addEventListener('input', update);
list.onmousedown = e => e.preventDefault(); // clicking a row must not move focus off the input
document.addEventListener('keydown', e => { // on the document: works even if focus slipped off the input
  if (e.target !== input) {
    if (e.target.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return; // a focused favorite tile handles its own activation
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) input.focus(); // typing jumps back into the search box
  }
  if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) { // Cmd+1..9 opens that favorite
    e.preventDefault();
    if (favs[e.key - 1]) openFav(favs[e.key - 1]);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % (items.length || 1);
    render();
  } else if (e.key === 'Tab') {
    e.preventDefault(); // focus stays in the input (the list is a focusable scroller in new Chromium): Tab takes the engine when offered, else walks the list
    const eng = !engine && items.find(x => x.kind === 'Engine');
    if (eng) setEngine(eng.engine);
    else { sel = (sel + (e.shiftKey ? -1 : 1) + items.length) % (items.length || 1); render(); }
  } else if (e.key === 'Backspace' && engine && !input.value) {
    setEngine(null);
  } else if (e.key === 'Enter') {
    go(items[sel]);
  } else if (e.key === 'Escape') {
    engine ? setEngine(null) : close(); // first Esc drops the pill
  }
});

window.addEventListener('focus', () => input.focus()); // overlay focuses the frame, hand it to the input
window.addEventListener('message', e => { if (e.source === parent && e.data?.arcBar === 'focus') input.focus(); });
input.focus();
await Promise.all([update(), renderFavs()]);
if (embed) await painted();
// report size only once results are in, so the overlay opens at full height instead of growing
if (embed) new ResizeObserver(() => parent.postMessage({ arcBar: 'height', h: bar.offsetHeight }, '*')).observe(bar);

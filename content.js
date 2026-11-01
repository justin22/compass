// Off switches from the options page (storage.sync); missing means on
const prefs = { edgeHover: true, shiftPeek: true };
try {
  chrome.storage.sync.get(prefs).then(p => Object.assign(prefs, p));
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync') for (const k in c) if (k in prefs) prefs[k] = c[k].newValue ?? true; });
} catch {} // the extension was reloaded under this page

// Arc-style hidden sidebar: rest the mouse on the window's left edge to slide it in. Top frame only: an iframe's left edge isn't the window's.
if (top === window) {
  let timer = null, opened = false; // opened: once per edge visit
  const cancel = () => { clearTimeout(timer); timer = null; opened = false; };
  const open = () => { opened = true; try { chrome.runtime.sendMessage({ openSidebar: true }).catch(() => {}); } catch {} }; // throws once the extension is reloaded
  const nearEdge = e => prefs.edgeHover && e.clientX <= 8 && !e.buttons && !document.querySelector('#arc-bar-overlay[data-visible="1"]'); // a warm hidden overlay doesn't block the edge
  document.addEventListener('mousemove', e => {
    if (!e.isTrusted) return; // a page can dispatch its own mouse events; only the real pointer opens the sidebar
    if (!nearEdge(e)) return cancel();
    // ponytail: fixed 40ms dwell so passing by doesn't trigger; under three frames, feels immediate
    timer ??= setTimeout(open, 40); // stays set until the mouse moves off the edge: one open per visit
  });
  document.addEventListener('mouseout', e => {
    if (!e.isTrusted || e.relatedTarget) return; // moving between elements, still on the page
    // left the page through its left side: browser UI (e.g. collapsed vertical tabs) sits between the page and the
    // screen edge, so the mouse never rests on the page edge. No dwell possible once it's off the page: open now.
    if (nearEdge(e) && !opened) open();
    cancel();
  });
}

// The peek frame: named by the overlay, and a direct child of the page. A peeked site learns the name (window.name) and could
// give it to a frame of its own; that one's parent is the peek, not the page, so the key is never sent from there
const inPeek = parent === top && top !== window && window.name.startsWith('compass-peek:');

// Shift+click a link: peek it (Chrome's "open in new window" is the only thing it displaces, as in Arc). Runs in every frame, so
// links inside embeds work. Inside the peek itself (the overlay names that frame) the peek goes to the page instead, so Back works
document.addEventListener('click', e => {
  if (!prefs.shiftPeek || !e.isTrusted || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.button) return;
  const a = e.composedPath().find(n => n.tagName === 'A' && /^https?:/.test(n.href)); // composedPath: links inside shadow roots too
  if (!a) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // the page's own click handlers would navigate or open their own thing
  const k = inPeek ? window.name.slice(13) : null;
  try {
    if (k) chrome.runtime.sendMessage({ peekGo: a.href, k }).then(ok => { if (ok) location.href = a.href; }, () => {}); // the worker un-blocks framing for the new host first
    else chrome.runtime.sendMessage({ peek: a.href }).catch(() => {});
  } catch {}
}, true);

// Inside the peek: report the page that loaded (the overlay's Back list), and Esc closes it unless the page used the key itself
// (closing its own dialog). Cmd+[ / Alt+Left also step the peek back: its pages are in the tab's history
if (inPeek) {
  const k = window.name.slice(13);
  const tell = m => { try { chrome.runtime.sendMessage({ ...m, k }).catch(() => {}); } catch {} };
  tell({ peekDo: 'at', url: location.href });
  addEventListener('keydown', e => { if (e.key === 'Escape' && e.isTrusted && !e.defaultPrevented) tell({ peekDo: 'close' }); });
}

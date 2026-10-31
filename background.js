import { dueTabs, saveArchive } from './archive.js';

chrome.storage.session.set({ workerStart: Date.now() }); // when this worker last (re)started; the sidebar's Activity shows it

// resolves to whether anything opened
async function openOverlay(windowId, view, hover = false, peek = null) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    // the frame URL carries a secret the frame checks: any site can iframe our pages (web_accessible_resources), only ours get this key
    const { key = crypto.randomUUID() } = await chrome.storage.session.get('key');
    await chrome.storage.session.set({ key });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (v, h, k, p) => { globalThis.arcBarView = v; globalThis.arcBarHover = h; globalThis.arcBarKey = k; globalThis.arcBarPeek = p; }, args: [view, hover, key, peek] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
    return true;
  } catch (e) {
    // chrome:// pages and the Web Store block scripts: fall back to the toolbar popup
    if (view === 'bar') return chrome.action.openPopup({ windowId }).then(() => true, e => { console.warn('Compass: could not open', e); return false; });
    console.warn(`Compass: ${view} blocked on this page`, e);
    return false;
  }
}

// runtime.getContexts doesn't report Helium's side panel, so ask: only a docked panel for this window answers (rejects when nothing listens)
const docked = windowId => chrome.runtime.sendMessage({ dockedIn: windowId }).then(Boolean, () => false);

chrome.commands.onCommand.addListener((command, tab) => {
  const windowId = tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
  if (command === 'open-bar') openOverlay(windowId, 'bar');
  if (command === 'copy-url') copyUrl(tab);
  if (command === 'pip') pip(tab);
  if (command === 'switch-tab') openOverlay(windowId, 'switch');
  if (command === 'open-sidebar') {
    // can't draw on browser pages: use the native side panel there (must stay synchronous to keep the keypress gesture)
    if (/^https?:/.test(tab?.url ?? '')) docked(windowId).then(d => { if (!d) openOverlay(windowId, 'sidebar'); });
    else chrome.sidePanel.open({ windowId }).catch(e => console.warn('Compass: could not open the side panel', e));
  }
});

// Peek: shift+click a link (or right-click, Peek), read it in a panel over the page, without leaving it. The overlay iframes the link; most sites
// refuse framing (X-Frame-Options, CSP frame-ancestors), so while a peek is open a session rule strips those headers from
// the frames of every host the peek has shown (Back needs the earlier ones too). One rule, one peek at a time; the overlay
// reports closing and the rule goes.
// ponytail: the CSP header can't be edited, only dropped, so the peeked site runs without its own CSP inside the panel.
// Cookies marked SameSite=Lax (most logins) aren't sent to a cross-site frame: some sites show their signed-out page.
// Plain clicks inside the peek to another host are blocked unless that host happens to allow framing; shift+click them.
const PEEK_RULE = 1;
const unpeek = () => Promise.all([chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [PEEK_RULE] }), chrome.storage.session.remove('peekKey')]);
chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({ id: 'peek', title: 'Peek', contexts: ['link'], documentUrlPatterns: ['http://*/*', 'https://*/*'] })); // menus persist: create once; only where the overlay can draw
async function allowFrames(url) { // add the host (and its subdomains) to the peek rule
  const [rule] = await chrome.declarativeNetRequest.getSessionRules({ ruleIds: [PEEK_RULE] });
  const requestDomains = [...new Set([...(rule?.condition.requestDomains ?? []), new URL(url).hostname])];
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [PEEK_RULE], addRules: [{
    id: PEEK_RULE, priority: 1,
    condition: { requestDomains, resourceTypes: ['sub_frame'] },
    action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }, { header: 'content-security-policy', operation: 'remove' }] },
  }] });
}
async function peek(windowId, url) {
  if (!/^https?:/.test(url)) return;
  await allowFrames(url);
  const peekKey = crypto.randomUUID(); // names the peek's frame; content.js inside quotes it, since a page can name its own frames the same way
  await chrome.storage.session.set({ peekKey });
  if (!await openOverlay(windowId, 'peek', false, { url, key: peekKey })) unpeek();
}
async function peekGo({ peekGo: url, k }) { // shift+click inside the peek frame: un-block the new host, then the frame navigates itself (so Back works)
  const { peekKey } = await chrome.storage.session.get('peekKey');
  if (!peekKey || k !== peekKey || !/^https?:/.test(url)) return false;
  await allowFrames(url);
  return true;
}
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === 'peek') peek(tab.windowId, info.linkUrl); });

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.openBar) openOverlay(msg.openBar, 'bar'); // sidebar's "New Tab" button
  if (msg?.shot) { // the overlay's hover preview: a tab's shot and URL, kept off the page's postMessage channel
    Promise.all([chrome.storage.session.get(`shot${msg.shot}`), chrome.tabs.get(msg.shot)])
      .then(([s, t]) => reply({ src: s[`shot${msg.shot}`], url: t.url }), () => reply(null));
    return true; // replying async
  }
  if (msg?.peekClosed) unpeek();
  if (msg?.peek && sender.tab?.active) peek(sender.tab.windowId, msg.peek); // content.js shift+click
  if (msg?.peekGo && sender.frameId) { peekGo(msg).then(reply, () => reply(false)); return true; } // replying async
  if (msg?.peekDo && sender.frameId) { // from inside the peek frame (a page load, Esc), for the overlay in the top frame; the key check keeps other frames out
    chrome.storage.session.get('peekKey').then(({ peekKey }) => { if (peekKey && msg.k === peekKey) return chrome.tabs.sendMessage(sender.tab.id, { peekDo: msg.peekDo, url: msg.url }, { frameId: 0 }); }).catch(() => {});
  }
  if (msg?.goTab) chrome.tabs.update(msg.goTab, { active: true }).catch(() => {}); // clicked the new-tab toast; the tab may be gone already
  if (msg?.openSidebar && sender.tab?.active) { // content.js edge hover; skipped while the sidebar is docked
    const windowId = sender.tab.windowId;
    docked(windowId).then(d => { if (!d) openOverlay(windowId, 'sidebar', true); });
  }
});

// Cmd+T: swap the blank new tab for the command bar, like Arc
let restoring = false; // the new tab put back after a failed swap must not be swapped again
chrome.tabs.onCreated.addListener(async tab => {
  if (restoring || !/^chrome:\/\/new-?tab/.test(tab.pendingUrl || tab.url)) return;
  if (tab.index === 0) return; // the only tab of a new window: closing it would close the window (index > 0 proves a sibling without another round trip)
  const { swapNewTab } = await chrome.storage.sync.get({ swapNewTab: true }); // options page off switch
  if (!swapNewTab) return;
  await chrome.tabs.remove(tab.id); // the new tab is already painted by now: the brief flash is the price of Cmd+T being a browser shortcut
  if (await openOverlay(tab.windowId, 'bar')) return;
  restoring = true; // nowhere to draw the bar (e.g. a chrome:// page underneath): give the new tab back
  await chrome.tabs.create({ windowId: tab.windowId }).catch(() => {});
  restoring = false;
});

// Background tab (Cmd+click a link): a toast on the page you stayed on, click it to go there. Injected, so self-contained.
function toastInPage(tabId, site) {
  document.getElementById('compass-toast')?.remove(); // one at a time: the newest wins
  const host = document.createElement('div');
  host.id = 'compass-toast';
  host.popover = 'manual'; // top layer: above the page's own z-index wars, no modal
  host.style.cssText = 'all: initial; position: fixed; inset: 12px auto auto 50%; translate: -50% 0; margin: 0;';
  // contrast with what's actually behind the toast: first opaque background up from the element at that spot, else the system theme
  // ponytail: rgb() backgrounds only; gradients, images and oklch() fall through to a parent or the system theme
  let darkPage = matchMedia('(prefers-color-scheme: dark)').matches;
  for (let el = document.elementFromPoint(innerWidth / 2, 24); el; el = el.parentElement) {
    const [r, g, b, a = 1] = getComputedStyle(el).backgroundColor.match(/^rgba?\((.*)\)/)?.[1].split(/[\s,/]+/).map(Number) ?? [0, 0, 0, 0]; // not rgb(): look further up
    if (a > .5) { darkPage = .299 * r + .587 * g + .114 * b < 128; break; }
  }
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    button {
      font: 500 13px/1 system-ui, sans-serif; color: #f5f5f7; cursor: pointer;
      padding: 10px 14px; border-radius: 12px; border: 1px solid rgb(255 255 255 / .12);
      background: rgb(28 28 30 / .92); backdrop-filter: blur(28px) saturate(180%);
      box-shadow: 0 12px 32px rgb(0 0 0 / .28), inset 0 1px 0 rgb(255 255 255 / .08);
      transition: opacity 200ms cubic-bezier(0.32, 0.72, 0, 1), translate 200ms cubic-bezier(0.32, 0.72, 0, 1), scale 160ms cubic-bezier(0.23, 1, 0.32, 1), background-color 160ms ease;
    }
    @starting-style { button { opacity: 0; translate: 0 -8px; scale: .97; } } /* drops in from the top edge */
    button.out { opacity: 0; translate: 0 -8px; scale: .97; transition-duration: 150ms; } /* leaves the way it came, a little quicker */
    @media (hover: hover) { button:hover { background: rgb(44 44 46 / .94); } .light:hover { background: rgb(255 255 255 / 1); } }
    button:active { scale: .97; }
    button:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
    span { opacity: .6; }
    .light { color: #1d1d1f; background: rgb(255 255 255 / .94); border-color: rgb(0 0 0 / .08); box-shadow: 0 12px 32px rgb(0 0 0 / .14), inset 0 1px 0 rgb(255 255 255 / .8); }
    @media (prefers-reduced-motion: reduce) { @starting-style { button { translate: 0 0; scale: 1; } } button.out { translate: 0 0; scale: 1; } } /* keep the fade, drop the movement */
  </style><button class="${darkPage ? 'light' : ''}">New tab opened <span></span></button>`;
  const btn = root.querySelector('button');
  // gone after 4s, but not while the mouse is on it (it's on its way to click) or the page is out of sight (nobody saw it yet)
  let timer = setTimeout(dismiss, 4000);
  const hold = () => clearTimeout(timer);
  const release = () => { clearTimeout(timer); timer = setTimeout(dismiss, 1500); };
  const away = () => document.hidden ? hold() : release();
  host.onmouseenter = hold;
  host.onmouseleave = release;
  document.addEventListener('visibilitychange', away);
  function dismiss() { btn.classList.add('out'); document.removeEventListener('visibilitychange', away); setTimeout(() => host.remove(), 150); }
  btn.onclick = () => { dismiss(); chrome.runtime.sendMessage({ goTab: tabId }); };
  host.role = 'status'; // read out by screen readers: a live region, so the text goes in after it's in the tree
  document.documentElement.append(host);
  host.showPopover();
  root.querySelector('span').textContent = site ? `· ${site}` : ''; // textContent: the site name is page-controlled
}
chrome.tabs.onCreated.addListener(tab => {
  if (tab.active || tab.openerTabId == null) return; // only tabs opened behind the page you're on
  const site = URL.parse(tab.pendingUrl || tab.url)?.hostname ?? '';
  chrome.scripting.executeScript({ target: { tabId: tab.openerTabId }, func: toastInPage, args: [tab.id, site] })
    .catch(() => {}); // browser pages block scripts: no toast there
});

// Copy URL (Cmd+Shift+L; Shift+C is Chrome's Inspect element): copy in the page, silently. Injected, so it must be self-contained.
// ponytail: the fallback copies inside the page, so a page's own `copy` listener could swap the text; an offscreen document would avoid that
function copyInPage(url) {
  const fallback = () => {
    const prev = document.activeElement;
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position: fixed; opacity: 0;';
    document.documentElement.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    prev?.focus?.();
  };
  // the async clipboard can stall (or be missing on http pages): give it 300ms, then fall back
  const stall = new Promise((_, reject) => setTimeout(reject, 300));
  const write = navigator.clipboard?.writeText(url) ?? Promise.reject();
  Promise.race([write, stall]).catch(fallback);
}

async function copyUrl(tab) {
  if (!tab?.url) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: copyInPage, args: [tab.url] })
    .catch(e => console.warn('Compass: can\'t copy on this page', e)); // browser pages block scripts
}

// Picture-in-picture (Cmd+Shift+P): pop out the page's main video, or bring it back. Injected, so self-contained.
// ponytail: top frame only, so videos inside iframes (embeds) are skipped; allFrames + picking one frame if that's missed
function pipInPage() {
  if (document.pictureInPictureElement) return document.exitPictureInPicture();
  const area = v => v.clientWidth * v.clientHeight;
  const found = [];
  const walk = root => { for (const el of root.querySelectorAll('*')) { if (el.tagName === 'VIDEO') found.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; // into open shadow roots: Reddit's player keeps its video in one
  walk(document);
  const videos = found.filter(v => v.readyState && area(v));
  videos.sort((a, b) => area(b) - area(a));
  const video = videos.find(v => !v.paused) ?? videos[0]; // biggest playing, else biggest
  if (!video) return;
  video.removeAttribute('disablepictureinpicture'); // some sites opt out; the user asked for it
  return video.requestPictureInPicture();
}

function pip(tab) {
  // no await before this: the shortcut's user gesture has to carry into the page for requestPictureInPicture
  chrome.scripting.executeScript({ target: { tabId: tab?.id }, func: pipInPage })
    .catch(e => console.warn('Compass: no picture-in-picture on this page', e));
}

// Tab previews for the switcher: a shot of the tab you're looking at, taken when you arrive and when it finishes loading.
// storage.session is memory only: gone when the browser closes, nothing on disk.
// ponytail: no pruning; if the 10MB session quota fills, set() throws and newer tabs just show the favicon tile. Drop the oldest if that bites
const shotTimers = new Map(); // one pending shot per window; captureVisibleTab is rate limited
function shoot(windowId, tabId) {
  clearTimeout(shotTimers.get(windowId));
  shotTimers.set(windowId, setTimeout(async () => {
    try {
      const { previews } = await chrome.storage.sync.get({ previews: true }); // options page off switch
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (!previews || tab?.id !== tabId || !/^https?:/.test(tab.url)) return; // switched off, moved on already, or a browser page (capture is refused there anyway)
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const w = 640, h = Math.round(bmp.height * w / bmp.width);
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
      const data = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
      await chrome.storage.session.set({ [`shot${tabId}`]: data });
    } catch {} // minimized window, rate limit, quota: no shot this time, the old one stays
  }, 400)); // let the page settle after the switch or load
}
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => shoot(windowId, tabId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete' && tab.active) shoot(tab.windowId, tabId); });
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(`shot${tabId}`)); // closed by hand or by auto-archive
chrome.windows.onRemoved.addListener(windowId => { clearTimeout(shotTimers.get(windowId)); shotTimers.delete(windowId); });
chrome.storage.onChanged.addListener(async (c, area) => { // previews switched off: drop the ones already taken
  if (area !== 'sync' || c.previews?.newValue !== false) return;
  const tabs = await chrome.tabs.query({}); // shots exist only for open tabs: no need to load the store to list its keys
  await chrome.storage.session.remove(tabs.map(t => `shot${t.id}`));
});

// Auto-archive: every 30 min, close tabs untouched for 12h, saving them first so the bar can find them.
async function archiveStale() {
  const { autoArchive } = await chrome.storage.sync.get({ autoArchive: true }); // options page off switch; the alarm keeps ticking so turning it back on needs nothing
  if (!autoArchive) return;
  const stale = await dueTabs();
  if (!stale.length) return;
  await saveArchive(stale);
  await Promise.allSettled(stale.map(t => chrome.tabs.remove(t.id))); // only after the archive is saved; one already-closed tab mustn't block the rest
  chrome.storage.session.set({ lastArchive: { at: Date.now(), n: stale.length } }); // for Activity
}
// create once: re-creating on every worker wake-up would keep pushing the alarm back
chrome.alarms.get('archive').then(a => a || chrome.alarms.create('archive', { periodInMinutes: 30 }));
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'archive') archiveStale(); });


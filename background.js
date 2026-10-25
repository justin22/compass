import { listFavs, pinnedTree, linksIn } from './favs.js';
import { staleTabs } from './archive.js';

// resolves to whether anything opened
async function openOverlay(windowId, view, hover = false) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (v, h) => { globalThis.arcBarView = v; globalThis.arcBarHover = h; }, args: [view, hover] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
    return true;
  } catch (e) {
    // chrome:// pages and the Web Store block scripts: fall back to the toolbar popup
    if (view === 'bar') return chrome.action.openPopup({ windowId }).then(() => true, e => (console.warn('Compass: could not open', e), false));
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

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.openBar) openOverlay(msg.openBar, 'bar'); // sidebar's "New Tab" button
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
  await chrome.tabs.remove(tab.id); // the new tab is already painted by now: the brief flash is the price of Cmd+T being a browser shortcut
  if (await openOverlay(tab.windowId, 'bar')) return;
  restoring = true; // nowhere to draw the bar (e.g. a chrome:// page underneath): give the new tab back
  await chrome.tabs.create({ windowId: tab.windowId }).catch(() => {});
  restoring = false;
});

// Copy URL (Cmd+Shift+C): copy in the page, silently. Injected, so it must be self-contained.
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
// ponytail: top frame and light DOM only, so videos inside iframes (embeds) or shadow roots are skipped; allFrames + picking one frame if that's missed
function pipInPage() {
  if (document.pictureInPictureElement) return document.exitPictureInPicture();
  const area = v => v.clientWidth * v.clientHeight;
  const videos = [...document.querySelectorAll('video')].filter(v => v.readyState && area(v));
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
// storage.session is memory only: gone when the browser closes, nothing on disk. Removed when the tab closes.
// ponytail: no pruning; if the 10MB session quota fills, set() throws and newer tabs just show the favicon tile. Drop the oldest if that bites
const shotTimers = new Map(); // one pending shot per window; captureVisibleTab is rate limited
function shoot(windowId, tabId) {
  clearTimeout(shotTimers.get(windowId));
  shotTimers.set(windowId, setTimeout(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab?.id !== tabId || !/^https?:/.test(tab.url)) return; // moved on already, or a browser page (capture is refused there anyway)
      const bmp = await createImageBitmap(await (await fetch(await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 }))).blob());
      const w = 320, h = Math.round(bmp.height * w / bmp.width);
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

// Auto-archive: every 30 min, close tabs untouched for 12h, saving them first so the bar can find them.
async function archiveStale() {
  const keepUrls = [...await listFavs(), ...linksIn(await pinnedTree())].map(f => f.url);
  const stale = staleTabs(await chrome.tabs.query({}), keepUrls, Date.now());
  if (!stale.length) return;
  const entries = stale.map(t => ({ url: t.url, title: t.title, archivedAt: Date.now() }));
  const { archive = [] } = await chrome.storage.local.get('archive');
  const urls = new Set(entries.map(e => e.url));
  await chrome.storage.local.set({ archive: [...entries, ...archive.filter(a => !urls.has(a.url))].slice(0, 500) });
  await Promise.allSettled(stale.map(t => chrome.tabs.remove(t.id))); // only after the archive is saved; one already-closed tab mustn't block the rest
}
// create once: re-creating on every worker wake-up would keep pushing the alarm back
chrome.alarms.get('archive').then(a => a || chrome.alarms.create('archive', { periodInMinutes: 30 }));
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'archive') archiveStale(); });


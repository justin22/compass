// Tab switcher: a grid of the window's tabs, most recent first, read left to right then down, with the previews background.js keeps. Always in the overlay.
import { favicon, painted, overlayKey } from './favs.js';

const strip = document.querySelector('#strip');
const close = () => parent.postMessage({ arcBar: 'close' }, '*');
const key = await overlayKey();
const { id: windowId } = await chrome.windows.getCurrent();
const tabs = (await chrome.tabs.query({ windowId })).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)); // like Cmd+Tab
const shots = await chrome.storage.session.get(tabs.map(t => `shot${t.id}`));
let sel = Math.min(1, tabs.length - 1); // starts on the previous tab: one press and release jumps back
let holding = true; // still holding the shortcut's modifier? letting go picks, like Arc. Any event without it held turns this off

const tiles = tabs.map((t, i) => {
  const el = document.createElement('div');
  el.className = 'tab';
  el.id = `s${i}`;
  el.role = 'option';
  el.title = t.title;
  const shot = document.createElement('div');
  shot.className = 'shot';
  const img = document.createElement('img');
  img.alt = '';
  if (shots[`shot${t.id}`]) img.src = shots[`shot${t.id}`];
  else { img.className = 'fav'; img.src = favicon(t.url); } // not looked at since the browser started
  shot.append(img);
  const cap = document.createElement('div');
  cap.className = 'cap';
  const fav = document.createElement('img');
  fav.alt = '';
  fav.src = favicon(t.url);
  const label = document.createElement('span');
  label.textContent = t.title || t.url;
  cap.append(fav, label);
  el.append(shot, cap);
  el.onmousemove = () => { if (sel !== i) select(i); };
  el.onclick = () => { select(i); pick(); }; // select too: no mousemove precedes a click when the pointer was already resting here
  return el;
});
// as many 200px columns as fit, but at least two rows: a handful of tabs shouldn't be one long line
const avail = +new URLSearchParams(location.search).get('w') || innerWidth; // the page's width, from the overlay: this frame reports 300px until the page lays it out
const cols = Math.max(1, Math.min(Math.ceil(tabs.length / 2), Math.floor((avail - 18) / 210)));
strip.style.gridTemplateColumns = `repeat(${cols}, 200px)`;
strip.replaceChildren(...tiles);

function select(i) {
  sel = (i + tabs.length) % tabs.length; // wraps
  tiles.forEach((el, j) => { el.classList.toggle('sel', j === sel); el.ariaSelected = j === sel; });
  strip.setAttribute('aria-activedescendant', `s${sel}`);
  tiles[sel].scrollIntoView({ inline: 'nearest', block: 'nearest' });
}
function pick() {
  const t = tabs[sel];
  close();
  chrome.tabs.update(t.id, { active: true });
}

const mod = e => e.metaKey || e.ctrlKey;
addEventListener('keydown', e => {
  if (!mod(e)) holding = false;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Tab: e.shiftKey ? -1 : 1 }[e.key]; // next is to the right, wrapping onto the next row
  if (step) { e.preventDefault(); select(sel + step); }
  else if (e.key === 'Enter') pick();
  else if (e.key === 'Escape') close();
});
addEventListener('keyup', e => {
  if (e.key === 'Meta' || e.key === 'Control') { if (holding) pick(); }
  else if (!mod(e)) holding = false;
});
addEventListener('pointermove', e => { if (!mod(e)) holding = false; });
addEventListener('message', e => {
  if (e.source !== parent || e.data?.k !== key) return; // the page can message this frame too
  if (e.data?.arcBar === 'next') select(sel + 1); // the shortcut, pressed again
  if (e.data?.arcBar === 'focus') strip.focus();
});

select(sel);
await painted();
parent.postMessage({ arcBar: 'height', h: strip.scrollHeight, w: cols * 210 + 18 }, '*'); // the panel shrinks to fit the grid: columns + gaps + padding; scrollHeight is right whatever size the frame is now

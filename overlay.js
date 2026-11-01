// Injected on demand. Block scope so re-injecting doesn't redeclare consts.
{
  const view = globalThis.arcBarView ?? 'bar'; // 'bar', 'sidebar', 'switch' or 'peek', set by background.js just before injecting
  const peek = globalThis.arcBarPeek; // peek: { url, key }; the key names the frame so content.js inside knows it's ours
  let hover = globalThis.arcBarHover ?? false; // opened by resting on the left edge: no dim, leaves when the mouse does
  const key = globalThis.arcBarKey; // proves to the frame it was opened by us, and to the frame's message handler that a message is ours
  let themePref = globalThis.arcBarTheme ?? 'auto'; // 'auto', 'light' or 'dark' from the options page
  const old = document.getElementById('arc-bar-overlay');
  const again = view === 'switch' && old?.dataset.view === 'switch'; // the switcher's shortcut again steps to the next tile
  // a bar/sidebar closed a moment ago in this tab is still loaded: re-open that page instead of loading it from scratch
  const warm = !again && old?.arcWarm?.(view, hover, themePref, key);
  let open = false;
  if (again) old.arcNext();
  else if (!warm) {
    const same = old?.dataset.visible === '1' && old.dataset.view === view && view !== 'peek';
    if (same) old.arcClose(); // same shortcut again toggles it off
    else {
      if (old?.arcDispose) old.arcDispose(view === 'peek'); // remove() also clears overlays left by an older version. A peek replacing a peek keeps the worker's new rule
      else { old?.arcClose?.(view === 'peek'); old?.remove(); } // an overlay from a version without arcDispose
      open = view === 'peek' || old?.dataset.view !== view; // the other one swaps views; a new peek replaces the last
    }
  }
  if (open) {
    // A modal <dialog> sits in the browser's top layer: above any z-index, page dialogs, popovers and fullscreen.
    const dialog = document.createElement('dialog');
    dialog.id = 'arc-bar-overlay';
    dialog.dataset.view = view;
    dialog.setAttribute('aria-label', 'Compass');
    dialog.style.cssText = 'all: initial; display: block; position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible;';
    dialog.innerHTML = '<style>#arc-bar-overlay::backdrop { background: transparent; }</style>';
    const host = document.createElement('div');
    dialog.append(host);

    const dark = matchMedia('(prefers-color-scheme: dark)');
    const setTheme = () => { host.dataset.theme = themePref === 'light' || themePref === 'dark' ? themePref : (dark.matches ? 'dark' : 'light'); };
    const onThemeChange = (c, area) => { if (area === 'sync' && c.theme) { themePref = c.theme.newValue ?? 'auto'; setTheme(); } };
    setTheme(); // before the style below paints
    dark.addEventListener('change', setTheme);
    chrome.storage.onChanged.addListener(onThemeChange);

    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .scrim {
          position: fixed; inset: 0;
          background: rgb(0 0 0 / .18);
          backdrop-filter: blur(6px) saturate(120%);
          opacity: 0; transition: opacity 110ms ease-out;
        }
        .scrim.in { opacity: 1; }
        .scrim.closing { opacity: 0; transition-duration: 90ms; }
        .panel {
          position: fixed; top: 18vh; left: 50%; translate: -50% 0;
          width: min(640px, calc(100vw - 32px)); height: 64px; overflow: hidden;
          border-radius: 16px; border: 1px solid rgb(255 255 255 / .45);
          backdrop-filter: blur(28px) saturate(180%);
          box-shadow: 0 24px 60px rgb(0 0 0 / .22), inset 0 1px 0 rgb(255 255 255 / .5);
          opacity: 0; transform-origin: 50% 0;
          transition: opacity 100ms ease-out, translate 140ms cubic-bezier(0.16, 1, 0.3, 1), scale 120ms cubic-bezier(0.23, 1, 0.32, 1), height 140ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .panel.in { opacity: 1; }
        .panel.bar, .panel.peek, .panel.switch { scale: .985; }
        .panel.bar.in, .panel.peek.in, .panel.switch.in { scale: 1; }
        .panel.closing { opacity: 0; transition-duration: 90ms; }
        .panel.bar.closing, .panel.peek.closing { scale: .99; }
        .panel.switch.closing { scale: .98; }
        /* first frame after insertion: the panel fades up from just under full size (bar/peek) */
        @starting-style {
          .scrim.in { opacity: 0; }
          .panel.in { opacity: 0; }
          .panel.bar.in, .panel.peek.in { translate: -50% -5px; scale: .985; }
          .panel.switch.in { scale: .97; }
          .panel.sidebar.slide.in { translate: -10px 0; }
        }
        .scrim.sidebar { background: rgb(0 0 0 / .06); backdrop-filter: none; }
        .panel.sidebar {
          top: 8px; bottom: 8px; left: 8px; width: 250px; height: auto; border-radius: 14px; translate: none;
        }
        /* slide only after the mouse gesture (edge hover), never on the shortcut */
        .panel.sidebar.slide { translate: -10px 0; }
        .panel.sidebar.slide.in { translate: 0 0; }
        .panel.sidebar.slide.closing { translate: -8px 0; }
        .scrim.hover { background: transparent; }
        .panel.switch { top: 50%; left: 50%; translate: -50% -50%; width: calc(100vw - 48px); height: calc(100vh - 48px); border-radius: 20px; transform-origin: 50% 50%; transition-property: opacity, scale; } /* room to lay out, then snaps to its tiles; its size arrives once, so it isn't animated */
        .panel.peek { top: 56px; bottom: 24px; left: 50%; translate: -50% 0; width: calc(100vw - 96px); height: auto; border-radius: 14px; background: #fff; backdrop-filter: none; } /* pages expect a white canvas; room above for the close button */
        /* peek's buttons: glass discs above the panel's right edge, Back then Close, same material as the panel */
        .pk {
          position: fixed; top: 12px; width: 32px; height: 32px; display: grid; place-items: center; padding: 0; cursor: pointer;
          border-radius: 50%; border: 1px solid rgb(255 255 255 / .45); color: rgb(0 0 0 / .7);
          background: rgb(255 255 255 / .62); backdrop-filter: blur(28px) saturate(180%);
          box-shadow: 0 8px 24px rgb(0 0 0 / .18), inset 0 1px 0 rgb(255 255 255 / .5);
          transition: scale 160ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease, opacity 150ms ease;
        }
        .pk.x { right: 48px; }
        .pk.back { right: 88px; }
        /* Back is only there once there's somewhere to go: grows in from nearly its size, leaves quicker than it came */
        .pk.back:disabled { opacity: 0; scale: .9; visibility: hidden; transition: opacity 100ms cubic-bezier(0.23, 1, 0.32, 1), scale 100ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s 100ms; }
        .pk:hover:not(:disabled) { background: rgb(255 255 255 / .9); }
        .pk:active:not(:disabled) { scale: .94; }
        .pk:focus-visible { outline: 2px solid rgb(0 122 255); outline-offset: 2px; }
        .pk svg { width: 14px; height: 14px; }
        iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: light dark; } /* the frame's prefers-color-scheme follows this, not the system; frame pages declare the same, or Chrome paints the frame opaque */
        :host([data-theme="dark"]) .scrim { background: rgb(0 0 0 / .36); }
        :host([data-theme="dark"]) .scrim.sidebar { background: rgb(0 0 0 / .2); }
        :host([data-theme="dark"]) .scrim.hover { background: transparent; }
        :host([data-theme="dark"]) .panel:not(.peek) { border-color: rgb(255 255 255 / .12); box-shadow: 0 24px 60px rgb(0 0 0 / .5), inset 0 1px 0 rgb(255 255 255 / .08); } /* the frame paints the glass: its tint must match its text */
        :host([data-theme="dark"]) .pk { background: rgb(28 28 30 / .62); border-color: rgb(255 255 255 / .12); color: rgb(255 255 255 / .85); box-shadow: 0 8px 24px rgb(0 0 0 / .45), inset 0 1px 0 rgb(255 255 255 / .08); }
        :host([data-theme="dark"]) .pk:hover:not(:disabled) { background: rgb(28 28 30 / .9); }
        @media (prefers-reduced-motion: reduce) {
          .pk:active, .pk.back:disabled { scale: 1; }
          .panel { transition-property: opacity, height; }
          .panel.bar, .panel.peek, .panel.switch,
          .panel.bar.closing, .panel.peek.closing, .panel.switch.closing { scale: 1; }
          .panel.sidebar.slide, .panel.sidebar.slide.in, .panel.sidebar.slide.closing { translate: 0 0; transition-property: opacity; }
          @starting-style { .panel.bar.in, .panel.peek.in, .panel.switch.in, .panel.sidebar.slide.in { translate: 0 0; scale: 1; } }
        } /* keep the fades, drop the movement */
      </style>
      <div class="scrim ${view} ${hover ? 'hover' : ''}"></div>
      <div class="panel ${view} ${hover ? 'slide' : ''}"><iframe title="${{ bar: 'Command bar', sidebar: 'Sidebar', switch: 'Tab switcher', peek: 'Peek' }[view]}"></iframe></div>
      ${view === 'peek' ? `<button class="pk back" aria-label="Back" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M19 12H5"/></svg></button>
      <button class="pk x" aria-label="Close peek"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}`;

    const scrim = root.querySelector('.scrim');
    const panel = root.querySelector('.panel');
    const frame = root.querySelector('iframe');
    if (view === 'peek') {
      frame.name = `compass-peek:${peek.key}`;
      frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals'; // everything but navigating this page: framebusters would take it over once clicked
      if (location.protocol === 'https:') peek.url = peek.url.replace(/^http:/, 'https:'); // an http frame in an https page is blocked as mixed content
      frame.src = peek.url;
    }
    else frame.src = `${chrome.runtime.getURL(`${view}.html`)}?k=${key}` + (view === 'switch' ? `&w=${innerWidth - 48}` : ''); // w: the frame's own size isn't settled when it first runs

    let closing = false; // a second close (Esc, scrim click) while the exit plays must not re-run it
    let visible = true;
    let hideTimer, expireTimer, removeTimer, hiddenTimer;
    // focus the frame, then tell it to focus its input: a cross-origin frame can't take focus by itself.
    // Again on load and 50ms later, in case the browser grabbed focus back while the tab switched (Cmd+T).
    const focusFrame = () => { frame.focus(); frame.contentWindow?.postMessage({ arcBar: 'focus', k: key }, '*'); };
    const onMessage = e => {
      if (e.source !== frame.contentWindow) return; // ignore the page's own messages
      if (e.data?.arcBar === 'close') close();
      if (e.data?.arcBar === 'height' && visible && (view !== 'bar' || e.data.h > 0)) { // a hidden frame reports 0: not a height
        if (view === 'bar') panel.style.height = `${e.data.h}px`; // animates: the bar opens at once, then grows as its list arrives
        if (view === 'switch') {
          panel.style.height = `${Math.min(e.data.h, innerHeight - 48)}px`;
          panel.style.width = `${e.data.w}px`;
          if (!panel.classList.contains('in')) { panel.classList.add('in'); scrim.classList.add('in'); } // the one view that must know its size before it shows
        }
      }
    };
    // peek's Back: the pages the frame has shown, reported by content.js inside it (a cross-origin frame's URL can't be read).
    // Back loads the previous one itself rather than history.back(): the tab's history never says where in it the frame is
    const back = root.querySelector('.pk.back');
    const urls = view === 'peek' ? [peek.url] : [];
    let fresh = true; // the frame is loading a URL we set: its report replaces the top entry (redirects land here) instead of pushing
    const onPeekDo = m => {
      if (m?.peekDo === 'close') return close();
      if (m?.peekDo !== 'at') return;
      if (fresh) { urls[urls.length - 1] = m.url; fresh = false; }
      else if (m.url === urls.at(-2)) urls.pop(); // the browser's own back
      else if (m.url !== urls.at(-1)) urls.push(m.url);
      back.disabled = urls.length < 2;
    };
    const cleanup = () => {
      removeEventListener('message', onMessage); removeEventListener('pagehide', close); document.removeEventListener('visibilitychange', onVisibility);
      chrome.runtime.onMessage.removeListener(onPeekDo);
      dark.removeEventListener('change', setTheme); chrome.storage.onChanged.removeListener(onThemeChange);
      clearTimeout(hideTimer); clearTimeout(expireTimer); clearTimeout(removeTimer); clearTimeout(hiddenTimer);
    };
    const dispose = (quiet = false) => {
      if (view === 'peek' && quiet !== true) chrome.runtime.sendMessage({ peekClosed: true }).catch(() => {}); // a peek swapped for another view must not leave its header rule behind
      cleanup(); dialog.remove();
    };
    const onVisibility = () => {
      if (!document.hidden) return clearTimeout(hiddenTimer);
      // a real tab switch lets the warm frame go; the Cmd+T swap comes back to this tab in a moment, so give it a grace period
      if (!visible) hiddenTimer = setTimeout(dispose, 10_000);
    };
    // reopen a hidden frame: no page load, no module startup; the frame is told to reset its view
    const show = () => {
      clearTimeout(expireTimer); clearTimeout(hiddenTimer);
      closing = false; visible = true;
      dialog.dataset.visible = '1';
      dialog.style.display = 'block';
      dialog.style.pointerEvents = '';
      panel.classList.remove('closing', 'in');
      scrim.classList.remove('closing', 'in');
      dialog.showModal();
      void panel.offsetWidth; // from display:none: let @starting-style play the entry again
      panel.classList.add('in'); scrim.classList.add('in');
      focusFrame();
      setTimeout(focusFrame, 50);
      frame.contentWindow?.postMessage({ arcBar: 'show', k: key }, '*');
    };
    const close = (quiet = false) => {
      if (closing) return;
      closing = true;
      if (view === 'peek' && quiet !== true) chrome.runtime.sendMessage({ peekClosed: true }).catch(() => {}); // drop the header rule now, not after the fade; the worker may be gone after a long peek
      dialog.style.pointerEvents = 'none'; // the page below takes clicks again while it fades
      panel.classList.add('closing'); scrim.classList.add('closing');
      if (view === 'peek' || view === 'switch') {
        cleanup();
        removeTimer = setTimeout(() => dialog.remove(), 140); // out faster than in; remove() also drops the top layer
        return;
      }
      hideTimer = setTimeout(() => {
        dialog.close();
        dialog.style.display = 'none';
        dialog.dataset.visible = '0';
        visible = false; closing = false;
        if (view === 'bar') panel.style.height = '64px'; // the next show starts compact, not at the last search's height
        if (document.hidden) onVisibility(); // it went to the background while fading: the visibility handler decides how long it stays
        else expireTimer = setTimeout(dispose, 5 * 60_000); // ponytail: five minutes keeps a warm frame in the visible tab; longer would hold one per tab
      }, 140);
    };
    const leaveOnHover = e => { if (e.clientX > panel.getBoundingClientRect().right + 40) close(); }; // 40px grace
    addEventListener('message', onMessage);
    dialog.arcClose = close;
    dialog.arcDispose = dispose;
    dialog.arcWarm = (v, h, t, k) => {
      if (v !== view || (view !== 'bar' && view !== 'sidebar') || visible || k !== key) return false;
      hover = h;
      themePref = t;
      setTheme();
      scrim.classList.toggle('hover', hover);
      panel.classList.toggle('slide', hover);
      scrim.onmousemove = hover ? leaveOnHover : null;
      show();
      return true;
    };
    dialog.arcNext = () => frame.contentWindow?.postMessage({ arcBar: 'next', k: key }, '*');
    scrim.onclick = close;
    root.querySelector('.pk.x')?.addEventListener('click', () => close());
    if (hover) scrim.onmousemove = leaveOnHover;
    document.addEventListener('visibilitychange', onVisibility);
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); }); // Esc while focus is on the page
    if (view !== 'switch') { panel.classList.add('in'); scrim.classList.add('in'); } // bar and sidebar show at once: no waiting for a frame that has nothing to size
    dialog.dataset.visible = '1';
    document.documentElement.append(dialog);
    dialog.showModal();
    if (view !== 'peek') { // peek keeps the page's focus: its close button is one Tab away
      focusFrame();
      setTimeout(focusFrame, 50);
      frame.addEventListener('load', focusFrame, { once: true }); // autofocus inside a frame only takes once the frame itself is focused
    }
    if (view === 'peek') { // no 'height' message from a foreign page; release the rule if the page is left with the peek open
      addEventListener('pagehide', close);
      back.onclick = () => { urls.pop(); fresh = true; frame.src = urls.at(-1); back.disabled = urls.length < 2; };
      chrome.runtime.onMessage.addListener(onPeekDo); // page reports and Esc from inside the peeked page, relayed by the worker
    }
  }
}

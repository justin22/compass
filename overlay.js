// Injected on demand. Block scope so re-injecting doesn't redeclare consts.
{
  const view = globalThis.arcBarView ?? 'bar'; // 'bar', 'sidebar', 'switch' or 'peek', set by background.js just before injecting
  const peek = globalThis.arcBarPeek; // peek: { url, key }; the key names the frame so content.js inside knows it's ours
  const hover = globalThis.arcBarHover ?? false; // opened by resting on the left edge: no dim, leaves when the mouse does
  const key = globalThis.arcBarKey; // proves to the frame it was opened by us, and to the frame's message handler that a message is ours
  const old = document.getElementById('arc-bar-overlay');
  const again = view === 'switch' && old?.dataset.view === 'switch'; // the switcher's shortcut again steps to the next tile
  if (again) old.arcNext();
  else { old?.arcClose?.(view === 'peek'); old?.remove(); } // remove() also clears overlays left by an older version. A peek replacing a peek keeps the worker's new rule
  if (!again && (view === 'peek' || old?.dataset.view !== view)) { // same shortcut again toggles it off; the other one swaps views; a new peek replaces the last
    // A modal <dialog> sits in the browser's top layer: above any z-index, page dialogs, popovers and fullscreen.
    const dialog = document.createElement('dialog');
    dialog.id = 'arc-bar-overlay';
    dialog.dataset.view = view;
    dialog.setAttribute('aria-label', 'Compass');
    dialog.style.cssText = 'all: initial; display: block; position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible;';
    dialog.innerHTML = '<style>#arc-bar-overlay::backdrop { background: transparent; }</style>';
    const host = document.createElement('div');
    dialog.append(host);

    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .scrim {
          position: fixed; inset: 0;
          background: rgb(0 0 0 / .18);
          backdrop-filter: blur(6px) saturate(120%);
          opacity: 0;
        }
        .scrim.in { opacity: 1; }
        .panel {
          position: fixed; top: 18vh; left: 50%; translate: -50% 0;
          width: min(640px, calc(100vw - 32px)); height: 64px; overflow: hidden;
          border-radius: 16px; border: 1px solid rgb(255 255 255 / .45);
          background: rgb(255 255 255 / .62);
          backdrop-filter: blur(28px) saturate(180%);
          box-shadow: 0 24px 60px rgb(0 0 0 / .22), inset 0 1px 0 rgb(255 255 255 / .5);
          opacity: 0; /* revealed once sized; no open animation: it's opened from the keyboard */
        }
        .panel.in { opacity: 1; }
        .scrim.sidebar { background: rgb(0 0 0 / .06); backdrop-filter: none; }
        .panel.sidebar {
          top: 8px; bottom: 8px; left: 8px; width: 280px; height: auto; border-radius: 14px; translate: none;
          background: rgb(255 255 255 / .9); /* muted text keeps 4.5:1 even over a black page */
        }
        /* slide only after the mouse gesture (edge hover), never on the shortcut */
        .panel.sidebar.slide { translate: -12px 0; transition: opacity 200ms cubic-bezier(0.32, 0.72, 0, 1), translate 200ms cubic-bezier(0.32, 0.72, 0, 1); }
        .panel.sidebar.slide.in { translate: 0 0; }
        .scrim.hover { background: transparent; }
        .panel.switch { top: 50%; left: 50%; translate: -50% -50%; width: calc(100vw - 48px); height: calc(100vh - 48px); border-radius: 20px; } /* room to lay out, then shrinks to its tiles */
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
        iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
        /* sidebar tab preview: a glass card like the panel, to its right, level with the row. Fades and grows in from the panel's edge; leaves faster than it came */
        .shot {
          position: fixed; top: 0; width: 320px; padding: 6px; box-sizing: border-box; pointer-events: none;
          border-radius: 14px; border: 1px solid rgb(255 255 255 / .45);
          background: rgb(255 255 255 / .72); backdrop-filter: blur(28px) saturate(180%);
          box-shadow: 0 16px 48px rgb(0 0 0 / .2), inset 0 1px 0 rgb(255 255 255 / .5);
          transform-origin: left center; opacity: 0; scale: .97; visibility: hidden;
          transition: opacity 100ms cubic-bezier(0.23, 1, 0.32, 1), scale 100ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s 100ms;
        }
        .shot.in { opacity: 1; scale: 1; visibility: visible; transition: opacity 150ms cubic-bezier(0.23, 1, 0.32, 1), scale 150ms cubic-bezier(0.23, 1, 0.32, 1), translate 180ms cubic-bezier(0.23, 1, 0.32, 1); } /* translate: slides to the next row when the pointer moves on */
        .shot img { display: block; width: 100%; border-radius: 9px; outline: 1px solid rgb(0 0 0 / .08); outline-offset: -1px; } /* a hairline keeps a white page from merging with the card */
        .shot span { display: block; padding: 7px 4px 2px; font: 12px/1.3 system-ui, sans-serif; color: rgb(0 0 0 / .55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @media (prefers-color-scheme: dark) {
          .panel:not(.peek) { background: rgb(28 28 30 / .58); border-color: rgb(255 255 255 / .12); box-shadow: 0 24px 60px rgb(0 0 0 / .5), inset 0 1px 0 rgb(255 255 255 / .08); }
          .panel.sidebar { background: rgb(28 28 30 / .92); } /* muted text keeps 4.5:1 even over a white page */
          .pk { background: rgb(28 28 30 / .62); border-color: rgb(255 255 255 / .12); color: rgb(255 255 255 / .85); box-shadow: 0 8px 24px rgb(0 0 0 / .45), inset 0 1px 0 rgb(255 255 255 / .08); } .pk:hover:not(:disabled) { background: rgb(28 28 30 / .9); }
          .shot { background: rgb(28 28 30 / .72); border-color: rgb(255 255 255 / .12); box-shadow: 0 16px 48px rgb(0 0 0 / .5), inset 0 1px 0 rgb(255 255 255 / .08); } .shot img { outline-color: rgb(255 255 255 / .1); } .shot span { color: rgb(255 255 255 / .6); }
        }
        @media (prefers-reduced-motion: reduce) { .pk:active, .pk.back:disabled { scale: 1; } .panel.sidebar.slide { translate: 0 0; transition-property: opacity; } .shot, .shot.in { scale: 1; transition-property: opacity, visibility; } } /* keep the fade, drop the movement */
      </style>
      <div class="scrim ${view} ${hover ? 'hover' : ''}"></div>
      <div class="panel ${view} ${hover ? 'slide' : ''}"><iframe title="${{ bar: 'Command bar', sidebar: 'Sidebar', switch: 'Tab switcher', peek: 'Peek' }[view]}"></iframe></div>
      ${view === 'peek' ? `<button class="pk back" aria-label="Back" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M19 12H5"/></svg></button>
      <button class="pk x" aria-label="Close peek"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}
      <div class="shot"><img alt=""><span></span></div>`;

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

    const close = (quiet = false) => {
      dialog.remove(); removeEventListener('message', onMessage); removeEventListener('pagehide', close); chrome.runtime.onMessage.removeListener(onPeekDo);
      if (view === 'peek' && quiet !== true) chrome.runtime.sendMessage({ peekClosed: true }).catch(() => {}); // drop the header rule; the worker may be gone after a long peek
    };
    let previewGen = 0; // the latest preview request; an older shot arriving late must not reopen or overwrite the card
    const onMessage = e => {
      if (e.source !== frame.contentWindow) return; // ignore the page's own messages
      if (e.data?.arcBar === 'close') close();
      if (e.data?.arcBar === 'preview') { // a tab row hovered in the sidebar: its shot to the right of the panel, level with the row
        const shot = root.querySelector('.shot');
        const gen = ++previewGen;
        if (!e.data.id) return shot.classList.remove('in');
        const { y } = e.data;
        chrome.runtime.sendMessage({ shot: e.data.id }).then(d => { // through the worker, not the page: the page can read postMessage traffic
          if (gen !== previewGen) return; // the pointer moved on (or left) meanwhile
          if (!d?.src) return shot.classList.remove('in'); // no shot for this one: the last card shouldn't linger
          const r = panel.getBoundingClientRect();
          shot.querySelector('img').src = d.src;
          shot.querySelector('span').textContent = d.url.replace(/^https?:\/\//, '');
          shot.style.left = `${r.right + 12}px`;
          shot.style.translate = `0 ${Math.min(r.top + y, innerHeight - 8 - Math.max(shot.offsetHeight, 240))}px`; // keep it on screen near the bottom rows (height: the last card's, near enough)
          if (!shot.classList.contains('in')) shot.offsetHeight; // settle the position first, so the card grows in where it is rather than sliding over from the last one
          shot.classList.add('in');
        }, () => {});
      }
      if (e.data?.arcBar === 'height') {
        if (view === 'bar') panel.style.height = `${e.data.h}px`; // sidebar is full height via CSS
        if (view === 'switch') { panel.style.height = `${Math.min(e.data.h, innerHeight - 48)}px`; panel.style.width = `${e.data.w}px`; }
        if (!panel.classList.contains('in')) { // reveal scrim + panel together once sized: no flash
          panel.classList.add('in');
          scrim.classList.add('in');
          // focus the frame, then tell it to focus its input: a cross-origin frame can't take focus by itself.
          // Twice, in case the browser grabbed focus back while the tab switched (Cmd+T).
          const focusFrame = () => { frame.focus(); frame.contentWindow?.postMessage({ arcBar: 'focus', k: key }, '*'); }; // null if closed within the 50ms
          focusFrame();
          setTimeout(focusFrame, 50);
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
    addEventListener('message', onMessage);
    dialog.arcClose = close;
    dialog.arcNext = () => frame.contentWindow?.postMessage({ arcBar: 'next', k: key }, '*');
    scrim.onclick = close;
    root.querySelector('.pk.x')?.addEventListener('click', () => close());
    if (hover) scrim.onmousemove = e => { if (e.clientX > panel.getBoundingClientRect().right + 40) close(); }; // 40px grace
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); }); // Esc while focus is on the page
    document.documentElement.append(dialog);
    dialog.showModal();
    if (view === 'peek') { // no 'height' message from a foreign page: show at once, and release the rule if the page is left with the peek open
      panel.classList.add('in'); scrim.classList.add('in');
      addEventListener('pagehide', close);
      back.onclick = () => { urls.pop(); fresh = true; frame.src = urls.at(-1); back.disabled = urls.length < 2; };
      chrome.runtime.onMessage.addListener(onPeekDo); // page reports and Esc from inside the peeked page, relayed by the worker
    }
  }
}

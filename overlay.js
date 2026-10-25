// Injected on demand. Block scope so re-injecting doesn't redeclare consts.
{
  const view = globalThis.arcBarView ?? 'bar'; // 'bar' or 'sidebar', set by background.js just before injecting
  const hover = globalThis.arcBarHover ?? false; // opened by resting on the left edge: no dim, leaves when the mouse does
  const old = document.getElementById('arc-bar-overlay');
  old?.arcClose?.(); old?.remove(); // remove() also clears overlays left by an older version
  if (old?.dataset.view !== view) { // same shortcut again toggles it off; the other one swaps views
    // A modal <dialog> sits in the browser's top layer: above any z-index, page dialogs, popovers and fullscreen.
    const dialog = document.createElement('dialog');
    dialog.id = 'arc-bar-overlay';
    dialog.dataset.view = view;
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
        }
        /* slide only after the mouse gesture (edge hover), never on the shortcut */
        .panel.sidebar.slide { translate: -12px 0; transition: opacity 200ms cubic-bezier(0.32, 0.72, 0, 1), translate 200ms cubic-bezier(0.32, 0.72, 0, 1); }
        .panel.sidebar.slide.in { translate: 0 0; }
        .scrim.hover { background: transparent; }
        iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
        @media (prefers-color-scheme: dark) {
          .panel { background: rgb(28 28 30 / .58); border-color: rgb(255 255 255 / .12); box-shadow: 0 24px 60px rgb(0 0 0 / .5), inset 0 1px 0 rgb(255 255 255 / .08); }
        }
        @media (prefers-reduced-motion: reduce) { .panel.sidebar.slide { translate: 0 0; transition-property: opacity; } } /* keep the fade, drop the movement */
      </style>
      <div class="scrim ${view} ${hover ? 'hover' : ''}"></div>
      <div class="panel ${view} ${hover ? 'slide' : ''}"><iframe allowtransparency="true"></iframe></div>`;

    const scrim = root.querySelector('.scrim');
    const panel = root.querySelector('.panel');
    const frame = root.querySelector('iframe');
    frame.src = chrome.runtime.getURL(`${view}.html`);

    const close = () => { dialog.remove(); removeEventListener('message', onMessage); };
    const onMessage = e => {
      if (e.source !== frame.contentWindow) return; // ignore the page's own messages
      if (e.data?.arcBar === 'close') close();
      if (e.data?.arcBar === 'height') {
        if (view === 'bar') panel.style.height = `${e.data.h}px`; // sidebar is full height via CSS
        if (!panel.classList.contains('in')) { // reveal scrim + panel together once sized: no flash
          panel.classList.add('in');
          scrim.classList.add('in');
          // focus the frame, then tell it to focus its input: a cross-origin frame can't take focus by itself.
          // Twice, in case the browser grabbed focus back while the tab switched (Cmd+T).
          const focusFrame = () => { frame.focus(); frame.contentWindow?.postMessage({ arcBar: 'focus' }, '*'); }; // null if closed within the 50ms
          focusFrame();
          setTimeout(focusFrame, 50);
        }
      }
    };
    addEventListener('message', onMessage);
    dialog.arcClose = close;
    scrim.onclick = close;
    if (hover) scrim.onmousemove = e => { if (e.clientX > panel.getBoundingClientRect().right + 40) close(); }; // 40px grace
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); }); // Esc while focus is on the page
    document.documentElement.append(dialog);
    dialog.showModal();
  }
}

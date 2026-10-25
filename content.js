// Arc-style hidden sidebar: rest the mouse on the window's left edge to slide it in.
{
  let timer = null, opened = false; // opened: once per edge visit
  const cancel = () => { clearTimeout(timer); timer = null; opened = false; };
  const open = () => { opened = true; try { chrome.runtime.sendMessage({ openSidebar: true }).catch(() => {}); } catch {} }; // throws once the extension is reloaded
  const nearEdge = e => e.clientX <= 8 && !e.buttons && !document.getElementById('arc-bar-overlay');
  document.addEventListener('mousemove', e => {
    if (!nearEdge(e)) return cancel();
    // ponytail: fixed 150ms dwell so passing by doesn't trigger; make it a setting if it feels off
    timer ??= setTimeout(open, 150); // stays set until the mouse moves off the edge: one open per visit
  });
  document.addEventListener('mouseout', e => {
    if (e.relatedTarget) return; // moving between elements, still on the page
    // left the page through its left side: browser UI (e.g. collapsed vertical tabs) sits between the page and the
    // screen edge, so the mouse never rests on the page edge. No dwell possible once it's off the page: open now.
    if (nearEdge(e) && !opened) open();
    cancel();
  });
}

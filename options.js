// Off switches for the behaviours that displace a browser default. Missing = on, so nothing is written until a box is unticked.
const boxes = document.querySelectorAll('input');
chrome.storage.sync.get(Object.fromEntries([...boxes].map(b => [b.id, true]))).then(p => { for (const b of boxes) b.checked = p[b.id]; });
for (const b of boxes) b.onchange = () => chrome.storage.sync.set({ [b.id]: b.checked });
document.getElementById('keys').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: e.target.href }); }; // chrome:// links don't open from a page

// Off switches for the behaviours that displace a browser default. Missing = on, so nothing is written until a box is unticked.
const themeSelect = document.getElementById('theme');
const themeValue = v => v === 'light' || v === 'dark' ? v : 'auto';
chrome.storage.sync.get({ theme: 'auto' }).then(({ theme }) => { themeSelect.value = themeValue(theme); });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.theme) themeSelect.value = themeValue(c.theme.newValue); });
themeSelect.onchange = () => chrome.storage.sync.set({ theme: themeSelect.value });

const boxes = document.querySelectorAll('input');
chrome.storage.sync.get(Object.fromEntries([...boxes].map(b => [b.id, true]))).then(p => { for (const b of boxes) b.checked = p[b.id]; });
for (const b of boxes) b.onchange = () => chrome.storage.sync.set({ [b.id]: b.checked });
document.getElementById('keys').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: e.target.href }); }; // chrome:// links don't open from a page

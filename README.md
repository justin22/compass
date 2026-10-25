# Compass

> **Heads up: no human has reviewed this code.** All of it was written by an AI model (an LLM). A person has tested how it works by using it, but has not read the code, and there are no plans to review it soon. Keep that in mind before you install it, especially since it asks for access to your tabs, history and bookmarks.

A command bar and sidebar for Chrome and other Chromium browsers (Helium, Edge, Brave). It borrows the parts of Arc that were worth keeping: one search box for everything, a sidebar that stays out of the way, and old tabs that clean themselves up.

Chrome extension, no build step, no dependencies.

## What it does

**Command bar** (`Cmd+T` or `Cmd+Shift+K`)

A search box that pops up over the page. Cmd+T closes the blank new tab and opens the bar over the page you were on instead, so you may see a brief flash. Type anything and it finds open tabs, bookmarks, history and archived tabs in one list. Type a web address and it opens it. Type anything else and it searches the web.

- Press Enter on an empty bar to jump back to the last tab you were on.
- Type a site name like `yt` or `reddit`, press Tab, and search that site directly. Google, Gmail, Amazon, Reddit, LinkedIn, YouTube, GitHub, X, Wikipedia, Maps, Perplexity, ChatGPT and Claude are built in.
- Your favorites sit at the top. `Cmd+1` to `Cmd+9` opens them.

**Sidebar** (`Cmd+Shift+S`, or rest your mouse on the left edge of the window)

A vertical list of your open tabs, floating over the page. Click a tab to switch to it. Drag to reorder. Middle-click to close.

- An address field at the top shows the current site. Click it to edit, Enter to navigate.
- A pin button keeps the sidebar open as a docked side panel. Click it again to close.
- Arrow keys move through tabs, Enter opens one, Escape closes the sidebar.

**Favorites**

Your top sites, shown as icons in both the bar and the sidebar. Press `+` to add the current page, `×` to remove one. They are stored as a "Favorites" bookmark folder, so they sync and you can edit them in the bookmark manager.

**Pinned**

Tabs you want to keep, at the top of the sidebar. Click the pin on a tab to pin it, or drag it up into Pinned. Click a pinned tab to open it, and click its pin again to unpin. Pinned tabs are stored as a "Pinned" bookmark folder, so they sync.

- **New Folder** adds a folder. Double-click a folder to rename it.
- Drag to reorder, or drop onto a folder to put it inside.
- `×` on a folder deletes it and everything in it.

**Copy URL** (`Cmd+Shift+C`)

Copies the current page address. No popup, no confirmation.

**Auto-archive**

Every 30 minutes, tabs you have not touched in 12 hours close on their own. They are saved first, so the command bar can still find them. Pinned items, favorites, the active tab and anything playing audio are left alone.

## Install

1. Open `chrome://extensions` (in Edge, `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.

On Windows and Linux the shortcuts use `Ctrl+Shift` instead of `Cmd+Shift`. You can change them at `chrome://extensions/shortcuts`.

## Set up Helium

Compass replaces the browser's own tabs and toolbar, so it looks best when Helium gets out of the way. Open Helium's settings (`Cmd+,`), find **Layout**, and set:

- **Vertical** layout
- **Show vertical tabs on right side**: on. Compass's sidebar lives on the left edge, so Helium's tabs move to the right and the two don't overlap.
- **Frameless mode**: on. Hides Helium's toolbar until you hover the window edge, so the page fills the window and Compass is all you see.

Leave the rest off.

![Helium layout settings: Vertical, tabs on the right, frameless mode on](docs/helium-layout.png)

## Files

| File | What it is |
|---|---|
| `manifest.json` | Extension setup: permissions, shortcuts, icons |
| `background.js` | Listens for shortcuts, opens the overlay, runs the archive timer |
| `overlay.js` | Draws the floating panel over the page |
| `content.js` | Watches for the mouse resting on the left edge |
| `bar.html` / `bar.js` | The command bar |
| `sidebar.html` / `sidebar.js` | The sidebar |
| `favs.js` | Favorites and Pinned, shared by the bar and the sidebar |
| `archive.js` | Decides which tabs are stale enough to close |
| `archive.test.mjs` | One check for the archive logic |

## Package

```
zip -r compass-$(node -p "require('./manifest.json').version").zip manifest.json *.js *.html icons/compass-modern-{16,32,48,128}.png
```

Makes the zip to upload to the Chrome Web Store, with only the files the extension needs.

## Test

```
node archive.test.mjs
```

Prints `archive ok` if the archive rules still hold.

## Things to know

- The overlay cannot draw on browser pages like `chrome://settings` or the Web Store. The bar falls back to the toolbar popup there, and the sidebar opens as the native side panel.
- The 12 hour archive limit and the 150ms edge hover delay are fixed in code. Change them in `archive.js` and `content.js` if they feel wrong.
- To add a search site, add a line to the `ENGINES` list in `bar.js`.

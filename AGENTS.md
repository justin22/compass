# Compass: notes for agents

Arc-style command bar and sidebar, as a Manifest V3 Chrome extension. Built for Helium, works in Chromium browsers. The README is the user guide; this file is how the code works and how to change it.

## Ground rules

- **No build step, no dependencies, no TypeScript.** Plain ES modules loaded straight from the folder. The owner turned down TS and `@ts-check`; don't add them, a bundler or npm packages.
- **No human reviews this code.** The owner tests by using it. So keep changes small, read the code a change touches before editing, and say plainly what you did not test in a browser.
- **Lazy and minimal.** Smallest working change, no abstractions for one caller, no settings for values that don't change. Corners cut on purpose get a `// ponytail:` comment naming the limit and the upgrade path.
- **Match the code around you.** Short lowercase comments that say why, terse names, `replaceChildren` re-renders, no frameworks.
- **README** is user-facing and kept simple: short sentences, no implementation detail. Update it when behaviour changes. The "no human has reviewed this code" notice stays at the top.

## How it fits together

| Piece | What it does |
|---|---|
| `background.js` | Service worker. Shortcuts, Cmd+T swap (closes the blank new tab, opens the bar), Copy URL, the background-tab toast, the 30-minute archive alarm. Injects `overlay.js` into the active tab to show the bar or sidebar. |
| `overlay.js` | Draws a `<dialog>` with an iframe of `bar.html` or `sidebar.html` over the page. Talks to the frame with `postMessage` (`arcBar: 'close' / 'height' / 'focus'`). |
| `content.js` | Edge hover: mouse resting on the left edge for 150ms asks the background to open the floating sidebar. |
| `bar.html` / `bar.js` | Command bar: search tabs, bookmarks, history, archived tabs; site search engines (`ENGINES`); favorites with Cmd+1..9. |
| `sidebar.html` / `sidebar.js` | Sidebar. Runs two ways: floating in the overlay iframe (`embed`), or docked in the native side panel. |
| `switch.html` / `switch.js` | Tab switcher: a grid of the window's tabs by `lastAccessed` (row flow, next = right; columns fit the window, min two rows), with previews. Overlay only. The shortcut again steps to the next tile (`arcNext` in `overlay.js`); releasing the modifier picks. |
| `favs.js` | Shared by bar and sidebar: Favorites and Pinned (both bookmark folders), favicon URLs, URL detection, `painted()`. |
| `archive.js` | Pure `staleTabs()` rule for auto-archive, checked by `archive.test.mjs`. `dueTabs()` applies it to the open tabs with the keep rules (favorites, pins, bound tabs); the worker closes those, the sidebar's Activity popover counts them. `saveArchive()` writes closed tabs to the archive (auto-archive and the sidebar's Clear). |

### Data

- **Favorites** = children of a "Favorites" bookmarks folder. **Pinned** = a "Pinned" bookmarks folder; its subfolders are the sidebar's folders. Folder ids are remembered in `chrome.storage.local` (`favFolderId`, `pinFolderId`) because a title search can hit the wrong folder.
- These are not Chrome's pinned tabs (`tab.pinned`). Pinning a Chrome-pinned tab moves it into the Pinned folder and unpins it in Chrome.
- A pinned item "has a tab" when that tab is bound to it (opened from the pin, or pinned from the tab), else when an unbound tab's URL starts with the bookmark URL (`isUnder`). Loose, on purpose. That tab shows only in Pinned, not in the tab list. A bound tab stays the pin's tab wherever it browses; off the pinned URL the row shows Back, and its `⋯` menu (a popover, `moreButton`) adds "Pin this page instead".
- `chrome.storage.local` also holds `archive` (closed tabs, max 500) and `closedFolders` (collapsed Pinned folders).
- `chrome.storage.session` holds `names` (sidebar tab renames, by tab id; no cleanup: tab ids aren't reused within a session) and `bound` (pinned bookmark id -> its tab id; auto-archive skips bound tabs). The sidebar's `render()` prunes `bound` to pins and tabs that still exist, and `dueTabs` only honours bindings of existing pins. Pinned items rename through the bookmark title. The worker also writes `workerStart` (its last start) and `lastArchive` (`{ at, n }`) for the sidebar's Activity popover (`#activity`, a popover like `#menu`; `renderActivity()` fills it on open).
- Tab previews live in `chrome.storage.session` as `shot<tabId>` (JPEG data URL, 320px wide). `background.js` captures the active tab 400ms after activation or load and drops the key on `tabs.onRemoved`.
- Auto-archive skips active, pinned, audible tabs and anything under a Favorite or Pinned URL.

### Sidebar internals (`sidebar.js`)

- `render()` rebuilds Pinned and the tab list from scratch. `schedule()` batches tab and bookmark events into one render, and holds off while a drag or a folder rename is in progress.
- One drag system for both lists: `press` → `beginDrag` → `updateDrag` → `endDrag`, set up per list by a spec (`tabDrag`, `pinnedDrag`) giving the list, which rows it may pass, and `commit`. The row lifts and follows the pointer and the others slide aside. In Pinned, hovering the middle of a folder means "drop into it". A tab dragged up over Pinned files into the folder under the pointer (`hoverFolder`).
- `renaming` is one-shot (a bookmark id or a tab id): the next render that draws the row uses it up. Keep it that way, or a stale value pops the rename field on a later expand.
- Deleting a non-empty folder asks once more on the button itself, and so does the footer's Clear (close other tabs). No `alert` / `confirm` dialogs anywhere. A confirm state sets `ariaLabel` along with the text, or screen readers keep hearing the resting label.
- Tooltips: `tip(el, text)` sets `data-tip` (drawn by CSS, 300ms delay) and the `aria-label`. Once one has shown, `tips-warm` on `<html>` makes the next appear at once; a 400ms pause off them resets it. The native `title` is only used where there's no button.
- Footer (`#foot`, fixed): Clear left, Activity and New folder right. Activity (`#activity`, a popover like `#menu`) opens on hover after 300ms or on click, closes 250ms after the pointer leaves it; `renderActivity()` fills it before it shows. Click focuses it, hover never does.
- A popover's trigger stays lit while it's open: `.x.open` on a row's ⋯ (set in `moreButton`, cleared on the menu's `toggle`), `body:has(#activity:popover-open)` for the chart icon.

## Gotchas

- The overlay can't draw on `chrome://` pages or the Web Store. The bar falls back to the toolbar popup there, the sidebar to the native side panel.
- `runtime.getContexts` doesn't report Helium's side panel, so the background asks the panel (`dockedIn` message) whether it's docked.
- `chrome.sidePanel.open` needs a user gesture: call it first thing in the handler, before any `await`.
- `chrome.bookmarks.move` within one folder: Chrome shifts the index itself when moving down. Don't adjust it again.
- Bookmark changes have no undo. Anything that deletes bookmarks needs a confirm step.
- Favorites match open tabs loosely (`openTabFor`: URL prefix, else same host); Pinned items match by prefix only (`isUnder`), so two Google Docs can be pinned separately.
- `suggested_key` only applies when Chrome first sees a command, and never when Chrome owns the key (Cmd+Shift+C is Inspect element; Cmd+Shift+L was refused too, cause unknown). Existing installs keep their old keys. A refused key shows as "not set" with no error anywhere; `chrome://extensions/shortcuts` is the only place to see why.
- The overlay removes the iframe the instant it gets `close`, so anything the sidebar must finish (a storage write) goes before `close()`, not after an `await`.

## Checking changes

- `node archive.test.mjs` prints `archive ok`. The only automated check.
- `node --check <file>.js` for syntax.
- Everything else is manual: reload the extension at `chrome://extensions` and try it. Say so when you haven't.

## Shipping

Store zip, built from the project folder (zips are gitignored):

```
zip -r compass-$(node -p "require('./manifest.json').version").zip manifest.json *.js *.html icons/compass-modern-{16,32,48,128}.png
```

Bump `version` in `manifest.json` before each new store upload. The store rejects a version it has already seen.

Git: `main` on `github.com/justin22/compass` is PR-only. This repo's local git config commits as justin22 (noreply email) and pushes with justin22's gh token, so plain `git push` of a branch works. The gh CLI's active account is a different one, so open PRs with `GH_TOKEN=$(gh auth token --user justin22) gh pr create ...`. Commit or push only when asked.

# How Compass works

Compass has no server and no database. Everything it does is built from things your browser already has: bookmarks, tabs, history, and two small storage areas. This page says what each feature really is underneath. The [README](README.md) says how to use them.

## The sidebar is a web page

The sidebar is a small HTML page, `sidebar.html`. Chrome can show it two ways, and Compass uses both:

- **Floating**: Compass drops a `<dialog>` over the page you are on, with the sidebar page inside it in an iframe. Press Escape or click the page and the dialog is removed.
- **Docked**: the same page in Chrome's own side panel, the one you also get from the toolbar menu. It stays open while you switch tabs.

The command bar and the tab switcher are the same trick, with `bar.html` and `switch.html` in the dialog instead.

Chrome does not let extensions draw on its own pages (`chrome://` addresses, the Web Store). On those, the bar falls back to the toolbar popup and the sidebar to the docked panel.

## Pinned items are bookmarks

Open your bookmarks and you will find a folder called **Pinned**. Every pinned item is a bookmark in it. Every folder in the sidebar's Pinned section is a subfolder. That is the whole storage model, and it is why pinned items sync between your computers and show up in the bookmark manager.

Everything you do to a pinned item is a bookmark operation:

| In the sidebar | What happens |
| --- | --- |
| Pin a tab | A bookmark is created with the tab's title and address |
| Rename | The bookmark's title changes |
| Drag to reorder or into a folder | The bookmark moves |
| New folder | A bookmark folder is created |
| Unpin | The bookmark is deleted |
| Delete a folder | The folder and everything in it is deleted |

Bookmark deletion has no undo. That is why deleting a folder with things in it asks a second time.

These are not the same as Chrome's own pinned tabs, the small ones at the left of the tab strip. If you pin one of those into Compass, it is unpinned in Chrome and moves into the Pinned folder.

### How a pinned item knows which tab is its tab

A bookmark is only an address. To draw a pinned item as open, Compass has to decide which open tab belongs to it.

When you open a pinned item, or pin a tab, Compass remembers "this bookmark belongs to this tab" in session memory. From then on that tab is the pin's tab wherever it browses. Leave the pinned page and the row shows a back arrow to return, or you can repoint the pin at the page you are on now.

For tabs with no such memory, for example after the browser restarts, Compass matches by address: a tab whose address starts with the bookmark's address counts as that pin's tab, and the pairing is remembered from then on.

The memory is per browser session and is tidied every time the sidebar redraws, so pins you removed and tabs you closed drop out of it.

## Favorites are bookmarks too

The row of icons at the top is a bookmark folder called **Favorites**. Add one and a bookmark is created. Remove one and it is deleted. Clicking a favorite looks for an open tab on that site first and switches to it, and only opens a new tab if there is none.

## The tab list is just your tabs

The sidebar asks Chrome for the tabs in the current window and draws one row each. Clicking a row activates that tab. Dragging a row moves the tab in Chrome's tab strip too. Chrome's own pinned tabs come first because Chrome orders them first.

A pinned item's tab shows under Pinned, not again in the tab list.

Renaming a tab does not change the page. The name is kept in session memory under the tab's id, so it shows only in Compass and lasts until the tab or the browser closes.

## Auto-archive

Every 30 minutes a timer wakes Compass's background script. It looks for tabs that:

- have not been looked at for 12 hours,
- are not the active tab, not pinned in Chrome, not playing sound, and not private,
- and are not under a Favorite or a Pinned item's address, or bound to a pin.

Each one gets its title and address written to the **archive**, a list in local storage capped at 500 entries, one per address. Then the tab is closed. The command bar searches the archive along with your tabs, bookmarks and history, so an archived page comes back when you type part of its name.

The sidebar's **Close other tabs** button goes through the same archive step before closing.

## The command bar replaces the new tab

`Cmd+T` belongs to Chrome, and an extension cannot take it over. So Compass watches for the blank new tab Chrome opens, closes it straight away, and shows the bar over the page you were on. The brief flash is that new tab appearing and vanishing.

Searching is all Chrome's own APIs: open tabs, bookmarks, history, plus the archive above. Typing a site name such as `youtube` and pressing Tab searches that site directly, from a short list in `bar.js`.

## Tab switcher previews

Four hundred milliseconds after you switch to a tab, or a page finishes loading, Compass takes a picture of it, shrinks it to 320 pixels wide, and keeps it in session memory. The switcher shows those pictures. A tab you have not looked at since the browser started has no picture yet, so it shows its icon instead.

Pictures are dropped when their tab closes and all of them vanish when the browser closes. They never touch the disk.

## Copy URL, Picture-in-picture, and the new tab toast

These three run a small script inside the page itself. Copy URL writes to the clipboard from the page. Picture-in-picture finds the largest video on the page and pops it out. The toast adds a small button at the top of the page you stayed on. Because they run inside the page, they cannot work on Chrome's own pages, where scripts are not allowed.

## The left edge

A tiny script in every page watches the mouse. Rest it within eight pixels of the left edge for 150 milliseconds and the script asks Compass to open the floating sidebar. If the sidebar is already docked, nothing happens.

## Where things live

| What | Where | Lasts |
| --- | --- | --- |
| Pinned items and folders, Favorites | Your bookmarks | Forever, and they sync |
| Archive, collapsed folders, which bookmark folders to use | Extension storage on this computer | Until you uninstall |
| Tab renames, pin-to-tab pairings, tab pictures, when the background last ran | Session memory | Until the browser closes |

Nothing is sent anywhere. There is no account and no server. The **Activity** popover in the sidebar footer reads these same stores and Chrome's own counters, so you can see what is being kept at any moment.

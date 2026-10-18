# In Search of Pink

A small phone app that answers one question at the table: does this Fort Lauderdale restaurant have Sweet'N Low (the pink packets) in the sugar caddy?

It installs on Android from Chrome, works without signal, and lets you add restaurants and correct the list.

## Where things are

| Folder | What's in it |
| --- | --- |
| `docs/` | The app itself. GitHub Pages serves this folder. |
| `src/` | The source the app is built from. Edit these, then run `python3 src/build.py` to rebuild `docs/`. |
| `google-sheet/` | The script that turns a Google Sheet into the shared list. |
| `test/` | A stand-in for Google, used only for testing the shared list. |

## Turning the site on

In this repository: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs` → Save.**
After a minute or two the app is at <https://kgsucf.github.io/in-search-of-pink/>.

## Installing on a phone

Open the link above in Chrome, tap the three-dot menu, then **Install app**.

## Updating the app

After changing anything in `src/`, run `python3 src/build.py`, and change `pink-v1` to the next number at the top of `src/sw.js` so phones pick up the new version. Saved lists are not affected.

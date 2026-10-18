# In Search of Pink

A small phone app that answers one question at the table: does this Fort Lauderdale restaurant have Sweet'N Low (the pink packets) in the sugar caddy?

It installs on Android from Chrome, works without signal, and keeps one shared list for both phones in a Google Sheet you own.

The app lives at **<https://kgsucf.github.io/in-search-of-pink/>**.

## 1. Turn on the site (once)

In this repository: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs` → Save.**
After a minute or two the link above starts working.

## 2. Install the app on your phone

Open the link in Chrome, tap the three-dot menu, then **Install app** (some phones say **Add to Home screen**, then **Install**). The pink packet icon appears with your other apps.

## 3. Set up the shared list (once, on a computer, about 10 minutes)

1. Go to [sheets.google.com](https://sheets.google.com) and create a blank spreadsheet. Name it **In Search of Pink**.
2. Choose **Extensions → Apps Script**. Delete the few lines already there.
3. In this repository, open [`google-sheet/Code.gs`](google-sheet/Code.gs), click **Copy raw file**, paste it into Apps Script, and click **Save**.
4. Click **Deploy → New deployment**. Click the gear next to "Select type" and pick **Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**.
5. Click **Authorize access** and pick your Google account. Google warns that it hasn't verified the app, because you wrote it yourself. Click **Advanced**, then **Go to In Search of Pink**, then **Allow**.
6. Copy the **Web app URL** (it ends in `/exec`) and email it to yourself.
7. On your phone, open the app and tap the line under the title that says **On this phone only**. Paste the link and tap **Connect**. The spreadsheet fills in with the list.
8. On the same screen, tap **Send…** or **Copy link** and text the invite link to the other phone.

## 4. Add the second phone

On the other phone, tap the invite link so it opens in **Chrome** (if it opens inside another app, choose **Open in Chrome**). Wait for **You're on the shared list**, then install the app from Chrome's three-dot menu or the **Install app** button.

## Good to know

- **Fixing the list from a computer:** edit the **Restaurants** tab of the spreadsheet. In the second column type **Pink**, **No** or **Not checked**. Leave the ID column alone. Phones pick up the change within a minute while the app is open, or the next time it opens.
- **No signal:** changes wait on the phone and go to the spreadsheet once it reconnects.
- **Who can change what:** only you (and anyone you add as a collaborator) can change the app's code in this repository. The list itself lives in your Google Sheet, not here. Someone who opens the public app without an invite gets their own separate copy on their own phone and can't touch yours.
- **Keep the links private:** anyone with the invite link or the Web app URL can change the shared list. Neither link is stored in this repository or on the public site.
- **If a link ever gets out:** in Apps Script, **Deploy → Manage deployments → Archive** the old one, make a **New deployment**, and connect both phones again with the new link. The old link stops working. To undo unwanted edits, use **File → Version history** in the spreadsheet.
- **Changing the script later:** use **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. That keeps the same link. A brand-new deployment would give a new link, and every phone would need a new invite.

## Where things are

| Folder | What's in it |
| --- | --- |
| `docs/` | The app itself. GitHub Pages serves this folder. |
| `src/` | The source the app is built from. Edit these, then run `python3 src/build.py` to rebuild `docs/`. |
| `google-sheet/` | The script that turns a Google Sheet into the shared list. |
| `test/` | Tests. `fake-google.js` runs the real script against a stand-in for Google so two simulated phones can be tested together. |

## Updating the app

After changing anything in `src/`, raise the number in `pink-v2` at the top of `src/sw.js`, then run `python3 src/build.py`. Phones pick up the new version the next time the app opens. Saved lists are not affected.

# In Search of Pink

A small phone app that answers one question at the table: does this Fort Lauderdale restaurant have Sweet'N Low (the pink packets) in the sugar caddy?

Open it at a restaurant and it works out where you are: **"You're at Tap 42 — Pink packets here."** If it can't tell, it says why, and the search bar is right below. It installs on Android from Chrome, works without signal, and keeps one shared list for both phones in a Google Sheet you own.

The app lives at **<https://kgsucf.github.io/in-search-of-pink/>**.

## 1. Turn on the site (once)

In this repository: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs` → Save.**
After a minute or two the link above starts working.

## 2. Install the app on your phone

Open the link in Chrome, tap the three-dot menu, then **Install app** (some phones say **Add to Home screen**, then **Install**). The pink packet icon appears with your other apps.

The first time you open it, tap **Use my location** and allow it when Chrome asks.

## 3. Set up the shared list (once, on a computer, about 10 minutes)

The shared list also looks up each restaurant's address on the map, which is how the app recognizes where you are.

1. Go to [sheets.google.com](https://sheets.google.com) and create a blank spreadsheet. Name it **In Search of Pink**.
2. Choose **Extensions → Apps Script**. Delete the few lines already there.
3. In this repository, open [`google-sheet/Code.gs`](google-sheet/Code.gs), click **Copy raw file**, paste it into Apps Script, and click **Save**.
4. Click **Deploy → New deployment**. Click the gear next to "Select type" and pick **Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**.
5. Click **Authorize access** and pick your Google account. Google warns that it hasn't verified the app, because you wrote it yourself. Click **Advanced**, then **Go to In Search of Pink**, then **Allow**.
6. Copy the **Web app URL** (it ends in `/exec`) and email it to yourself.
7. On your phone, open the app and tap the line under the title that says **On this phone only**. Paste the link and tap **Connect**. The spreadsheet fills in with the list and the addresses are found on the map.
8. On the same screen, tap **Send…** or **Copy link** and text the invite link to the other phone.

## 4. Add the second phone

On the other phone, tap the invite link so it opens in **Chrome** (if it opens inside another app, choose **Open in Chrome**). Wait for **You're on the shared list**, then install the app from Chrome's three-dot menu or the **Install app** button.

## How it knows where you are

- Each restaurant on the original list came with its Fort Lauderdale street address. The shared list finds each address on the map.
- **Las Vegas** has about a dozen branches, so it starts without a location. Chains like Carrabba's and Cheesecake Factory start with their Fort Lauderdale branch only.
- When you're at a restaurant the app doesn't recognize (or gets wrong), search for it, open it, and tap **Save this spot**. Next time it knows. Saved spots go to the other phone too.
- On Las Olas, restaurants are only a few doors apart, so the app may ask **Which one are you at?** Pick one and tap **Save this spot for next time**, and it will know that one for sure.
- Your location stays on the phone. The app only compares it with the list; it never sends it anywhere.

## Good to know

- **Fixing the list from a computer:** edit the **Restaurants** tab of the spreadsheet. In **Pink packets?** type **Pink**, **No** or **Not checked**. You can type or fix an **Address** too; it's found on the map the next time a phone syncs. Leave the ID column and the two map columns alone. Phones pick up changes within a minute while the app is open, or the next time it opens.
- **No signal:** changes wait on the phone and go to the spreadsheet once it reconnects. Recognizing where you are works without signal.
- **Who can change what:** only you (and anyone you add as a collaborator) can change the app's code in this repository. The list itself lives in your Google Sheet, not here. Someone who opens the public app without an invite gets their own separate copy on their own phone and can't touch yours.
- **Keep the links private:** anyone with the invite link or the Web app URL can change the shared list. Neither link is stored in this repository or on the public site.
- **If a link ever gets out:** in Apps Script, **Deploy → Manage deployments → Archive** the old one, make a **New deployment**, and connect both phones again with the new link. The old link stops working. To undo unwanted edits, use **File → Version history** in the spreadsheet.
- **Changing the script later:** paste the new `Code.gs`, then use **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. That keeps the same link. A brand-new deployment would give a new link, and every phone would need a new invite.

## Where things are

| Folder | What's in it |
| --- | --- |
| `docs/` | The app itself. GitHub Pages serves this folder. |
| `src/` | The source the app is built from. Edit these, then run `python3 src/build.py` to rebuild `docs/`. |
| `google-sheet/` | The script that turns a Google Sheet into the shared list. |
| `test/` | Tests. `fake-google.js` runs the real script against a stand-in for Google; the Python files drive the app in a headless browser with simulated phones and GPS positions. |

## Updating the app

After changing anything in `src/`, raise the number in `pink-v4` at the top of `src/sw.js`, then run `python3 src/build.py`. Phones pick up the new version the next time the app opens. Saved lists are not affected.

"""Builds the app from src/.
  docs/            the installable app that GitHub Pages serves (Settings > Pages > main, /docs)
  build/preview/   a single-page version for a quick try-out as a Claude artifact
Run:  python3 src/build.py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DIST = ROOT / "docs"
PREVIEW = ROOT / "build" / "preview"

css = (SRC / "app.css").read_text()
body = (SRC / "body.html").read_text()
js = (SRC / "app.js").read_text()

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Shrikhand&display=swap">')

shutil.rmtree(DIST, ignore_errors=True)
shutil.rmtree(PREVIEW, ignore_errors=True)
(DIST / "icons").mkdir(parents=True)
PREVIEW.mkdir(parents=True)

subprocess.run([sys.executable, str(SRC / "make_icons.py"), str(DIST / "icons")], check=True)
(DIST / "icons" / "_preview-1024.png").unlink()

index = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>In Search of Pink</title>
<meta name="description" content="Which Fort Lauderdale restaurants have Sweet'N Low in the sugar caddy">
<meta name="theme-color" content="#FBF5F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171214" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Pink List">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/favicon-64.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
{FONTS}
<style>
:root {{ padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }}
body {{ margin: 0; }}
[hidden] {{ display: none !important; }}
{css}
</style>
</head>
<body>
{body}
<script>
{js}
</script>
</body>
</html>
"""
(DIST / "index.html").write_text(index)

manifest = {
    "name": "In Search of Pink",
    "short_name": "Pink List",
    "description": "Which Fort Lauderdale restaurants have Sweet'N Low in the sugar caddy",
    "id": "./",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#FBF5F7",
    "theme_color": "#FBF5F7",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
        {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
(DIST / "manifest.webmanifest").write_text(json.dumps(manifest, indent=2))
shutil.copy(SRC / "sw.js", DIST / "sw.js")

preview = f"""<title>In Search of Pink</title>
<meta name="claude:viewport-fit-sides" content="cover">
{FONTS}
<style>
{css}
</style>
{body}
<script>
{js}
</script>
"""
(PREVIEW / "in-search-of-pink.html").write_text(preview)
print("built", DIST, PREVIEW)

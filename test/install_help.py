"""Install help: the right steps for each phone and browser; invite links can be pasted to connect.
Start first:  (cd docs && python3 -m http.server 8767) ; (cd test && node fake-google.js 8766)
Run:          python3 test/install_help.py [screenshot_dir]
"""
import sys
from playwright.sync_api import sync_playwright

APP = "http://localhost:8767/"
SHEET = "http://localhost:8766/exec"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
results, errors = [], []

UA = {
    "samsung_chrome": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    "samsung_internet": "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
    "android_webview": "Mozilla/5.0 (Linux; Android 14; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36",
    "iphone_safari": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    "iphone_chrome": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
}

def check(label, cond):
    results.append(("PASS  " if cond else "FAIL  ") + label)
    print(results[-1], flush=True)

def phone(b, ua, init=None):
    ctx = b.new_context(viewport={"width": 393, "height": 852}, is_mobile=True, has_touch=True, user_agent=ua)
    if init: ctx.add_init_script(init)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, page

def help_text(page):
    page.wait_for_selector("#installBtn:not([hidden])", timeout=6000)
    page.click("#installBtn"); page.wait_for_timeout(300)
    return page.inner_text("#sheet")

with sync_playwright() as p:
    b = p.chromium.launch()
    _, P = phone(b, UA["samsung_chrome"])
    P.goto(APP); P.wait_for_timeout(3000)
    check("pill offers help when Chrome hasn't offered an install prompt", P.inner_text("#installBtn") == "How to install")
    t = help_text(P)
    check("Samsung + Chrome: Chrome steps, Install not Create shortcut", "Android, Chrome" in t and "Create shortcut" in t and "Add to Home" in t and "Pink List" in t)
    if SHOTS: P.screenshot(path=SHOTS + "/i1_chrome.png", full_page=False)
    check("address shown for copying", P.input_value("#appAddr").startswith("localhost:8767/"))
    P.click('[data-act="close"]'); P.wait_for_timeout(200)
    P.click("#menuBtn"); P.wait_for_timeout(200)
    check("menu has Install on this phone", P.locator('[data-act="install"]').is_visible())

    _, S = phone(b, UA["samsung_internet"]); S.goto(APP)
    check("Samsung Internet steps", "Add page to" in help_text(S))
    _, W = phone(b, UA["android_webview"]); W.goto(APP)
    check("inside another app: Open in Chrome first", "Open in Chrome" in help_text(W) and "inside another app" in W.inner_text("#sheet"))
    _, I = phone(b, UA["iphone_safari"]); I.goto(APP)
    t = help_text(I)
    check("iPhone Safari: Share → Add to Home Screen, and connect note", "Add to Home Screen" in t and "paste the invite link" in t)
    if SHOTS: I.screenshot(path=SHOTS + "/i2_iphone.png")
    _, C = phone(b, UA["iphone_chrome"]); C.goto(APP)
    check("iPhone Chrome steps", "iPhone, Chrome" in help_text(C))

    # installed app: no pill, no menu item
    _, A = phone(b, UA["samsung_chrome"], "Object.defineProperty(navigator, 'standalone', {get: () => true});")
    A.goto(APP); A.wait_for_timeout(3000)
    check("installed app: no install pill", A.locator("#installBtn").is_hidden())
    A.click("#menuBtn"); A.wait_for_timeout(200)
    check("installed app: no install menu item", A.locator('[data-act="install"]').count() == 0)
    A.click('[data-act="close"]'); A.wait_for_timeout(200)

    # paste an invite link to connect (how an iPhone's installed app joins)
    A.click("#syncLine"); A.wait_for_timeout(300)
    A.fill("#syncUrl", "https://kgsucf.github.io/in-search-of-pink/#join=" + SHEET.replace(":", "%3A").replace("/", "%2F"))
    A.click("#connectBtn")
    A.wait_for_selector("#inviteText", timeout=15000)
    check("pasted invite link connects", "Shared list" in A.inner_text("#sheet"))
    b.close()

print("errors:", errors)

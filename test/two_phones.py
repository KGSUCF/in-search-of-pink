"""Two phones sharing one list, against test/fake-google.js (which runs the real google-sheet/Code.gs).
Start first:  (cd docs && python3 -m http.server 8767) ; (cd test && node fake-google.js 8766)
Run:          python3 test/two_phones.py [screenshot_dir]
"""
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

APP = "http://localhost:8767/"
SHEET = "http://localhost:8766/exec"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
results, errors = [], []

def check(label, cond):
    results.append(("PASS  " if cond else "FAIL  ") + label)
    print(results[-1], flush=True)

def server_items():
    return {i["name"]: i["status"] for i in json.load(urllib.request.urlopen(SHEET))["items"]}

def settle(page, timeout=8000):
    page.wait_for_function("() => window.__pink.state !== 'busy' && window.__pink.pending.length === 0", timeout=timeout)

def status_of(page, name):
    return page.evaluate("n => { const i = window.__pink.items.find(x => x.name === n); return i ? i.status : null }", name)

def phone(browser):
    ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts" not in m.text and "ERR_TUNNEL" not in m.text and "ERR_FAILED" not in m.text and "ERR_INTERNET_DISCONNECTED" not in m.text else None)
    return ctx, page

def set_status(page, name, status):
    page.locator(".row", has_text=name).first.click()
    page.wait_for_timeout(300)
    page.click(f'.choice[data-status="{status}"]')
    page.wait_for_timeout(100)

def add(page, name, status):
    page.click("#addBtn"); page.wait_for_timeout(300)
    page.fill("#fName", name)
    page.click(f'.choice[data-status="{status}"]')
    page.wait_for_timeout(100)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctxA, A = phone(b)
    A.goto(APP); A.wait_for_timeout(800)
    check("A starts unshared", "On this phone only" in A.inner_text("#syncText"))

    # local edits before sharing exist
    add(A, "Wild Sea", "pink")
    set_status(A, "Boathouse", "pink")

    # bad link first
    A.click("#syncLine"); A.wait_for_timeout(300)
    if SHOTS: A.screenshot(path=SHOTS + "/t1_connect.png")
    A.fill("#syncUrl", "https://example.com/nope")
    A.click("#connectBtn")
    check("bad link rejected with a message", A.locator("#syncMsg").is_visible() and "Web app link" in A.inner_text("#syncMsg"))
    A.fill("#syncUrl", SHEET)
    A.click("#connectBtn")
    A.wait_for_selector("#inviteText", timeout=8000)
    s = server_items()
    check(f"empty sheet filled from A ({len(s)} rows)", len(s) == 26 and s.get("Boathouse") == "pink" and s.get("Wild Sea") == "pink")
    check("A shows shared + up to date", "Up to date" in A.inner_text("#sharedState") and A.locator(".good").is_visible())
    invite = A.input_value("#inviteText")
    check("invite link carries the sheet link", "#join=" in invite)
    if SHOTS: A.screenshot(path=SHOTS + "/t2_shared_sheet.png")
    A.click('[data-act="close"]'); A.wait_for_timeout(200)
    if SHOTS: A.screenshot(path=SHOTS + "/t3_home_shared.png")

    # phone B used the app alone first
    ctxB, B = phone(b)
    B.goto(APP); B.wait_for_timeout(600)
    add(B, "Bobs Diner", "no")
    set_status(B, "Fogo", "no")
    B.goto(invite); B.wait_for_timeout(300)
    settle(B)
    check("B joined from invite link", "up to date" in B.inner_text("#syncText"))
    check("B's join link removed from address bar", "#join" not in B.url)
    check("B adopted shared list (Fogo stays Pink)", status_of(B, "Fogo") == "pink")
    check("B's own new restaurant kept and shared", status_of(B, "Bobs Diner") == "no" and server_items().get("Bobs Diner") == "no")
    check("B has Wild Sea from A", status_of(B, "Wild Sea") == "pink")

    # B changes, A sees
    set_status(B, "Doc B", "no"); settle(B)
    A.evaluate("window.__pink.sync()"); settle(A)
    check("A sees B's change to Doc B’s", status_of(A, "Doc B’s") == "no")
    check("A sees Bobs Diner", status_of(A, "Bobs Diner") == "no")

    # A offline: changes wait, B keeps editing
    ctxA.set_offline(True)
    A.locator(".row", has_text="Kaluz").click(); A.wait_for_timeout(300)
    A.click("#delBtn"); A.click("#delYes"); A.wait_for_timeout(100)
    add(A, "Casa Sensei", "pink")
    A.wait_for_timeout(800)
    txt = A.inner_text("#syncText")
    check(f"A offline shows waiting changes: '{txt}'", "2 changes will sync" in txt)
    if SHOTS: A.screenshot(path=SHOTS + "/t4_offline.png")
    set_status(B, "Tap 42", "no"); settle(B)
    A.reload(); A.wait_for_timeout(800)
    check("A offline after reload still has its changes", status_of(A, "Casa Sensei") == "pink" and status_of(A, "Kaluz") is None)
    ctxA.set_offline(False)
    A.evaluate("window.__pink.sync()"); settle(A)
    s = server_items()
    check("A's offline changes reached the sheet", s.get("Casa Sensei") == "pink" and "Kaluz" not in s)
    check("A got B's Tap 42 change", status_of(A, "Tap 42") == "no")

    # undo doesn't undo the other phone's change
    set_status(A, "Moxies", "no")
    settle(A)
    set_status(B, "Mykonos", "pink"); settle(B)
    A.evaluate("window.__pink.sync()"); settle(A)
    check("A sees Mykonos pink before undo", status_of(A, "Mykonos") == "pink")
    A.click("#toastUndo"); settle(A)
    s = server_items()
    check("undo restored Moxies, kept B's Mykonos", s.get("Moxies") == "pink" and s.get("Mykonos") == "pink" and status_of(A, "Mykonos") == "pink")

    # same restaurant added on both phones while A offline
    ctxA.set_offline(True)
    add(A, "Twin Spot", "pink")
    add(B, "twin spot", "no"); settle(B)
    ctxA.set_offline(False)
    A.evaluate("window.__pink.sync()"); settle(A)
    B.evaluate("window.__pink.sync()"); settle(B)
    s = server_items()
    twins = [n for n in s if n.lower() == "twin spot"]
    check(f"one Twin Spot on the sheet ({twins})", len(twins) == 1)
    a_tw = [i for i in A.evaluate("window.__pink.items") if i["name"].lower() == "twin spot"]
    check("A shows one Twin Spot", len(a_tw) == 1)

    # hand edit in the spreadsheet shows up
    urllib.request.urlopen("http://localhost:8766/_edit").read()
    A.evaluate("window.__pink.sync()"); settle(A)
    check("row typed into the sheet appears on A", status_of(A, "Hand Typed Grill") == "pink")
    B.evaluate("window.__pink.sync()"); settle(B)
    set_status(B, "Hand Typed", "no"); settle(B)
    check("sheet-typed row editable from B", server_items().get("Hand Typed Grill") == "no")

    # both phones agree
    na = sorted((i["name"], i["status"]) for i in A.evaluate("window.__pink.items"))
    B.evaluate("window.__pink.sync()"); settle(B)
    A.evaluate("window.__pink.sync()"); settle(A)
    na = sorted((i["name"], i["status"]) for i in A.evaluate("window.__pink.items"))
    nb = sorted((i["name"], i["status"]) for i in B.evaluate("window.__pink.items"))
    ns = sorted(server_items().items())
    check(f"A, B and the sheet match ({len(ns)} restaurants)", na == nb == ns)

    # stop sharing on B
    B.click("#syncLine"); B.wait_for_timeout(300)
    B.click("#stopBtn"); B.click("#stopYes"); B.wait_for_timeout(200)
    check("B stopped sharing", "On this phone only" in B.inner_text("#syncText"))
    B.reload(); B.wait_for_timeout(500)
    check("B stays unshared after reload, keeps list", "On this phone only" in B.inner_text("#syncText") and len(B.evaluate("window.__pink.items")) == len(ns))

    # dark screenshot of shared sheet
    ctxD = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, color_scheme="dark")
    D = ctxD.new_page(); D.goto(invite); D.wait_for_timeout(300); settle(D)
    if SHOTS: D.screenshot(path=SHOTS + "/t5_dark_home.png")
    check("no sideways scroll", D.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    b.close()

print("errors:", errors)

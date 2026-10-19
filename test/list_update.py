"""Built-in list changes reach phones and shared lists that started from the older built-in list.
Start first:  (cd docs && python3 -m http.server 8767) ; (cd test && node fake-google.js 8766)   [fresh fake]
Run:          python3 test/list_update.py
"""
import json, urllib.request
from playwright.sync_api import sync_playwright

APP = "http://localhost:8767/"
SHEET = "http://localhost:8766/exec"
results, errors = [], []

OLD = [("Boathouse", "no"), ("Big City", "no"), ("Tap 42", "pink"), ("Kaluz", "unknown")]

def check(label, cond):
    results.append(("PASS  " if cond else "FAIL  ") + label)
    print(results[-1], flush=True)

def names(page):
    return sorted(i["name"] for i in page.evaluate("window.__pink.items"))

def server_names():
    return sorted(i["name"] for i in json.load(urllib.request.urlopen(SHEET))["items"])

def phone(browser, init=None):
    ctx = browser.new_context(viewport={"width": 393, "height": 852}, is_mobile=True)
    if init:
        ctx.add_init_script(init)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, page

def seed_script(items, extra=""):
    data = json.dumps({"v": 1, "items": [{"id": "old-%d" % i, "name": n, "status": s, "updated": None} for i, (n, s) in enumerate(items)]})
    return """if (!localStorage.getItem('seeded')) {
      localStorage.setItem('seeded', '1');
      localStorage.setItem('inSearchOfPink.v1', %s);
      %s
    }""" % (json.dumps(data), extra)

with sync_playwright() as p:
    b = p.chromium.launch()

    # 1. fresh install
    _, F = phone(b)
    F.goto(APP); F.wait_for_timeout(500)
    n = names(F)
    check("fresh install: no Big City, has Sweetwaters", "Big City" not in n and "Sweetwaters" in n and len(n) == 25)
    F.reload(); F.wait_for_timeout(400)
    check("fresh install: no duplicate after reopening", names(F).count("Sweetwaters") == 1 and len(names(F)) == 25)

    # 2. a phone that saved the older list before this update
    _, O = phone(b, seed_script(OLD))
    O.goto(APP); O.wait_for_timeout(500)
    n = names(O)
    check(f"older list on a phone catches up: {n}", "Big City" not in n and "Sweetwaters" in n and "Kaluz" in n)
    sw = [i for i in O.evaluate("window.__pink.items") if i["name"] == "Sweetwaters"][0]
    check("Sweetwaters starts as Not checked, with its address", sw["status"] == "unknown" and sw["address"] == "58 E Las Olas Blvd")
    O.reload(); O.wait_for_timeout(400)
    check("applied only once", names(O).count("Sweetwaters") == 1)

    # 3. a shared list that still has Big City (made by a phone on the older version)
    ops = [{"op": "set", "id": "s-%d" % i, "name": nm, "status": st} for i, (nm, st) in enumerate(OLD)]
    req = urllib.request.Request(SHEET, data=json.dumps({"ops": ops}).encode(), method="POST")
    urllib.request.urlopen(req).read()
    check("sheet starts with Big City", "Big City" in server_names())
    sync_extra = "localStorage.setItem('inSearchOfPink.sync', %s); localStorage.setItem('inSearchOfPink.updates', %s);" % (
        json.dumps(json.dumps({"url": SHEET, "sheetUrl": "", "last": 0})), json.dumps(json.dumps(["local 2026-10-19"])))
    _, S = phone(b, seed_script(OLD, sync_extra))
    S.goto(APP)
    S.wait_for_function("() => window.__pink.state === 'ok' && window.__pink.pending.length === 0", timeout=10000)
    S.wait_for_timeout(1500)
    S.wait_for_function("() => window.__pink.state === 'ok' && window.__pink.pending.length === 0", timeout=10000)
    sn = server_names()
    check(f"shared list catches up: {sn}", "Big City" not in sn and "Sweetwaters" in sn)
    b.close()

print("errors:", errors)

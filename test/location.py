"""'Where are we?' tests: simulated GPS positions against test/fake-google.js (the real sheet script).
Start first:  (cd docs && python3 -m http.server 8767) ; (cd test && node fake-google.js 8766)   [fresh fake each run]
Run:          python3 test/location.py [screenshot_dir]
"""
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

APP = "http://localhost:8767/"
SHEET = "http://localhost:8766/exec"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
results, errors = [], []

# test spots (match TEST_POINTS in fake-google.js)
TAP42 = (26.10460, -80.14340)
WORTHWYLD = (26.11900, -80.14000)
BETWEEN_811_817 = (26.11915, -80.13615)   # midway between American Social and El Camino
NOWHERE = (26.30000, -80.05000)           # Pompano, nothing from the test list nearby

def check(label, cond):
    results.append(("PASS  " if cond else "FAIL  ") + label)
    print(results[-1], flush=True)

def server():
    return {i["name"]: i for i in json.load(urllib.request.urlopen(SHEET))["items"]}

def settle(page, timeout=10000):
    page.wait_for_function("() => window.__pink.state !== 'busy' && window.__pink.pending.length === 0", timeout=timeout)

def here_text(page):
    return page.inner_text("#here") if page.locator("#here").is_visible() else ""

def locate(page, ctx, pos, acc=15):
    ctx.set_geolocation({"latitude": pos[0], "longitude": pos[1], "accuracy": acc})
    page.evaluate("window.__pink.locate()")
    page.wait_for_function("() => window.__pink.here !== 'locating'", timeout=15000)
    page.wait_for_timeout(150)

def phone(browser, granted=True, scheme="light"):
    kw = dict(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme=scheme)
    if granted:
        kw.update(permissions=["geolocation"], geolocation={"latitude": 38.72, "longitude": -9.14, "accuracy": 20})  # starts far away
    ctx = browser.new_context(**kw)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and not any(x in m.text for x in ("ERR_TUNNEL", "ERR_FAILED", "ERR_INTERNET")) else None)
    return ctx, page

with sync_playwright() as p:
    b = p.chromium.launch()

    # --- before anything is known
    ctxA, A = phone(b)
    A.goto(APP); A.wait_for_function("() => window.__pink.here !== 'locating'", timeout=15000)
    t = here_text(A)
    check("no locations yet: says it can't tell and why", "doesn’t know where your restaurants are yet" in t and "search below" in t)
    if SHOTS: A.screenshot(path=SHOTS + "/l0_noplaces.png")

    # --- connect: the sheet looks up the addresses
    A.click("#syncLine"); A.wait_for_timeout(300)
    A.fill("#syncUrl", SHEET); A.click("#connectBtn")
    A.wait_for_selector("#inviteText", timeout=15000)
    A.click('[data-act="close"]'); settle(A)
    s = server()
    check("sheet found Tap 42 from its address", s["Tap 42"]["geoState"] == "ok")
    check("Las Vegas has no address (many branches)", s["Las Vegas"]["geoState"] == "none")
    check("phone got the map spots", A.evaluate("window.__pink.items.filter(i => i.geo).length") >= 24)

    # --- at Tap 42
    locate(A, ctxA, TAP42, 12)
    t = here_text(A)
    check(f"at Tap 42: '{t[:60]}…'", "YOU’RE AT" in t.upper() and "Tap 42" in t and "Pink packets here" in t)
    check("pink card styling", A.get_attribute("#here", "data-kind") == "pink")
    check("search bar still there below", A.locator("#q").is_visible())
    if SHOTS: A.screenshot(path=SHOTS + "/l1_match_pink.png")

    # --- weaker GPS at Tap 42: still a guess, worded as one
    locate(A, ctxA, TAP42, 90)
    t = here_text(A)
    check("weaker fix says 'Looks like you’re at'", "LOOKS LIKE" in t.upper() and "Tap 42" in t)

    # --- between American Social and El Camino
    locate(A, ctxA, BETWEEN_811_817, 15)
    t = here_text(A)
    check(f"between two: asks which one", "Which one are you at?" in t and "El Camino" in t and "American Social" in t)
    if SHOTS: A.screenshot(path=SHOTS + "/l2_choose.png")
    A.locator("#here .row", has_text="El Camino").click(); A.wait_for_timeout(150)
    t = here_text(A)
    check("picked El Camino: shows No pink + save spot", "El Camino" in t and "No pink here" in t and "Save this spot" in t)
    if SHOTS: A.screenshot(path=SHOTS + "/l3_picked_no.png")
    A.click('#here [data-here="savespot"]'); settle(A)
    check("spot saved to the sheet", len(server()["El Camino"]["spots"]) == 1)
    locate(A, ctxA, BETWEEN_811_817, 15)
    t = here_text(A)
    check("same spot again: now sure it's El Camino", "YOU’RE AT" in t.upper() and "El Camino" in t and "Which one" not in t)

    # --- not-checked restaurant: one-tap answer
    locate(A, ctxA, WORTHWYLD, 15)
    t = here_text(A)
    check("Worthwyld not checked: offers quick answers", "Nobody has checked yet" in t and "Pink packets" in t)
    if SHOTS: A.screenshot(path=SHOTS + "/l4_unknown.png")
    A.click('#here [data-here="mark"][data-status="pink"]'); settle(A)
    check("quick answer saved", server()["Worthwyld"]["status"] == "pink" and A.get_attribute("#here", "data-kind") == "pink")

    # --- somewhere with nothing on the list
    locate(A, ctxA, NOWHERE, 15)
    t = here_text(A)
    check("nowhere: says nothing on the list is near", "No restaurant on your list is saved near here." in t)
    if SHOTS: A.screenshot(path=SHOTS + "/l5_none.png")
    A.click('#here [data-here="add"]'); A.wait_for_timeout(300)
    check("add sheet offers 'I’m here now', already ticked", A.locator("#fHere").is_checked())
    A.fill("#fName", "Casa Sensei"); A.fill("#fAddr", "1201 N Federal Hwy")
    A.click('.choice[data-status="pink"]'); settle(A)
    t = here_text(A)
    check("new restaurant recognized right away", "Casa Sensei" in t and "Pink packets here" in t)
    cs = server()["Casa Sensei"]
    check("its spot and address reached the sheet", len(cs["spots"]) == 1 and cs["address"] == "1201 N Federal Hwy" and cs["geoState"] == "ok")

    # --- vague fix
    locate(A, ctxA, TAP42, 600)
    t = here_text(A)
    check("vague GPS: explains accuracy", "only accurate to about 600 m" in t)

    # --- not here
    locate(A, ctxA, TAP42, 12)
    A.click('#here [data-here="dismiss"]'); A.wait_for_timeout(150)
    check("Not here? → points to search, search focused", "Search for the restaurant below." in here_text(A) and A.evaluate("document.activeElement.id") == "q")

    # --- edit sheet: address + spot controls
    A.locator("#list .row", has_text="Las Vegas").click(); A.wait_for_timeout(300)
    check("edit sheet shows Save this spot (fresh GPS)", A.locator("#spotBtn").is_visible())
    A.fill("#fAddr", "1 Nowhere St"); A.click("#addrBtn"); settle(A)
    A.locator("#list .row", has_text="Las Vegas").click(); A.wait_for_timeout(300)
    check("bad address reported", "Couldn’t find this address" in A.inner_text("#mapState"))
    if SHOTS: A.screenshot(path=SHOTS + "/l6_edit_where.png")
    A.click('[data-act="close"]'); A.wait_for_timeout(200)

    # --- second phone gets saved spots
    invite = None
    A.click("#syncLine"); A.wait_for_timeout(300); invite = A.input_value("#inviteText"); A.click('[data-act="close"]')
    ctxB, B = phone(b, scheme="dark")
    ctxB.set_geolocation({"latitude": BETWEEN_811_817[0], "longitude": BETWEEN_811_817[1], "accuracy": 15})
    B.goto(invite); settle(B)
    B.evaluate("window.__pink.locate()"); B.wait_for_function("() => window.__pink.here !== 'locating'", timeout=15000); B.wait_for_timeout(200)
    t = here_text(B)
    check("other phone recognizes El Camino from the saved spot", "El Camino" in t and "Which one" not in t)
    if SHOTS: B.screenshot(path=SHOTS + "/l7_dark_match.png")
    check("no sideways scroll", B.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))

    # --- permission refused / first-time ask
    ctxC, C = phone(b, granted=False)
    C.goto(APP); C.wait_for_timeout(600)
    t = here_text(C)
    check("first time: asks before using location", "Use my location" in t)
    if SHOTS: C.screenshot(path=SHOTS + "/l8_ask.png")
    ctxD = b.new_context(viewport={"width": 393, "height": 852}, is_mobile=True)
    D = ctxD.new_page()
    D.add_init_script("navigator.permissions.query = () => Promise.resolve({state: 'denied'});")
    D.goto(APP); D.wait_for_timeout(600)
    check("blocked: says location is off and how to fix", "isn’t allowed to use your location" in here_text(D))
    ctxE = b.new_context(viewport={"width": 393, "height": 852}, is_mobile=True)
    E = ctxE.new_page()
    E.add_init_script("""navigator.permissions.query = () => Promise.resolve({state: 'granted'});
      navigator.geolocation.watchPosition = (ok, err) => { setTimeout(() => err({code: 2, message: 'unavailable'}), 50); return 1; };
      navigator.geolocation.clearWatch = () => {};""")
    E.goto(APP); E.wait_for_timeout(13500)
    check("no fix at all: says it couldn't get a location", "Couldn’t get your location." in here_text(E))
    b.close()

print("errors:", errors)

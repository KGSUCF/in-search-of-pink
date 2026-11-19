"""'What restaurant is this?': nearby restaurants and addresses from OpenStreetMap (simulated here).
Start first:  (cd docs && python3 -m http.server 8767)
Run:          python3 test/nearby.py [screenshot_dir]
"""
import json, sys
from playwright.sync_api import sync_playwright

APP = "http://localhost:8767/"
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
results, errors = [], []
HERE = (26.30000, -80.05000)

NEARBY = {"elements": [
    {"type": "node", "lat": 26.30008, "lon": -80.05004,
     "tags": {"name": "Tap 42 Craft Kitchen & Bar", "amenity": "restaurant"}},
    {"type": "node", "lat": 26.30010, "lon": -80.05005,
     "tags": {"name": "Naia", "amenity": "restaurant", "addr:housenumber": "904", "addr:street": "East Las Olas Boulevard"}},
    {"type": "way", "center": {"lat": 26.30030, "lon": -80.04990}, "tags": {"name": "Casa Test", "amenity": "restaurant"}},
    {"type": "node", "lat": 26.30040, "lon": -80.05040, "tags": {"amenity": "cafe"}},   # no name: left out
]}
REVERSE = {"address": {"house_number": "904", "road": "East Las Olas Boulevard", "city": "Fort Lauderdale",
                       "state": "Florida", "postcode": "33301", "ISO3166-2-lvl4": "US-FL"}}
mode = {"overpass": "ok"}   # ok | empty | down

def check(label, cond):
    results.append(("PASS  " if cond else "FAIL  ") + label)
    print(results[-1], flush=True)

def item(page, name):
    return page.evaluate("n => window.__pink.items.find(i => i.name === n) || null", name)

def lookup(page):
    for leave in ("back", "dismiss"):   # get back to a card that offers the lookup
        if page.locator('#here [data-here="whatshere"]').count():
            break
        if page.locator(f'#here [data-here="{leave}"]').count():
            page.click(f'#here [data-here="{leave}"]'); page.wait_for_timeout(100)
    page.click('#here [data-here="whatshere"]')

def overpass(route):
    if mode["overpass"] == "down":
        return route.abort()
    body = {"elements": []} if mode["overpass"] == "empty" else NEARBY
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))

def nominatim(route):
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(REVERSE))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        permissions=["geolocation"], geolocation={"latitude": HERE[0], "longitude": HERE[1], "accuracy": 15})
    ctx.route("**/api/interpreter**", overpass)
    ctx.route("**nominatim.openstreetmap.org/**", nominatim)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(APP)
    page.wait_for_function("() => window.__pink.here !== 'locating'", timeout=15000)
    page.wait_for_timeout(200)

    # list restaurants with no saved location yet: the card offers the lookup
    check("card offers 'What restaurant is this?'", page.locator('#here [data-here="whatshere"]').is_visible())
    page.click('#here [data-here="whatshere"]')
    page.wait_for_selector('#here [data-here="near"]', timeout=5000)
    t = page.inner_text("#here")
    check("lists the restaurants right here", "Casa Test" in t and "Naia" in t and "Tap 42 Craft Kitchen" in t)
    check("knows Tap 42 is already on the list", "On your list as Tap 42" in t)
    check("unnamed places left out", t.count("Tap to add it") == 2)
    if SHOTS: page.screenshot(path=SHOTS + "/n1_nearby.png")

    # a new one: add it with name, address and spot filled in
    page.locator('#here .row', has_text="Casa Test").click()
    page.wait_for_function("() => document.querySelector('#fAddr') && document.querySelector('#fAddr').value", timeout=5000)
    check("add sheet: name filled in", page.input_value("#fName") == "Casa Test")
    check("add sheet: address filled in", page.input_value("#fAddr") == "904 East Las Olas Boulevard, Fort Lauderdale, FL 33301")
    check("add sheet: 'I'm here' ticked", page.locator("#fHere").is_checked())
    if SHOTS: page.screenshot(path=SHOTS + "/n2_add_filled.png")
    page.click('.choice[data-status="pink"]'); page.wait_for_timeout(300)
    it = item(page, "Casa Test")
    check("saved with address and spot", it and it["address"].startswith("904 East Las Olas") and len(it["spots"]) == 1)
    check("card now says you're at Casa Test", "Casa Test" in page.inner_text("#here") and "Pink packets here" in page.inner_text("#here"))

    # one already on the list: remember the spot here
    page.click('#here [data-here="dismiss"]'); page.wait_for_timeout(100)
    page.click('#here [data-here="whatshere"]')
    page.wait_for_selector('#here [data-here="near"]', timeout=5000)
    page.locator('#here .row', has_text="Tap 42 Craft Kitchen").click(); page.wait_for_timeout(300)
    t = page.inner_text("#here")
    check("picking a list restaurant shows its card", "Tap 42" in t and "Pink packets here" in t)
    tap = item(page, "Tap 42")
    check("Tap 42 got this spot, kept its own address", len(tap["spots"]) == 1 and tap["address"] == "1411 S Andrews Ave")

    # added by name earlier, no address: the lookup fills it in
    page.click("#menuBtn"); page.click('[data-act="import"]')
    page.fill("#importText", "Naia   ?"); page.click("#doImport"); page.wait_for_timeout(200)
    check("Naia on the list without an address", item(page, "Naia")["address"] == "")
    page.click('#here [data-here="dismiss"]'); page.wait_for_timeout(100)
    page.click('#here [data-here="whatshere"]')
    page.wait_for_selector('#here [data-here="near"]', timeout=5000)
    page.locator('#here .row', has_text="Naia").click()
    page.wait_for_function("() => (window.__pink.items.find(i => i.name === 'Naia') || {}).address", timeout=5000)
    n = item(page, "Naia")
    check("Naia got its spot and address", len(n["spots"]) == 1 and n["address"] == "904 East Las Olas Boulevard, Fort Lauderdale, FL 33301")

    # typing a new name in search, then adding it while there
    page.fill("#q", "Zed's Diner"); page.wait_for_timeout(100)
    page.click('[data-act="addq"]'); page.wait_for_timeout(300)
    check("search add: offers to fill the address", page.locator("#fillHere").is_visible() and not page.locator("#fHere").is_checked())
    page.click("#fillHere")
    page.wait_for_function("() => document.querySelector('#fAddr').value", timeout=5000)
    check("search add: address filled and 'I'm here' ticked", page.input_value("#fAddr").startswith("904 East") and page.locator("#fHere").is_checked())
    page.click('[data-act="close"]'); page.wait_for_timeout(200)
    page.fill("#q", "")

    # Save this spot also fills a missing address
    page.locator("#list .row", has_text="Las Vegas").click(); page.wait_for_timeout(300)
    page.click("#spotBtn")
    page.wait_for_function("() => (window.__pink.items.find(i => i.name === 'Las Vegas') || {}).address", timeout=5000)
    check("Save this spot filled Las Vegas's address", item(page, "Las Vegas")["address"].startswith("904 East"))

    # nothing on the map here
    mode["overpass"] = "empty"
    lookup(page); page.wait_for_timeout(500)
    check("empty map: says so, offers to add", "No restaurant is listed right here" in page.inner_text("#here") and page.locator('#here [data-here="add"]').is_visible())

    # lookup service down
    mode["overpass"] = "down"
    lookup(page); page.wait_for_timeout(800)
    t = page.inner_text("#here")
    check("service down: explains and offers to add", "Couldn’t look up restaurants here." in t and page.locator('#here [data-here="add"]').is_visible())
    if SHOTS: page.screenshot(path=SHOTS + "/n3_error.png")
    page.click('#here [data-here="add"]'); page.wait_for_function("() => document.querySelector('#fAddr') && document.querySelector('#fAddr').value", timeout=5000)
    check("add the restaurant you're at: address from where you are", page.input_value("#fAddr").startswith("904 East"))
    check("no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"))
    b.close()

print("errors:", errors)

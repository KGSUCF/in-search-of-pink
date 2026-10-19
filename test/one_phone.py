import json, sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8767/"
import sys
OUT = (sys.argv[1] + '/') if len(sys.argv) > 1 else '/tmp/'
errors = []
results = []

def check(label, cond):
    results.append(("PASS" if cond else "FAIL") + "  " + label)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        color_scheme="light", service_workers="allow")
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_timeout(1500)
    rows = page.locator(".row")
    check("25 restaurants pre-loaded", rows.count() == 25)
    counts = {k: page.locator(f'[data-n="{k}"]').inner_text() for k in ["all", "pink", "no", "unknown"]}
    check(f"counts {counts}", counts == {"all": "25", "pink": "11", "no": "10", "unknown": "4"})
    page.screenshot(path=OUT + "s1_home_light.png")

    # search
    page.fill("#q", "doc b")
    check("search 'doc b' finds Doc B’s only", rows.count() == 1 and "Doc B" in rows.first.inner_text())
    page.fill("#q", "cheesecake fact")
    check("search 'cheesecake fact' finds Cheesecake Factory", rows.count() == 1)
    page.fill("#q", "delfriscos")
    check("search without spaces/apostrophe finds Del Frisco’s", rows.count() == 1)

    # add from empty search
    page.fill("#q", "Wild Sea")
    check("unknown restaurant shows add button", page.locator('[data-act="addq"]').is_visible())
    page.screenshot(path=OUT + "s2_not_found.png")
    page.click('[data-act="addq"]'); page.wait_for_timeout(400)
    check("add sheet prefilled", page.input_value("#fName") == "Wild Sea")
    page.screenshot(path=OUT + "s3_add_sheet.png")
    page.click('.choice[data-status="pink"]')
    page.wait_for_timeout(200)
    check("Wild Sea added and shown", rows.count() == 1 and "PINK" in rows.first.inner_text().upper())
    check("toast shows", page.locator("#toast").is_visible() and "Added Wild Sea" in page.inner_text("#toastMsg"))

    # persists across reload
    page.reload(); page.wait_for_timeout(800)
    check("26 after reload (saved)", rows.count() == 26)

    # correct a status + undo
    page.locator(".row", has_text="Doc B").click(); page.wait_for_timeout(400)
    page.screenshot(path=OUT + "s4_edit_sheet.png")
    page.click('.choice[data-status="no"]')
    page.wait_for_timeout(200)
    check("Doc B’s changed to No", page.locator('.row', has_text="Doc B").get_attribute("aria-label").endswith("No pink"))
    page.click("#toastUndo")
    check("undo restores Pink", page.locator('.row', has_text="Doc B").get_attribute("aria-label").endswith("Pink"))

    # add via FAB with duplicate warning
    page.click("#addBtn")
    page.fill("#fName", "tap 42")
    check("duplicate warning on add", page.locator("#addMsg").is_visible())
    page.click('[data-act="close"]')

    # rename
    page.locator(".row", has_text="YOT").click()
    page.fill("#fName", "YOT Bar & Kitchen")
    page.click("#renameBtn")
    check("renamed YOT", page.locator(".row", has_text="YOT Bar & Kitchen").count() == 1)

    # delete Kaluz
    page.locator(".row", has_text="Kaluz").click()
    page.click("#delBtn"); page.wait_for_timeout(400)
    page.screenshot(path=OUT + "s5_delete_confirm.png")
    page.click("#delYes")
    check("Kaluz removed", page.locator(".row", has_text="Kaluz").count() == 0 and page.inner_text('[data-n="unknown"]') == "3")

    # filters
    page.click('.chip[data-f="pink"]')
    check("Pink filter shows 12", rows.count() == 12)
    page.click('.chip[data-f="all"]')

    # share text
    page.click("#menuBtn"); page.click('[data-act="share"]')
    share = page.input_value("#shareText")
    check("share text has sections", "PINK\n" in share and "NO PINK\n" in share and "NOT CHECKED\n" in share)
    page.click('[data-act="close"]')

    # import: husband-style lines + app format
    page.click("#menuBtn"); page.click('[data-act="import"]')
    page.fill("#importText", "Boathouse              Pink\nWorthwyld    No\nCasa Sensei   Pink\nKaluz\n60 Vines   No")
    msg = page.inner_text("#importMsg")
    check(f"import preview: {msg}", "Found 5" in msg)
    page.click("#doImport")
    page.wait_for_timeout(200)
    t = page.inner_text("#toastMsg")
    check(f"import result: {t}", "2 added, 2 updated" in t)
    check("Boathouse now Pink", page.locator('.row', has_text="Boathouse").get_attribute("aria-label").endswith("Pink"))
    check("60 Vines still sorted first", rows.first.inner_text().startswith("60 Vines"))

    # round trip: share text re-imported changes nothing
    parsed = page.evaluate("window.__pink.parseList(document.createElement('div').textContent || '')")
    page.click("#menuBtn"); page.click('[data-act="share"]')
    share = page.input_value("#shareText")
    page.click('[data-act="close"]')
    page.click("#menuBtn"); page.click('[data-act="import"]')
    page.fill("#importText", share)
    page.click("#doImport")
    check("re-importing own list changes nothing", "already matches" in page.inner_text("#toastMsg"))

    # service worker + offline
    sw = page.evaluate("navigator.serviceWorker.getRegistration().then(r => !!(r && (r.active || r.installing || r.waiting)))")
    check("offline helper registered", sw)
    page.wait_for_timeout(1000)
    ctx.set_offline(True)
    page.reload(); page.wait_for_timeout(1000)
    check("opens with no signal", page.locator(".row").count() == 27)
    ctx.set_offline(False)

    # manifest is valid json
    man = page.evaluate("fetch('manifest.webmanifest').then(r=>r.json())")
    check("manifest loads", man.get("display") == "standalone")

    # dark
    ctx2 = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="dark")
    p2 = ctx2.new_page(); p2.goto(URL); p2.wait_for_timeout(1200)
    p2.screenshot(path=OUT + "s6_home_dark.png")
    p2.locator(".row", has_text="Fogo").click(); p2.wait_for_timeout(400)
    p2.screenshot(path=OUT + "s7_edit_dark.png")
    sw_ = p2.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    check("no sideways scroll", sw_)
    b.close()

print("\n".join(results))
print("console errors:", errors)

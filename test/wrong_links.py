"""The connect box explains the links people paste by mistake.
Start first:  (cd docs && python3 -m http.server 8767)
Run:          python3 test/wrong_links.py
"""
from playwright.sync_api import sync_playwright

APP = "http://localhost:8767/"
results, errors = [], []

def check(label, cond):
    results.append(("PASS  " if cond else "FAIL  ") + label)
    print(results[-1], flush=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 393, "height": 852}, is_mobile=True).new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(APP); page.wait_for_timeout(500)
    page.click("#syncLine"); page.wait_for_timeout(300)
    cases = [
        ("https://docs.google.com/spreadsheets/d/1AbCdEfGh/edit?gid=0#gid=0", "link to the spreadsheet itself"),
        ("https://script.google.com/u/0/home/projects/1XyZ/edit", "link to the script editor"),
        ("https://script.google.com/macros/s/AKfycbx123/dev", "test link"),
    ]
    for link, want in cases:
        page.fill("#syncUrl", link); page.wait_for_timeout(100)
        check(f"typing {link[:40]}… explains it", want in page.inner_text("#syncMsg") and page.locator("#syncMsg").is_visible())
        page.click("#connectBtn"); page.wait_for_timeout(100)
        check("  tapping Connect explains it too", want in page.inner_text("#syncMsg"))
    page.fill("#syncUrl", "https://script.google.com/macros/s/AKfycbx123/exec"); page.wait_for_timeout(100)
    check("a real Web app link shows no warning while typing", page.locator("#syncMsg").is_hidden())
    page.fill("#syncUrl", "https://script.google.com/a/macros/example.com/s/AKfy_-9/exec"); page.wait_for_timeout(100)
    check("a Google Workspace Web app link is accepted too", page.locator("#syncMsg").is_hidden())
    b.close()
print("errors:", errors)

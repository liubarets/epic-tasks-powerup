"""“＋ All cards” in the epic's toolbar: cards for every checklist at once, against a mocked Trello.
Run from the repo root:  python3 test/run_all.py
"""
import functools, http.server, json, pathlib, sys, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
MOCK = (ROOT / "test" / "mock-powerup.js").read_text(encoding="utf-8")
OUT = ROOT / "test" / "out"
OUT.mkdir(exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"

fails = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)

MARIA = "mem" + "1".zfill(21)
AS_MARIA = """S => {
  S.me = { id: 'mem' + '1'.padStart(21, '0'), username: 'maria_petrenko', fullName: 'Maria Petrenko' };
}"""
ONE_CHECKLIST = """S => { S.me = { id: 'mem' + '1'.padStart(21, '0'), username: 'maria_petrenko', fullName: 'Maria Petrenko' }; S.checklists = [S.checklists[0]]; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 720, "height": 900}, device_scale_factor=2)
    errors = []

    def open_page(path, patch=None):
        pg = ctx.new_page()
        pg.route("https://p.trellocdn.com/power-up.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
        pg.route("https://p.trellocdn.com/power-up.min.css", lambda r: r.fulfill(body="", content_type="text/css"))
        pg.on("pageerror", lambda e: errors.append(f"{path}: {e}"))
        pg.on("console", lambda m: errors.append(f"{path}: {m.text}") if m.type == "error" else None)
        if patch:
            pg.add_init_script("window.__mockPatch = " + patch)
        pg.goto(f"{BASE}/{path}")
        return pg

    page = open_page("section.html", AS_MARIA)
    page.wait_for_selector(".cl")
    S = lambda: page.evaluate("window.__state")
    allb = page.locator(".all-btn")
    check(allb.inner_text() == "＋ All cards (10) ▾", f"toolbar button counts open items × people of every checklist: {allb.inner_text()}")
    check(page.locator(".my-btn").all_inner_texts() == ["＋ Cards (6) ▾", "＋ Cards (4) ▾"], "per-checklist buttons are still there")
    allb.click()
    menu = page.locator(".all-menu")
    head = menu.locator(".my-menu-head").inner_text()
    names = menu.locator(".my-name").all_inner_texts()
    counts = menu.locator(".my-n").all_inner_texts()
    check("this epic" in head and "2 checklists" in head, f"menu head: {head}")
    check(names[0] == "Me" and names[-1] == "Everyone" and counts[0] == "5" and counts[-1] == "10",
          f"a row per person summed over the checklists (me 2 + 3) + Everyone: {names} {counts}")
    check(len(set(names)) == len(names), "each person once")
    page.screenshot(path=str(OUT / "all-1-menu.png"), full_page=True)

    # Me → ☰ Checklist: one card per checklist
    menu.locator(".my-row").first.locator("button", has_text="Checklist").click()
    page.wait_for_function("Object.values(window.__state.cards).filter(c => / \\/ (Spring merch|Retail SDK)/.test(c.name)).length === 2", timeout=8000)
    page.wait_for_selector(".all-menu .my-ok")
    page.wait_for_timeout(500)
    st = S()
    kids = sorted(c["name"] for c in st["cards"].values() if " / " in c["name"] and MARIA in c["idMembers"])
    check(kids == ["PRODUCT LAUNCHES & UPDATES / Retail SDK - 26.11", "PRODUCT LAUNCHES & UPDATES / Spring merch 24.11"], f"two cards for me, one per checklist: {kids}")
    items = {c["name"].split(" / ")[1]: len(c["checklists"][0]["checkItems"]) for c in st["cards"].values() if " / " in c["name"] and MARIA in c["idMembers"]}
    check(items == {"Spring merch 24.11": 2, "Retail SDK - 26.11": 3}, f"each with my items of that checklist: {items}")
    check(page.locator(".all-menu").count() == 1, "the menu stays open")
    ok = page.locator(".all-menu .my-ok").first.inner_text()
    check("5 items added" in ok, f"my row: {ok}")
    check(page.locator(".my-btn").all_inner_texts() == ["＋ Cards (4) ▾", "＋ Cards (1) ▾"], "per-checklist counts follow")
    check(allb.inner_text() == "＋ All cards (5) ▾", f"5 left: {allb.inner_text()}")

    # Everyone → ▤ Each: a separate card for every item left
    before = {k for k, c in S()["cards"].items() if " — " in c["name"]}
    page.locator(".all-menu .my-row.all").locator("button", has_text="Each").click()
    page.wait_for_function("document.querySelector('.all-btn') && document.querySelector('.all-btn').disabled", timeout=10000)
    page.wait_for_timeout(500)
    st = S()
    seps = [c for k, c in st["cards"].items() if " — " in c["name"] and k not in before]
    check(len(seps) == 5, f"5 separate cards: {sorted(c['name'] for c in seps)}")
    check(allb.inner_text() == "＋ All cards" and page.locator(".my-btn").all_inner_texts() == ["＋ Cards", "＋ Cards"], "nothing left: buttons grey")
    page.screenshot(path=str(OUT / "all-2-done.png"), full_page=True)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check(page.locator(".all-menu").count() == 0, "Esc closes the menu")
    page.close()

    # ↪️ NS (next sprint) items are not offered by "＋ Cards" / "＋ All cards"; a whole NS checklist neither
    ns = open_page("section.html", """S => { S.me = { id: 'mem' + '1'.padStart(21, '0'), username: 'maria_petrenko', fullName: 'Maria Petrenko' };
      const it = S.checklists[0].checkItems.find(i => i.name.indexOf('Approve with legal') !== -1); it.name = '↪️ ' + it.name; }""")
    ns.wait_for_selector(".cl")
    check(ns.locator(".my-btn").all_inner_texts() == ["＋ Cards (5) ▾", "＋ Cards (4) ▾"] and ns.locator(".all-btn").inner_text() == "＋ All cards (9) ▾",
          f"an NS item is skipped: {ns.locator('.my-btn').all_inner_texts()} {ns.locator('.all-btn').inner_text()}")
    check(ns.locator(".chip.add").count() > 0 and "NS" in ns.locator("select.prio").nth(1).inner_text(), "its chip is still there; NS is in the priority list")
    ns.close()
    ns2 = open_page("section.html", """S => { S.me = { id: 'mem' + '1'.padStart(21, '0'), username: 'maria_petrenko', fullName: 'Maria Petrenko' };
      S.checklists[1].name = '↪️ ' + S.checklists[1].name; }""")
    ns2.wait_for_selector(".cl")
    btns = ns2.locator(".my-btn").all_inner_texts()
    check(btns[1] == "＋ Cards (1) ▾" and ns2.locator(".all-btn").inner_text() == "＋ All cards (7) ▾",
          f"an NS checklist: only its item with its own priority (🔴) is offered: {btns}")
    ns2.close()

    # a big epic folds checklists so the section stays under Trello's 1500 px cap (no scroll there)
    big = open_page("section.html", """S => {
      const who = ['@maria_petrenko','@olenashevchenko0711','@tarasbondar','@sofia_melnyk']; let n = 0;
      S.checklists = Array.from({length: 12}, (_, ci) => ({ id: 'clx' + ci, name: 'List ' + ci, pos: ci, checkItems: Array.from({length: 6}, (_, k) => {
        n++; return { id: ('it' + n).padStart(24, '0'), name: 'Task ' + n + ' ' + who[n % 4] + ' ' + who[(n + 1) % 4], state: 'incomplete', pos: k }; }) }));
      S.checklists[11].checkItems.forEach(i => i.state = 'complete'); }""")
    big.wait_for_selector(".cl")
    big.wait_for_timeout(600)
    hb = big.evaluate("Math.ceil(document.getElementById('root').getBoundingClientRect().height)")
    fl = big.evaluate("[...document.querySelectorAll('section.cl.folded')].map(s => s.getAttribute('data-cl'))")
    check(hb <= 1480 and len(fl) > 0 and "clx11" in fl and big.locator(".fold-hint").is_visible(),
          f"a big epic fits under 1500 px: {hb}px, folded {fl} (a finished checklist first), hint shown")
    big.locator("section.cl.folded .cl-name").first.click()
    big.wait_for_timeout(300)
    opened = fl[0] if fl[0] != "clx11" else fl[1]
    hb2 = big.evaluate("Math.ceil(document.getElementById('root').getBoundingClientRect().height)")
    check(hb2 <= 1480, f"opening a folded checklist folds another, still fits: {hb2}px")
    big.close()
    small = open_page("section.html", AS_MARIA)
    small.wait_for_selector(".cl")
    small.wait_for_timeout(400)
    check(small.locator("section.cl.folded").count() == 0 and not small.locator(".fold-hint").is_visible(), "a small epic: nothing folded")
    small.locator("section.cl .cl-name").first.click()
    small.wait_for_timeout(200)
    check(small.locator("section.cl.folded").count() == 1, "a click on a checklist's name folds it")
    small.close()

    one = open_page("section.html", ONE_CHECKLIST)
    one.wait_for_selector(".cl")
    check(one.locator(".all-btn").count() == 0, "an epic with one checklist has no '＋ All cards' (its own '＋ Cards' does the same)")
    one.close()

    check(not errors, f"no JS errors: {errors}")
    b.close()

srv.shutdown()
print("\nFAILED:" if fails else "\nALL PASSED", *fails, sep="\n  ")
sys.exit(1 if fails else 0)

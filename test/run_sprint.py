"""Sprints: "SPRINT 48" lists hold the epics, "TO DO SP48" columns hold their tasks — against a mocked Trello.
Run from the repo root:  python3 test/run_sprint.py
"""
import functools, http.server, json, pathlib, threading
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
# The board as the team has it: SPRINT 47 (current), SPRINT 48 (next), TO DO SP47 (the old "TO DO", renamed), IN PROGRESS, DONE.
# The epic is in SPRINT 48 unless a test moves it.
SPRINTS = """S => {
  S.me = { id: 'mem' + '1'.padStart(21, '0'), username: 'maria_petrenko', fullName: 'Maria Petrenko' };
  S.board.customFields = [{ id: 'f_sp', name: 'Story points', type: 'number' }];
  S.plugin.board.cfg.sp = { on: true, migrate: true, fieldId: 'f_sp' };
  S.lists = [{ id: 'L_s47', name: 'SPRINT 47', pos: 1000 }, { id: 'L_s48', name: 'SPRINT 48', pos: 2000 },
    { id: 'L_todo', name: 'TO DO SP47', pos: 3000 }, { id: 'L_prog', name: 'IN PROGRESS', pos: 4000 }, { id: 'L_done', name: 'DONE', pos: 5000 },
    { id: 'L_other', name: 'Ideas', pos: 6000 }];
  S.card.idList = 'L_s48';
}"""

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

    # ---------- an epic of the new sprint: its column is made when the first cards are added ----------
    pg = open_page("section.html", SPRINTS)
    pg.wait_for_selector(".my-btn")
    S = lambda: pg.evaluate("window.__state")
    check(pg.locator(".notice").count() == 0, "no 'choose the TO DO list' notice for a sprint epic")
    check(not any(l["name"] == "TO DO SP48" for l in S()["lists"]), "no TO DO SP48 column before any card is added")
    adds = pg.locator(".chip.add").all_inner_texts()
    check(adds and all(x.endswith("＋ TO DO") for x in adds), f"add chips say just ＋ TO DO: {adds[:2]}")
    pg.locator(".my-btn").first.click()
    pg.locator(".my-menu .my-row").first.locator("button", has_text="Checklist").click()
    pg.wait_for_function("document.querySelectorAll('.my-menu .my-ok').length === 1", timeout=10000)
    st = S()
    names = [l["name"] for l in sorted([l for l in st["lists"] if not l.get("closed")], key=lambda l: l["pos"])]
    col = [l for l in st["lists"] if l["name"] == "TO DO SP48"]
    check(len(col) == 1 and st.get("listsMade") == 1, f"one column TO DO SP48 made: {names}")
    check(names == ["SPRINT 47", "SPRINT 48", "TO DO SP47", "IN PROGRESS", "DONE", "TO DO SP48", "Ideas"],
          f"placed right of DONE: {names}")
    kid = [c for c in st["cards"].values() if c["name"].endswith(" / Spring merch 24.11")][0]
    check(kid["idList"] == col[0]["id"], "my checklist card went into TO DO SP48")
    chip = pg.locator(".chip.kid").first.inner_text()
    check("TO DO SP48" in chip, f"chip shows the column: {chip}")
    # a second person, separate cards: same column, no new one
    pg.locator(".my-menu .my-row:not(.job):not(.all)").first.locator("button", has_text="Each").click()
    pg.wait_for_function("document.querySelectorAll('.my-menu .my-ok').length === 2", timeout=10000)
    st = S()
    sep = [c for c in st["cards"].values() if c["name"].endswith("— Spring merch 24.11") and c["idList"] == col[0]["id"]]
    check(len(sep) >= 2 and st.get("listsMade") == 1, f"separate cards in the same column, no second one: {len(sep)} cards, {st.get('listsMade')} made")
    pg.keyboard.press("Escape")
    pg.click("button[data-action=refresh]")
    pg.wait_for_timeout(900)
    lc = [x.replace("\n", " ") for x in pg.locator(".chip.linked:not(.kid)").all_inner_texts()]
    check(sum("✓ TO DO SP48" in x for x in lc) >= 2 and not any(x.endswith("✓ TO DO ▾") for x in lc), f"separate cards' chips name the column after a reload: {lc}")
    # status from the epic: TO DO → In progress → back to TO DO goes to the card's own column
    pg.keyboard.press("Escape")
    pg.locator(".chip.kid").first.click()
    pg.wait_for_selector(".dd")
    opts = [x.replace("\n", "").replace("✓", "") for x in pg.locator(".dd .dd-item").all_inner_texts()]
    check(opts == ["TO DO SP48", "IN PROGRESS", "DONE"], f"status options name the sprint column: {opts}")
    pg.screenshot(path=str(OUT / "sprint-1-epic.png"), full_page=True)
    pg.keyboard.press("Escape")
    pg.close()

    # ---------- an epic of the current sprint: its tasks go to TO DO SP47 ----------
    pg = open_page("section.html", SPRINTS.replace("S.card.idList = 'L_s48';", "S.card.idList = 'L_s47';"))
    pg.wait_for_selector(".my-btn")
    pg.locator(".my-btn").first.click()
    pg.locator(".my-menu .my-row").first.locator("button", has_text="Checklist").click()
    pg.wait_for_function("document.querySelectorAll('.my-menu .my-ok').length === 1", timeout=10000)
    st = pg.evaluate("window.__state")
    kid = [c for c in st["cards"].values() if c["name"].endswith(" / Spring merch 24.11")][0]
    check(kid["idList"] == "L_todo" and not st.get("listsMade"), "epic in SPRINT 47: cards into TO DO SP47, no column made")
    pg.close()

    # ---------- two people at once: the older column is kept, the extra one archived ----------
    pg = open_page("section.html", SPRINTS)
    pg.wait_for_selector(".my-btn")
    # someone else makes TO DO SP48 just before our POST /lists lands
    pg.evaluate("""() => { const S = window.__state, f = window.fetch;
      window.fetch = (url, init) => { if (/\\/lists\\?/.test(url) && (init || {}).method === 'POST' && !S.raced) {
        S.raced = true; S.lists.push({ id: '000000000000000000list01', name: 'TO DO SP48', pos: 5500 }); }
        return f(url, init); }; }""")
    pg.locator(".my-btn").first.click()
    pg.locator(".my-menu .my-row").first.locator("button", has_text="Checklist").click()
    pg.wait_for_function("document.querySelectorAll('.my-menu .my-ok').length === 1", timeout=10000)
    st = pg.evaluate("window.__state")
    open_cols = [l for l in st["lists"] if l["name"] == "TO DO SP48" and not l.get("closed")]
    kid = [c for c in st["cards"].values() if c["name"].endswith(" / Spring merch 24.11")][0]
    check(st.get("raced") and len(open_cols) == 1 and open_cols[0]["id"] == "000000000000000000list01" and kid["idList"] == open_cols[0]["id"],
          f"made at the same time by two people: one column stays, the card is in it: {[(l['id'], l.get('closed')) for l in st['lists'] if l['name'] == 'TO DO SP48']}")
    pg.close()

    # ---------- a copied epic doesn't take over the original's cards ----------
    pg = open_page("section.html", SPRINTS.replace("S.card.idList = 'L_s48';", "S.card.idList = 'L_s48'; S.plugin.card.epic = 'card0000000000000original';"))
    pg.wait_for_selector(".my-btn")
    linked = pg.locator(".chip.linked, .chip.done").count()
    check(linked == 0, f"a copy of an epic: the original's cards are not shown as its own ({linked} linked chips)")
    pg.locator(".item").nth(5).locator(".chip.add").first.click()
    pg.wait_for_function("window.__state.plugin.card.epic === window.__state.card.id", timeout=5000)
    st = pg.evaluate("window.__state")
    check(len(st["plugin"]["card"]["links"]) == 1, f"after the first card, only the copy's own link is kept: {st['plugin']['card']['links']}")
    pg.close()

    # ---------- panel: counts the newest sprint's column, can switch to an older one ----------
    panel_patch = "S => { (" + SPRINTS + ")(S); S.lists.push({ id: 'L_t48', name: 'TO DO SP48', pos: 5500 }); S.cards = {}; " + \
        "const add = (sl, idList, v) => { S.cards[sl] = { id: 'card' + sl.padStart(20, '0'), shortLink: sl, name: sl, idList, idMembers: ['mem' + '1'.padStart(21, '0')], " + \
        "closed: false, pos: 1, customFieldItems: v == null ? [] : [{ idCustomField: 'f_sp', value: { number: String(v) } }] }; }; " + \
        "add('c47a', 'L_todo', 8); add('c47b', 'L_todo', 5); add('c48a', 'L_t48', 3); add('c48b', 'L_t48', null); }"
    bp = open_page("spbar.html", panel_patch)
    bp.wait_for_selector(".spbar-num")
    check(bp.inner_text(".spbar-pill") == "TO DO SP48" and "new" in bp.get_attribute(".spbar-pill", "class") and bp.inner_text(".spbar-num") == "3",
          f"newest sprint by default: {bp.inner_text('.spbar')}")
    check("нов" not in bp.inner_text(".spbar"), "just the column name, no extra word")
    bp.screenshot(path=str(OUT / "sprint-2-panel.png"))
    bp.click(".spbar-pill")
    items = bp.evaluate("window.__lastPopup.items.map(i => i.text)")
    check(bp.evaluate("window.__lastPopup.title") == "Sprint column" and len(items) == 2 and items[0].startswith("✓ TO DO SP48") and items[1].startswith("TO DO SP47"),
          f"menu of sprint columns, newest first: {items}")
    bp.evaluate("window.__lastPopup.items[1].callback(TrelloPowerUp.iframe())")
    bp.wait_for_function("document.querySelector('.spbar-pill') && document.querySelector('.spbar-pill').textContent.indexOf('SP47') !== -1", timeout=3000)
    check(bp.inner_text(".spbar-num") == "13" and "old" in bp.get_attribute(".spbar-pill", "class"), f"older sprint picked: {bp.inner_text('.spbar')}")
    bp.screenshot(path=str(OUT / "sprint-3-panel-old.png"))
    sp = bp.evaluate("window.__state.plugin.member.spList")
    check(sp == {"id": "L_todo", "newest": "L_t48"}, f"the pick is remembered with the newest column of the moment: {sp}")
    bp.evaluate("window.__state.lists.push({ id: 'L_t49', name: 'TO DO SP49', pos: 5800 }); window.__rerender()")
    bp.wait_for_function("document.querySelector('.spbar-pill').textContent.indexOf('SP49') !== -1", timeout=3000)
    check(True, "a newer sprint column appeared: the panel goes back to the newest")
    bp.close()

    # ---------- the card back of a card in a TO DO SP column ----------
    cp = open_page("index.html", SPRINTS)
    cp.wait_for_function("!!window.__caps")
    title = cp.evaluate("""async () => { const S = window.__state; S.lists.push({ id: 'L_t48', name: 'TO DO SP48', pos: 5500 });
      S.cards.K = { id: 'cardK'.padStart(24, '0'), shortLink: 'K', name: 'Plain task', idList: 'L_t48', idMembers: [], closed: false,
        checklists: [{ id: 'kK', name: 'C', checkItems: [{ id: 'kiK'.padStart(24, '0'), name: 'x', state: 'incomplete' }] }] };
      S.card = S.cards.K; await new Promise(r => setTimeout(r, 3100));
      const s = await window.__caps['card-back-section'](TrelloPowerUp.iframe()); return s && s.title; }""")
    check(title == "STORY POINTS", f"a card with a checklist in TO DO SP48 gets STORY POINTS: {title}")
    cp.close()

    real = [e for e in errors if "favicon" not in e]
    check(not real, f"no JS errors: {real}")
    b.close()

srv.shutdown()
print("\nFAILED:" if fails else "\nALL PASSED", *fails, sep="\n  ")

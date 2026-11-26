"""Story points UI test with a mocked Trello. Run from the repo root:  python3 test/run_sp.py"""
import functools, http.server, json, pathlib, sys, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
MOCK = (ROOT / "test" / "mock-powerup.js").read_text(encoding="utf-8")
OUT = ROOT / "test" / "out"
OUT.mkdir(exist_ok=True)

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=str(ROOT))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"

fails = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)

# A board with 5 people, the "Story points" field and TO DO cards (field values and leftover [n] titles).
BOARD = """S => {
  const mid = n => 'mem' + String(n).padStart(21, '0');
  S.me = { id: mid(0), username: 'oleg', fullName: 'Oleg Liubarets' };
  S.members = [S.me, { id: mid(1), username: 'anna', fullName: 'Anna Kovalenko' }, { id: mid(2), username: 'dmytro', fullName: 'Dmytro Voloshyn' },
               { id: mid(3), username: 'iryna', fullName: 'Iryna Rudenko' }, { id: mid(4), username: 'bohdan', fullName: 'Bohdan Savchuk' }];
  S.board.customFields = [{ id: 'f_sp', name: 'Story points', type: 'number' }];
  S.plugin.board.cfg.sp = { on: true, migrate: false };
  S.cards = {};
  const add = (sl, name, idList, ms, v) => {
    S.cards[sl] = { id: 'card' + sl.padStart(20, '0'), shortLink: sl, name, idList, idMembers: ms.map(mid), closed: false, pos: 1,
      customFieldItems: v == null ? [] : [{ idCustomField: 'f_sp', value: { number: String(v) } }] };
  };
  add('a1', 'Banner set', 'L_todo', [2], 8);
  add('a2', 'Store locator fix', 'L_todo', [2], 2);
  add('a3', '[0,5] Weekly report', 'L_todo', [2], null);
  add('a4', 'Promo email', 'L_todo', [0], 3);
  add('a5', 'Landing hero', 'L_todo', [0, 1], 5);
  add('a6', 'Sync notes', 'L_todo', [1], null);
  add('a7', 'Unassigned task', 'L_todo', [], 1.5);
  add('a8', 'Done thing', 'L_done', [2], 13);
  add('a9', 'Archived', 'L_todo', [2], 21);
  S.cards.a9.closed = true;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 304, "height": 700}, device_scale_factor=2)
    errors = []

    def open_page(path, patch=None):
        pg = ctx.new_page()
        pg.route("https://p.trellocdn.com/power-up.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
        # the bit of Trello's CSS that matters here: its blue frame on focused text inputs
        pg.route("https://p.trellocdn.com/power-up.min.css", lambda r: r.fulfill(body="input[type=text]:focus{border:1px solid #388bff;box-shadow:inset 0 0 0 1px #388bff;background:#fff}", content_type="text/css"))
        pg.on("pageerror", lambda e: errors.append(f"{path}: {e}"))
        pg.on("console", lambda m: errors.append(f"{path}: {m.text}") if m.type == "error" else None)
        if patch:
            pg.add_init_script("window.__mockPatch = " + patch)
        pg.goto(f"{BASE}/{path}")
        return pg

    # ---------- Σ popup: sum for one person ----------
    pg = open_page("storypoints.html", BOARD)
    pg.wait_for_selector(".sp-big")
    check(pg.inner_text(".sp-name") == "Choose a person", f"nobody picked yet: {pg.inner_text('.sp-name')}")
    check(pg.locator(".sp-hint-reload").count() == 0, "no reload hint before anything is changed")
    check(pg.inner_text(".sp-big") == "20" and pg.inner_text(".sp-cap") == "story points in TO DO · everyone",
          f"until then the whole TO DO list: {pg.inner_text('.sp-big')} / {pg.inner_text('.sp-cap')}")
    check(pg.inner_text(".sp-sub") == "Unestimated", f"subline: {pg.inner_text('.sp-sub')}")
    pg.screenshot(path=str(OUT / "sp-1-sum.png"), full_page=True)

    # picker
    pg.click(".sp-person")
    pg.wait_for_selector(".sp-row")
    check(pg.inner_text(".sp-total-text b") == "Total in TO DO", "total block title")
    check(pg.inner_text(".sp-total-num").strip() == "20", f"total counts every card once (8+2+0.5+3+5+1.5): {pg.inner_text('.sp-total-num')}")
    check(pg.inner_text(".sp-total-text span") == "Unestimated", f"total subline: {pg.inner_text('.sp-total-text span')}")
    names = pg.locator(".sp-row .sp-row-name").all_inner_texts()
    pills = [x.strip() for x in pg.locator(".sp-row .sp-pill").all_inner_texts()]
    rows = list(zip(names, pills))
    check(rows[0] == ("Me · Oleg Liubarets", "8"), f"first row is me with points: {rows[0]}")
    check(rows[1] == ("No members", "1.5"), f"second row is No members: {rows[1]}")
    check(len(rows) == 6, f"6 rows (me, no members, 4 people): {rows}")
    check(pg.locator(".sp-divider").count() == 1, "divider after Me / No members")
    check(pg.locator(".sp-row.on").count() == 0, "no checkbox ticked while nobody is picked")
    dm = pg.locator(".sp-row", has_text="Dmytro").inner_text().replace("\n", " ")
    check(dm.endswith("10.5"), f"Dmytro: 8 + 2 + [0,5] from a title not moved yet = 10.5 (Done and archived ignored): {dm}")
    check(pg.locator(".sp-row", has_text="Bohdan").locator(".sp-pill.zero").count() == 1, "zero points look muted")
    order = names[2:]
    check(order == ["Anna Kovalenko", "Bohdan Savchuk", "Dmytro Voloshyn", "Iryna Rudenko"], f"people sorted by name: {order}")
    pg.screenshot(path=str(OUT / "sp-2-picker.png"), full_page=True)

    pg.fill("#q", "dmy")
    rows = pg.locator(".sp-row").all_inner_texts()
    check(len(rows) == 1 and "Dmytro" in rows[0], f"search filters the list: {rows}")
    check(pg.evaluate("document.activeElement.id") == "q", "search keeps focus while typing")
    pg.fill("#q", "zzz")
    check("Nobody found" in pg.inner_text("#list"), "nothing found message")
    pg.fill("#q", "")
    pg.locator(".sp-row", has_text="Dmytro").click()
    pg.wait_for_selector(".sp-big")
    check(pg.inner_text(".sp-name") == "Dmytro Voloshyn" and pg.inner_text(".sp-big") == "10.5", f"picked Dmytro: {pg.inner_text('.sp-big')}")
    check(pg.inner_text(".sp-sub") == "All estimated", f"Dmytro subline: {pg.inner_text('.sp-sub')}")
    check(pg.locator(".sp-hint-reload").count() == 0, "no reload hint any more (the header shows only Σ)")
    st = pg.evaluate("window.__state")
    check(st["plugin"].get("member", {}).get("spPerson") == "mem" + "2".zfill(21), "choice remembered for next time")
    pg.click(".sp-person")
    check(pg.locator(".sp-row.on .sp-check.on").count() == 1 and "Dmytro" in pg.locator(".sp-row.on .sp-row-name").inner_text(),
          "checkbox on the left marks the picked person")
    pg.locator(".sp-row.on").click()
    pg.wait_for_selector(".sp-big")
    st = pg.evaluate("window.__state")
    check(pg.inner_text(".sp-name") == "Choose a person" and st["plugin"]["member"]["spPerson"] == "",
          "clicking the ticked person unpicks them")
    pg.click(".sp-person"); pg.locator(".sp-row", has_text="No members").click()
    pg.wait_for_selector(".sp-big")
    check(pg.inner_text(".sp-name") == "No members" and pg.inner_text(".sp-big") == "1.5", "No members shows unassigned cards")
    pg.close()

    pg = open_page("storypoints.html", BOARD[:-1] + " S.plugin.member = { spPerson: 'mem' + '6'.padStart(21, '0') }; }")
    pg.wait_for_selector(".sp-big")
    check(pg.inner_text(".sp-name") == "Choose a person", "a remembered person who left the board counts as nobody picked")
    pg.close()

    pg = open_page("storypoints.html", BOARD.replace("sp = { on: true, migrate: false }", "sp = { on: false }"))
    pg.wait_for_selector(".msg")
    check("turned off" in pg.inner_text(".msg"), "off on this board -> hint")
    pg.close()

    # ---------- card back badge popup ----------
    spedit_patch = BOARD[:-1] + """
  S.card = Object.assign({}, S.cards.a3);
  S.cards = Object.fromEntries(Object.entries(S.cards).filter(([k]) => k !== 'a3'));
  S.plugin.board.cfg.sp.migrate = true;
}"""
    pg = open_page("spedit.html", spedit_patch)
    pg.wait_for_selector(".sp-chip")
    chips = pg.locator(".sp-chip").all_inner_texts()
    check(chips == ["0.5", "1", "2", "3", "5", "8", "13", "21"], f"quick values: {chips}")
    check(pg.locator(".sp-chip.on").inner_text() == "0.5", "current value ([0,5] in the title) is highlighted")
    pg.screenshot(path=str(OUT / "sp-3-edit.png"), full_page=True)
    pg.locator(".sp-chip", has_text="5").last.click()
    pg.wait_for_function("window.__state.closed === 1")
    st = pg.evaluate("window.__state")
    put = [r for r in st["requests"] if r["path"].endswith("/customField/f_sp/item")]
    check(put and put[-1]["body"] == {"value": {"number": "5"}}, f"value written to the field as JSON: {put[-1]['body'] if put else None}")
    check(st["card"]["name"] == "Weekly report", f"leftover [n] removed from the title (moving is on): {st['card']['name']}")
    pg.close()

    pg = open_page("spedit.html", spedit_patch.replace("S.plugin.board.cfg.sp.migrate = true;", "S.plugin.board.cfg.sp.migrate = false;"))
    pg.wait_for_selector(".sp-clear")
    pg.click(".sp-clear")
    pg.wait_for_function("window.__state.closed === 1")
    st = pg.evaluate("window.__state")
    put = [r for r in st["requests"] if r["path"].endswith("/customField/f_sp/item")]
    check(put[-1]["body"] == {"value": ""}, "No estimate clears the field")
    check(st["card"]["name"] == "[0,5] Weekly report", "title untouched when moving is off")
    pg.close()

    # ---------- settings ----------
    no_field = BOARD.replace("S.board.customFields = [{ id: 'f_sp', name: 'Story points', type: 'number' }];", "S.board.customFields = [];") \
                    .replace("add('a1', 'Banner set'", "add('a1', '[8] Banner set'")
    pg = open_page("settings.html", no_field[:-1] + " S.staleBoard = true; }")
    pg.wait_for_selector("#sp-create")
    check(pg.is_checked("#sp-on") and not pg.is_checked("#sp-migrate"), "story points switches show the saved state")
    check(pg.is_disabled("#sp-migrate"), "moving [n] needs the field first")
    check(pg.inner_text("#sp-move") == "Move now: 2 cards with [n] or (n) in the title" and pg.is_disabled("#sp-move"), f"move button: {pg.inner_text('#sp-move')}")
    pg.screenshot(path=str(OUT / "sp-4-settings.png"), full_page=True)
    pg.click("#sp-create")
    pg.wait_for_selector(".sp-ok")
    st = pg.evaluate("window.__state")
    created = [r for r in st["requests"] if r["path"] == "/customFields"]
    check(created and created[0]["body"]["name"] == "Story points" and created[0]["body"]["type"] == "number"
          and created[0]["body"]["display_cardFront"] is False and created[0]["body"]["idModel"] == st["board"]["id"],
          f"field created on the board, hidden from the card front: {created[0]['body'] if created else None}")
    fid = st["restFields"][0]["id"]
    check(st["plugin"]["board"]["cfg"]["sp"]["fieldId"] == fid, "field id saved in settings")
    check(not st["board"]["customFields"], "Trello's in-browser copy doesn't know the field yet (like on the real board)")
    pg.wait_for_timeout(300)
    check(pg.locator(".sp-ok").count() == 1 and pg.locator("#sp-create").count() == 0, "after the re-render it still says the field exists (no second Create)")
    check(st["plugin"]["board"]["cfg"]["todoListId"] == "L_todo", "other settings kept")
    pg.wait_for_function("!document.getElementById('sp-move').disabled")
    pg.click("#sp-move")
    pg.wait_for_function("document.getElementById('sp-move-msg').textContent.indexOf('Moved') !== -1", timeout=5000)
    st = pg.evaluate("window.__state")
    names = sorted(c["name"] for c in st["cards"].values())
    check("Banner set" in names and "Weekly report" in names and not any("[" in n for n in names), f"[n] removed from titles: {names}")
    vals = {c["name"]: c["customFieldItems"] for c in st["cards"].values() if c["name"] in ("Banner set", "Weekly report")}
    check(vals["Banner set"][-1] == {"idCustomField": fid, "value": {"number": "8"}} and vals["Weekly report"][-1]["value"]["number"] == "0.5",
          f"values moved into the field: {vals}")
    check(pg.inner_text("#sp-move-msg") == "✓ Moved 2 cards", pg.inner_text("#sp-move-msg"))
    pg.check("#sp-migrate")
    pg.click("button[type=submit]")
    pg.wait_for_function("window.__state.plugin.board.cfg.sp.migrate === true")
    cfg = pg.evaluate("window.__state.plugin.board.cfg")
    check(cfg["sp"]["on"] and cfg["sp"]["migrate"] and cfg["sp"]["fieldId"] == fid and cfg["position"] == "top" and cfg["doneListIds"] == ["L_done"],
          f"saved: {cfg}")
    pg.close()

    # ---------- panel at the bottom of the board ----------
    bp = open_page("spbar.html", BOARD)
    bp.wait_for_selector(".spbar-num")
    check(bp.inner_text(".spbar-name") == "Choose a person" and bp.inner_text(".spbar-num") == "20"
          and bp.inner_text(".spbar-unit") == "points · everyone" and bp.locator(".spbar-sub").count() == 0
          and bp.inner_text(".spbar-est") == "Unestimated" and "warn" in bp.get_attribute(".spbar-est", "class"),
          f"panel, nobody picked: {bp.inner_text('.spbar')}")
    check(bp.inner_text(".spbar-pill") == "TO DO", "panel shows the list name")
    bp.click(".spbar-est")
    lm = bp.evaluate("({ url: window.__lastModal.url, title: window.__lastModal.title, h: window.__lastModal.height, cb: typeof window.__lastModal.callback })")
    check(lm == {"url": "./estimate.html", "title": "Estimate story points", "h": 680, "cb": "function"}, f"'1 unestimated' opens the big Estimate window: {lm}")
    bp.screenshot(path=str(OUT / "sp-5-panel.png"))
    bp.click(".spbar-person")
    lp = bp.evaluate("({ url: window.__lastPopup.url, mode: window.__lastPopup.args.mode, ev: !!window.__lastPopup.mouseEvent })")
    check(lp == {"url": "./storypoints.html", "mode": "pick", "ev": True}, f"click on the person opens Trello's popup with the list next to it: {lp}")

    # the list in "pick" mode, in the same browser as the panel
    pp = ctx.new_page()
    pp.route("https://p.trellocdn.com/power-up.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
    pp.route("https://p.trellocdn.com/power-up.min.css", lambda r: r.fulfill(body="input[type=text]:focus{border:1px solid #388bff;box-shadow:inset 0 0 0 1px #388bff;background:#fff}", content_type="text/css"))
    pp.add_init_script("window.__mockPatch = " + BOARD)
    pp.add_init_script("window.__args = { mode: 'pick' }")
    pp.goto(f"{BASE}/storypoints.html")
    pp.wait_for_selector(".sp-row")
    check(pp.locator(".sp-back").count() == 0 and pp.locator(".sp-total").count() == 1 and pp.evaluate("document.activeElement.id") == "q",
          "list opened from the panel: total on top, search focused, no Back")
    qs = pp.evaluate("(() => { const c = getComputedStyle(document.getElementById('q')); return [c.boxShadow, c.borderTopWidth, c.borderTopStyle]; })()")
    check(qs[0] == "none" and (qs[1] == "0px" or qs[2] == "none"), f"the focused search has no blue frame of its own: {qs}")
    pp.screenshot(path=str(OUT / "sp-6-panel-list.png"), full_page=True)
    pp.locator(".sp-row", has_text="Dmytro").click()
    pp.wait_for_function("window.__state.closed === 1")
    check(pp.evaluate("window.__state.plugin.member.spPerson") == "mem" + "2".zfill(21), "pick saved and the popup closed")
    pp.close()
    # the panel page has its own mock state: give it the same pick, as Trello would
    bp.evaluate("TrelloPowerUp.iframe().set('member', 'private', 'spPerson', 'mem' + '2'.padStart(21, '0'))")
    bp.wait_for_function("document.querySelector('.spbar-name') && document.querySelector('.spbar-name').textContent === 'Dmytro Voloshyn'", timeout=3000)
    check(bp.inner_text(".spbar-num") == "10.5" and bp.inner_text(".spbar-unit") == "points" and bp.locator(".spbar-sub").count() == 0
          and bp.inner_text(".spbar-est") == "All estimated" and "ok" in bp.get_attribute(".spbar-est", "class"),
          f"the panel switches to the picked person right away: {bp.inner_text('.spbar')}")
    # live: someone changes points on a card -> Trello reports a change -> the panel recounts
    bp.evaluate("""() => { const c = window.__state.cards.a1; c.customFieldItems = [{ idCustomField: 'f_sp', value: { number: '9' } }];
      TrelloPowerUp.iframe().set('board', 'shared', 'touch', Date.now()); }""")
    bp.wait_for_function("document.querySelector('.spbar-num').textContent === '11.5'", timeout=3000)
    check(True, "a change on the board updates the panel without reloading (8 -> 9 on a card: 10.5 -> 11.5)")
    bp.set_viewport_size({"width": 900, "height": 36})  # the real bar is 36px tall
    check(bp.evaluate("document.querySelector('.spbar').scrollHeight <= 36 && document.querySelector('.spbar-est').getBoundingClientRect().bottom <= 36"),
          "the panel row fits in a 36px bar")
    gaps = bp.evaluate("""() => ['.spbar-pill', '.spbar-person', '.spbar-est'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.top, 36 - r.bottom]; })""")
    check(all(abs(t - b) <= 0.5 for t, b in gaps), f"the row is centred: the same gap above and below each element {gaps}")
    bp.screenshot(path=str(OUT / "sp-7-panel-person.png"))
    bp.close()

    # ---------- "Estimate story points" window ----------
    ep = open_page("estimate.html", BOARD[:-1] + "; S.renderOnRest = true; S.plugin.board.cfg.sp.migrate = true; }")
    ep.set_viewport_size({"width": 800, "height": 680})
    ep.wait_for_selector(".est-row")
    names = lambda: ep.eval_on_selector_all(".est-title", "els => els.map(e => e.textContent)")
    check(ep.inner_text(".est-person > span:not(.sp-av)") == "Everyone · TO DO", f"nobody picked -> everyone: {ep.inner_text('.est-person')}")
    check(ep.inner_text(".est-tab.on").startswith("No estimate") and ep.inner_text(".est-tab.on .est-count") == "1",
          f"opens on 'No estimate' with the count: {ep.inner_text('.est-tabs')}")
    check(names() == ["Sync notes"] and ep.inner_text(".est-prog span") == "0 of 1 estimated", f"only the card without estimate: {names()}")
    check(ep.locator(".est-row .est-ms .sp-av").count() == 1, "with everyone shown, each row has the card's members")
    ep.screenshot(path=str(OUT / "sp-8-estimate.png"))
    ep.locator(".est-row", has_text="Sync notes").locator(".est-chip[data-v='5']").click()
    ep.wait_for_function("window.__state.requests.some(r => r.method === 'PUT' && /customField\\/f_sp\\/item$/.test(r.path))")
    req = ep.evaluate("window.__state.requests.filter(r => /customField/.test(r.path)).map(r => ({ path: r.path, body: r.body }))")
    check(len(req) == 1 and "card" + "a6".rjust(20, "0") in req[0]["path"] and req[0]["body"] == {"value": {"number": "5"}}, f"one click saves the value: {req}")
    ep.wait_for_function("document.querySelector('.est-prog span').textContent === '1 of 1 estimated'", timeout=3000)
    check(names() == ["Sync notes"] and ep.locator(".est-row .est-st svg").count() == 1 and ep.inner_text(".est-row .est-chip.on") == "5",
          "estimated card stays in the list with a ✓ and the value highlighted")
    check(ep.inner_text(".est-tab.on .est-count") == "0" and "warn" not in ep.get_attribute(".est-tab.on .est-count", "class"), "the 'No estimate' count drops to 0")
    ep.screenshot(path=str(OUT / "sp-9-estimate-saved.png"))
    ep.click("[data-tab=all]")
    check(names() == ["Banner set", "Store locator fix", "[0,5] Weekly report", "Promo email", "Landing hero", "Sync notes", "Unassigned task"],
          f"'All': every TO DO card in list order, no archived or other lists: {names()}")
    row3 = ep.locator(".est-row", has_text="Weekly report")
    check(row3.locator(".est-chip.on").inner_text() == "0.5", "a [n] left in the title counts as the value")
    row3.locator(".est-chip[data-v='2']").click()
    ep.wait_for_function("[...document.querySelectorAll('.est-title')].some(e => e.textContent === 'Weekly report')", timeout=3000)
    reqs = ep.evaluate("window.__state.requests.filter(r => r.method === 'PUT').map(r => r.path.split('/').slice(-3).join('/') + ' ' + JSON.stringify(r.body || r.q))")
    check(any("f_sp/item" in r and '"2"' in r for r in reqs) and any("Weekly report" in r for r in reqs),
          f"picking a value also takes [n] out of the title (move [n] is on): {reqs[-2:]}")
    ep.click(".est-title >> text=Banner set")
    check(ep.evaluate("window.__state.shown") == ["card" + "a1".rjust(20, "0")], "a click on the name opens the card")
    # person list inside the window
    ep.click(".est-person")
    check(ep.locator(".est-dd").count() == 1 and ep.evaluate("document.activeElement.id") == "q", "person list opens with the search focused")
    dd = ep.eval_on_selector_all(".est-dd .sp-row-name", "els => els.map(e => e.textContent)")
    check(dd[:3] == ["Everyone", "Me · Oleg Liubarets", "No members"] and "Dmytro Voloshyn" in dd, f"people: {dd}")
    ep.click("body", position={"x": 760, "y": 640})
    check(ep.locator(".est-dd").count() == 0, "a click outside closes the person list")
    ep.click(".est-person")
    ep.fill("#q", "dmy")
    check(ep.eval_on_selector_all(".est-dd .sp-row-name", "els => els.map(e => e.textContent)") == ["Dmytro Voloshyn"], "search in the person list")
    ep.locator(".est-dd .sp-row", has_text="Dmytro").click()
    check(ep.inner_text(".est-person > span:not(.sp-av)") == "Dmytro Voloshyn · TO DO" and ep.locator(".est-dd").count() == 0, "picked Dmytro")
    check(ep.evaluate("window.__state.plugin.member.spPerson") == "mem" + "2".zfill(21), "the pick is shared with the panel")
    check(ep.inner_text(".est-tab.on").startswith("All") and names() == ["Banner set", "Store locator fix", "Weekly report"]
          and ep.locator(".est-prog").count() == 0 and ep.locator(".est-ms").count() == 0,
          f"Dmytro has nothing unestimated -> opens on 'All', his cards only: {names()}")
    ep.screenshot(path=str(OUT / "sp-10-estimate-person.png"))
    ep.close()
    # not connected yet
    ep = open_page("estimate.html", BOARD[:-1] + "; S.noToken = true; }")
    ep.set_viewport_size({"width": 800, "height": 680})
    ep.wait_for_selector(".est-row")
    check(ep.locator(".est-banner").count() == 1 and ep.locator(".est-chip:disabled").count() == 8, "not connected: banner, buttons disabled")
    ep.click("[data-action=connect]")
    ep.wait_for_function("!document.querySelector('.est-banner')", timeout=3000)
    check(ep.evaluate("window.__state.authCount") == 1 and ep.locator(".est-chip:disabled").count() == 0, "Connect -> buttons work")
    ep.close()
    # Trello refuses the change
    ep = open_page("estimate.html", BOARD[:-1] + "; S.failField = true; }")
    ep.set_viewport_size({"width": 800, "height": 680})
    ep.wait_for_selector(".est-row")
    ep.locator(".est-chip[data-v='3']").first.click()
    ep.wait_for_selector(".est-rowerr")
    check(ep.locator(".est-st.err").count() == 1 and ep.locator(".est-chip.on").count() == 0 and "not available" in ep.inner_text(".est-rowerr"),
          f"error shown on the row, value not kept: {ep.inner_text('.est-rowerr')}")
    ep.close()

    # ---------- connector: board button, card badges, moving [n] ----------
    cp = open_page("index.html", BOARD[:-1] + "; S.plugin.board.cfg.sp.migrate = true; }")
    cp.wait_for_function("!!window.__caps")
    r = cp.evaluate("""async () => {
      const t = TrelloPowerUp.iframe(), S = window.__state, caps = window.__caps;
      const badge = async (c) => { S.card = c; return caps['card-badges'](t); };
      const out = {};
      const btn = await caps['board-buttons'](t);
      out.btn = btn.map(x => ({ text: x.text, icon: !!(x.icon.dark && x.icon.light) }));
      const before = (S.bars || []).length; btn[0].callback(t); out.btnOpens = (S.bars || []).slice(before);
      await new Promise(r => setTimeout(r, 50)); out.barPref = (S.plugin.member || {}).spBar;
      out.b1 = await badge(S.cards.a1);
      out.b6 = await badge(S.cards.a6);
      out.b8 = Object.assign({}, S.cards.a8); out.b8.customFieldItems = []; out.b8 = await badge(out.b8);
      out.b3 = await badge(S.cards.a3);
      await new Promise(r => setTimeout(r, 600));
      out.a3 = { name: S.cards.a3.name, items: S.cards.a3.customFieldItems };
      out.detail = (await caps['card-detail-badges'](t)).map(x => ({ title: x.title, text: x.text, color: x.color }));
      // round brackets: "(3)" counts and moves, "(v2)" is left alone
      S.cards.a6.name = 'Sync notes (v2) (3)';
      out.b6r = await badge(S.cards.a6);
      S.cards.a2.name = 'Store locator fix (24.11)';
      out.b2d = await badge(S.cards.a2);
      await new Promise(r => setTimeout(r, 600));
      out.a6 = { name: S.cards.a6.name, items: S.cards.a6.customFieldItems };
      out.a2 = S.cards.a2.name;
      return out;
    }""")
    check(r["btn"] == [{"text": "SP", "icon": True}] and r["btnOpens"] == ["./spbar.html"] and r["barPref"] is True,
          f"SP board button opens the panel at the bottom and remembers it is open: {r['btn']} {r['btnOpens']} {r['barPref']}")
    nb = cp.evaluate("""async () => {
      const t = TrelloPowerUp.iframe(), S = window.__state, caps = window.__caps;
      const plain = (await caps['board-buttons'](t))[0];
      S.plugin.member = { spPerson: 'mem' + '2'.padStart(21, '0') };
      const picked = (await caps['board-buttons'](t))[0];
      S.plugin.member = { spPerson: '' };
      const svg = await (await fetch(plain.icon.light)).text();
      return { light: plain.icon.light, dark: plain.icon.dark, same: picked.icon.light === plain.icon.light && picked.text === plain.text, text: picked.text, svg: svg };
    }""")
    check(nb["light"].endswith("/img/teamload-icon.svg") and nb["dark"] == nb["light"], f"header icon: the Teamload ⚡ icon, same on light and dark: {nb['light']}")
    check(nb["same"] and nb["text"] == "SP", f"header icon doesn't change with the picked person (numbers are in the panel): {nb['text']}")
    check('fill="#0C66E4"' in nb["svg"] and 'stroke="#FFFFFF"' in nb["svg"], "icon file: blue square, white ⚡")
    b1 = r["b1"][0]
    check(b1["text"] == "8" and b1["color"] == "blue" and b1["icon"].endswith("/img/bolt.svg"), f"card badge from the field: {r['b1']}")
    check(r["b6"][0]["text"] == "?" and r["b6"][0]["color"] == "yellow", f"TO DO card without estimate -> '?': {r['b6']}")
    check(r["b8"] == [], f"no badge outside TO DO without estimate: {r['b8']}")
    check(r["b3"][0]["text"] == "0.5", f"title [0,5] still counts before it is moved: {r['b3']}")
    check(r["a3"]["name"] == "Weekly report" and r["a3"]["items"] == [{"idCustomField": "f_sp", "value": {"number": "0.5"}}],
          f"[n] typed in a title is moved into the field by the connector: {r['a3']}")
    check(r["detail"] == [{"title": "Story points", "text": "0.5", "color": "blue"}], f"card back badge: {r['detail']}")
    check(r["b6r"][0]["text"] == "3" and r["a6"] == {"name": "Sync notes (v2)", "items": [{"idCustomField": "f_sp", "value": {"number": "3"}}]},
          f"(3) in a title counts and is moved into the field, (v2) stays: {r['b6r']} {r['a6']}")
    check(r["b2d"][0]["text"] == "2" and r["a2"] == "Store locator fix (24.11)", f"a date in round brackets is not touched: {r['b2d']} {r['a2']}")
    off = cp.evaluate("""async () => {
      const t = TrelloPowerUp.iframe(), S = window.__state, caps = window.__caps;
      S.plugin.board.cfg.sp.on = false; await new Promise(r => setTimeout(r, 3100));
      return { btn: await caps['board-buttons'](t), badge: await caps['card-badges'](t) };
    }""")
    check(off == {"btn": [], "badge": []}, f"switched off -> no button, no badges: {off}")
    cp.close()

    ap = open_page("index.html", BOARD[:-1] + "; S.plugin.member = { spBar: true }; }")
    ap.wait_for_function("!!window.__caps")
    auto = ap.evaluate("""async () => {
      const t = TrelloPowerUp.iframe(), caps = window.__caps;
      await caps['board-buttons'](t); await new Promise(r => setTimeout(r, 100));
      await caps['board-buttons'](t); await new Promise(r => setTimeout(r, 100));
      const bars = (window.__state.bars || []).slice();
      window.__lastBar.callback(t); await new Promise(r => setTimeout(r, 50));
      return { bars: bars, after: window.__state.plugin.member.spBar };
    }""")
    check(auto == {"bars": ["./spbar.html"], "after": False},
          f"panel left open -> opens by itself once when the board loads; closing it with × remembers that: {auto}")
    ap.close()
    np_ = open_page("index.html", BOARD)
    np_.wait_for_function("!!window.__caps")
    nobar = np_.evaluate("""async () => { await window.__caps['board-buttons'](TrelloPowerUp.iframe());
      await new Promise(r => setTimeout(r, 100)); return window.__state.bars || []; }""")
    check(nobar == [], f"panel never opened -> does not appear by itself: {nobar}")
    np_.close()

    real_errors = [e for e in errors if "favicon" not in e]
    check(not real_errors, f"no JS errors: {real_errors}")
    b.close()

srv.shutdown()
print("\nFAILED:" if fails else "\nALL PASSED", *fails, sep="\n  ")
sys.exit(1 if fails else 0)

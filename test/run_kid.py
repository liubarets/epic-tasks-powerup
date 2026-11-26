"""Checklist cards ("＋ My cards") and story points per checklist item, against a mocked Trello.
Run from the repo root:  python3 test/run_kid.py
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
# The person looking at the epic is maria_petrenko (mentioned in 5 items, one of them done).
AS_MARIA = """S => {
  S.me = { id: 'mem' + '1'.padStart(21, '0'), username: 'maria_petrenko', fullName: 'Maria Petrenko' };
  S.board.customFields = [{ id: 'f_sp', name: 'Story points', type: 'number' }];
  S.plugin.board.cfg.sp = { on: true, migrate: true, fieldId: 'f_sp' };
}"""

# A TO DO card with a checklist (made by hand), looked at from its own back.
TODO_CARD = """S => {
  S.board.customFields = [{ id: 'f_sp', name: 'Story points', type: 'number' }];
  S.plugin.board.cfg.sp = { on: true, migrate: true, fieldId: 'f_sp' };
  const it = (n, name, state) => ({ id: ('kitem' + n).padStart(24, '0'), name, state: state || 'incomplete', pos: n });
  S.cards.T1 = { id: 'cardT1'.padStart(24, '0'), shortLink: 'T1', name: 'Landing page', idList: 'L_todo', closed: false, pos: 1,
    idMembers: ['mem' + '1'.padStart(21, '0')], idLabels: [], badges: { attachments: 0 }, customFieldItems: [],
    checklists: [{ id: 'klT1', name: 'Tasks', pos: 1, checkItems: [it(1, 'Design'), it(2, 'Copy [2]'), it(3, 'Brief', 'complete')] }] };
  S.card = S.cards.T1;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 720, "height": 900}, device_scale_factor=2)
    errors = []

    def open_page(path, patch=None, args=None):
        pg = ctx.new_page()
        pg.route("https://p.trellocdn.com/power-up.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
        pg.route("https://p.trellocdn.com/power-up.min.css", lambda r: r.fulfill(body="", content_type="text/css"))
        pg.on("pageerror", lambda e: errors.append(f"{path}: {e}"))
        pg.on("console", lambda m: errors.append(f"{path}: {m.text}") if m.type == "error" else None)
        if patch:
            pg.add_init_script("window.__mockPatch = " + patch)
        if args:
            pg.add_init_script("window.__args = " + json.dumps(args))
        pg.goto(f"{BASE}/{path}")
        return pg

    # ---------- TASKS: "＋ My cards" ----------
    page = open_page("section.html", AS_MARIA)
    page.wait_for_selector(".cl")
    S = lambda: page.evaluate("window.__state")
    def refresh():
        page.click("button[data-action=refresh]")
        page.wait_for_timeout(700)
    btns = page.locator(".my-btn").all_inner_texts()
    check(btns == ["＋ Cards (6) ▾", "＋ Cards (4) ▾"], f"'Cards' counts all open items × people without a card: {btns}")
    page.locator(".my-btn").first.click()
    menu = page.locator(".my-menu").inner_text()
    names = page.locator(".my-menu .my-name").all_inner_texts()
    counts = page.locator(".my-menu .my-n").all_inner_texts()
    check(names[0] == "Me" and names[-1] == "Everyone" and len(names) == 5 and counts[0] == "2" and counts[-1] == "6",
          f"menu: a row per tagged person (me first) + Everyone: {names} {counts}")
    check("leralera" not in menu and "ninanina" not in menu, "people not tagged in this checklist are not listed")
    page.screenshot(path=str(OUT / "kid-1-menu.png"), full_page=True)
    page.locator(".my-row").first.locator("button", has_text="Checklist").click()
    page.wait_for_function("Object.values(window.__state.cards).some(c => c.name.indexOf(' / Spring merch') !== -1)")
    page.wait_for_selector(".chip.kid")
    page.wait_for_timeout(400)
    st = S()
    kid = [c for c in st["cards"].values() if c["name"].endswith(" / Spring merch 24.11")][0]
    kid_items = [i["name"] for i in kid["checklists"][0]["checkItems"]]
    check(kid["name"] == "PRODUCT LAUNCHES & UPDATES / Spring merch 24.11" and kid["idList"] == "L_todo" and kid["idMembers"] == [MARIA],
          f"one card 'Epic / Checklist' in TO DO for me: {kid['name']} {kid['idList']} {kid['idMembers']}")
    check(kid_items == ["Approve with legal", "Tranfser to IT"], f"only my open items, no @mentions: {kid_items}")
    check(kid["desc"].startswith("[PRODUCT LAUNCHES & UPDATES](https://trello.com/c/EPIC0001") and not kid.get("urlSource"),
          "the description links back to the epic; nothing is attached")
    check(st["plugin"].get(kid["id"], {}).get("kid") == st["card"]["id"], "the card is marked as a checklist card of this epic")
    groups = st["plugin"]["card"].get("groups", {})
    check(len(groups) == 1 and list(groups.values())[0]["s"] == kid["shortLink"] and len(list(groups.values())[0]["i"]) == 2,
          f"epic remembers the card and its 2 items: {groups}")
    chips = [page.locator(".item").nth(i).locator(".chip.kid").inner_text() for i in (0, 1)]
    check(all("☰ TO DO" in c for c in chips), f"chips say the items are in my checklist card: {chips}")
    check(page.locator(".my-btn").all_inner_texts() == ["＋ Cards (4) ▾", "＋ Cards (4) ▾"], "Spring: my 2 items have a card now (6 → 4)")
    others = [c for c in st["cards"].values() if c["name"].endswith("— Spring merch 24.11") and MARIA in c["idMembers"]]
    check(not others, "no separate cards for those items")

    # "A card for each item" in Retail
    page.locator(".my-btn").nth(1).click()
    page.locator(".my-row").first.locator("button", has_text="Each").click()
    page.wait_for_function("Object.values(window.__state.cards).filter(c => c.name.indexOf('— Retail SDK') !== -1).length === 3")
    page.wait_for_timeout(400)
    st = S()
    sep = sorted(c["name"] for c in st["cards"].values() if c["name"].endswith("— Retail SDK - 26.11"))
    check(sep == ["Check WEB&B2C — Retail SDK - 26.11", "Tranfser to IT — Retail SDK - 26.11", "🔴 Approve with legal — Retail SDK - 26.11"],
          f"3 separate cards for my Retail items: {sep}")
    check(page.locator(".my-btn").all_inner_texts() == ["＋ Cards (4) ▾", "＋ Cards (1) ▾"], "nothing left for me anywhere, others still pending")

    # a new item for me in Spring goes into my card by itself, "[3]" becomes its points there
    page.evaluate("""() => { const S = window.__state; S.checklists[0].checkItems.push({ id: ('ci' + 9001).padStart(24, '0'),
      name: 'New banner [3] @maria_petrenko', state: 'incomplete', pos: 999999, due: '2026-12-01T10:00:00.000Z', idMember: null }); }""")
    refresh()
    st = S()
    kid = [c for c in st["cards"].values() if c["id"] == kid["id"]][0]
    names = [i["name"] for i in kid["checklists"][0]["checkItems"]]
    newi = kid["checklists"][0]["checkItems"][-1]
    check(names == ["Approve with legal", "Tranfser to IT", "New banner"], f"new item appended to my card, points text removed: {names}")
    check(newi["due"] == "2026-12-01T10:00:00.000Z", "its due date came along")
    pts = st["plugin"].get(kid["id"], {}).get("pts", {})
    check(pts == {newi["id"][-8:]: 3}, f"'[3]' from the epic became the item's points in my card: {pts}")
    field = [x for x in kid.get("customFieldItems", []) if x["idCustomField"] == "f_sp"]
    check(field and field[0]["value"]["number"] == "3", f"card points = sum of open items: {field}")
    refresh()
    check(len(S()["cards"][kid["shortLink"]]["checklists"][0]["checkItems"]) == 3, "not appended twice")

    # priority set in the epic -> the item in my card gets the emoji
    page.locator(".item").nth(0).locator("select.prio").select_option("1")
    page.wait_for_function(f"window.__cardById('{kid['id']}').checklists[0].checkItems[0].name === '🔴 Approve with legal'")
    check(True, "priority copied into my checklist card")
    # the name may be corrected in the card: a later priority change only swaps the emoji, the rest stays
    page.evaluate(f"window.__cardById('{kid['id']}').checklists[0].checkItems[0].name = '🔴 Approve with legal (v2, edited)'")
    refresh()
    page.locator(".item").nth(0).locator("select.prio").select_option("2")
    page.wait_for_function(f"window.__cardById('{kid['id']}').checklists[0].checkItems[0].name === '🟠 Approve with legal (v2, edited)'", timeout=5000)
    check(True, "priority changed later: only the emoji changes in my card, the edited name stays")
    # a priority set in Trello itself (not through the select) reaches the card on the next open; names are not copied
    page.evaluate("window.__state.checklists[0].checkItems[1].name = '🟢 Transfer to IT @maria_petrenko'")
    refresh()
    check(page.evaluate(f"window.__cardById('{kid['id']}').checklists[0].checkItems[1].name") == "🟢 Tranfser to IT",
          "priority from the epic reaches the card on the next open; the card's own name stays")
    # the checklist's priority set after the card was made -> the card "Epic / Checklist" gets the emoji
    page.locator("select.cl-prio").first.select_option("1")
    page.wait_for_function(f"window.__cardById('{kid['id']}').name === 'PRODUCT LAUNCHES & UPDATES / 🔴 Spring merch 24.11'", timeout=5000)
    check(page.evaluate("window.__state.checklists[0].name") == "🔴 Spring merch 24.11", "checklist priority: epic checklist + my card name")
    page.wait_for_function(f"window.__cardById('{kid['id']}').checklists[0].name === '🔴 Spring merch 24.11'", timeout=5000)
    kd = page.evaluate(f"window.__cardById('{kid['id']}').desc")
    check(kd.startswith("[PRODUCT LAUNCHES & UPDATES](https://trello.com/c/EPIC0001") and kd.endswith(" / 🔴 Spring merch 24.11"),
          f"…and the checklist inside my card and the description line: {kd}")
    sep_names = [c["name"] for c in S()["cards"].values() if "— " in c["name"] and "Spring merch" in c["name"] and c["idList"] != "L_done"]
    check(sep_names and all("— 🔴 Spring merch 24.11" in n for n in sep_names), f"separate cards of this checklist: 'Item — 🔴 Checklist': {sep_names}")
    page.evaluate(f"window.__cardById('{kid['id']}').name = 'PRODUCT LAUNCHES & UPDATES / 🔴 Spring merch (renamed)'")
    refresh()
    page.locator("select.cl-prio").first.select_option("3")
    page.wait_for_function(f"window.__cardById('{kid['id']}').name === 'PRODUCT LAUNCHES & UPDATES / 🟢 Spring merch (renamed)'", timeout=5000)
    check(True, "checklist priority changed again: only the emoji in the renamed card changes")
    page.locator("select.cl-prio").first.select_option("0")
    page.wait_for_function(f"window.__cardById('{kid['id']}').name === 'PRODUCT LAUNCHES & UPDATES / Spring merch (renamed)' && window.__cardById('{kid['id']}').checklists[0].name === 'Spring merch 24.11'", timeout=5000)
    check(True, "priority removed in the epic: removed from my card's name and its checklist too")
    # changed in Trello itself (checklist renamed): reaches the cards on the next opening of the epic
    page.evaluate("window.__state.checklists[0].name = '🟠 Spring merch 24.11'")
    refresh()
    page.wait_for_function(f"window.__cardById('{kid['id']}').checklists[0].name === '🟠 Spring merch 24.11' && window.__cardById('{kid['id']}').desc.endsWith('/ 🟠 Spring merch 24.11')", timeout=5000)
    check(True, "checklist priority changed in Trello: card name, checklist and description follow on the next opening")
    page.evaluate("window.__state.checklists[0].name = 'Spring merch 24.11'")
    refresh()

    # ticks: in my card -> epic; untick in my card -> epic reopens
    k0 = kid["checklists"][0]["checkItems"][0]["id"]
    page.evaluate(f"window.__tickIn('{kid['id']}', '{k0}', 'complete')")
    refresh()
    check(S()["checklists"][0]["checkItems"][0]["state"] == "complete", "ticked in my card -> ticked in the epic")
    check("☰ DONE" in page.locator(".item").nth(0).locator(".chip").first.inner_text(), "chip shows the tick")
    page.evaluate(f"window.__tickIn('{kid['id']}', '{k0}', 'incomplete')")
    refresh()
    check(S()["checklists"][0]["checkItems"][0]["state"] == "incomplete", "unticked in my card -> epic item reopens")
    # ticked by hand in the epic -> my card follows; unticked by hand in the epic -> my card follows
    page.evaluate("window.__tick(0, 1, 'complete')")
    refresh()
    k1 = kid["checklists"][0]["checkItems"][1]["id"]
    check(page.evaluate(f"window.__cardById('{kid['id']}').checklists[0].checkItems[1].state") == "complete", "ticked in the epic -> ticked in my card")
    page.evaluate("window.__tick(0, 1, 'incomplete')")
    refresh()
    check(page.evaluate(f"window.__cardById('{kid['id']}').checklists[0].checkItems[1].state") == "incomplete", "unticked in the epic -> unticked in my card")
    check(S()["checklists"][0]["checkItems"][1]["state"] == "incomplete", "and the epic stays unticked (no ping-pong)")
    refresh()
    check(S()["checklists"][0]["checkItems"][1]["state"] == "incomplete", "still unticked after another open")
    # several people: the epic item closes only when everyone is done
    page.evaluate("""() => { const S = window.__state; S.checklists[0].checkItems[4].name += ' @maria_petrenko'; }""")
    refresh()
    check(page.evaluate(f"window.__cardById('{kid['id']}').checklists[0].checkItems.length") == 4,
          "I was added to an item: it went into my card by itself")
    k3 = page.evaluate(f"window.__cardById('{kid['id']}').checklists[0].checkItems[3].id")
    page.evaluate(f"window.__tickIn('{kid['id']}', '{k3}', 'complete')")
    refresh()
    check(S()["checklists"][0]["checkItems"][4]["state"] == "incomplete", "shared item: my tick alone does not close it in the epic")
    page.screenshot(path=str(OUT / "kid-2-epic.png"), full_page=True)

    # my card went to Done: a new item does not go there, "My cards" offers it again
    page.evaluate(f"""() => {{ window.__cardById('{kid['id']}').idList = 'L_done';
      window.__state.checklists[0].checkItems.push({{ id: ('ci' + 9002).padStart(24, '0'), name: 'Late item @maria_petrenko', state: 'incomplete', pos: 9999999 }}); }}""")
    refresh()
    check(page.evaluate(f"window.__cardById('{kid['id']}').checklists[0].checkItems.length") == 4, "card in Done: new items are not added to it")
    check(page.locator(".my-btn").first.inner_text() == "＋ Cards (5) ▾", "the new item is offered in 'Cards' again")
    real = [e for e in errors if "favicon" not in e]
    check(not real, f"no JS errors in the epic: {real}")
    page.close()

    # ---------- the section a card gets ----------
    cp = open_page("index.html", AS_MARIA)
    cp.wait_for_function("!!window.__caps")
    def section_for(js):
        # settings are cached by the connector for 3 s
        return cp.evaluate("async () => { const S = window.__state; " + js + "; await new Promise(r => setTimeout(r, 3100)); " +
                           "const s = await window.__caps['card-back-section'](TrelloPowerUp.iframe()); return s && s.title; }")
    check(section_for("") == "TASKS", "epic: TASKS")
    check(section_for("""S.cards.K = { id: 'cardK'.padStart(24, '0'), shortLink: 'K', name: 'E / C', idList: 'L_prog', idMembers: [], closed: false,
      checklists: [{ id: 'kK', name: 'C', checkItems: [{ id: 'kiK'.padStart(24, '0'), name: 'x', state: 'incomplete' }] }] };
      S.card = S.cards.K; S.plugin[S.card.id] = { kid: 'epic' }""") == "STORY POINTS", "a person's checklist card: STORY POINTS, not TASKS")
    check(section_for("S.plugin.board.cfg.sp.on = false") is None, "a person's checklist card with story points off: no section at all")
    check(section_for("S.plugin.board.cfg.sp.on = true; delete S.plugin[S.card.id]; S.card.idList = 'L_todo'") == "STORY POINTS", "any TO DO card with a checklist: STORY POINTS")
    check(section_for("S.card.idList = 'L_prog'") == "TASKS", "a card with a checklist outside TO DO, never estimated by items: TASKS")
    check(section_for("S.plugin[S.card.id] = { pts: { 'x': 1 } }") == "STORY POINTS", "outside TO DO but already estimated by items: STORY POINTS")
    check(section_for("delete S.plugin[S.card.id]; S.card.desc = '[Q4 launches](https://trello.com/c/AbC/1-epic) / C'") == "STORY POINTS",
          "a card made from an epic (description links to it), out of TO DO, not estimated, no 'kid' mark: STORY POINTS")
    cp.close()

    # ---------- STORY POINTS section on a TO DO card with a checklist ----------
    sp = open_page("cardpoints.html", TODO_CARD)
    sp.set_viewport_size({"width": 560, "height": 600})
    sp.wait_for_selector(".cp-item")
    CARD = "cardT1".rjust(24, "0")
    field = lambda: sp.evaluate("(window.__cardById('" + CARD + "').customFieldItems || []).filter(x => x.idCustomField === 'f_sp').map(x => x.value.number)[0] || null")
    sp.wait_for_function("window.__cardById('" + CARD + "').checklists[0].checkItems[1].name === 'Copy'")
    sp.wait_for_function("document.querySelector('.cp-sum') && document.querySelector('.cp-sum').textContent.indexOf('2') !== -1")
    check(sp.evaluate("window.__state.plugin['" + CARD + "'].pts") == {"00kitem2": 2}, "'[2]' typed into an item moved into the card's data")
    check(field() == "2", f"card points = sum of open items: {field()}")
    def choose(pg, row, cls, label):
        pg.locator(".cp-item", has_text=row).locator("button." + cls).click()
        pg.wait_for_selector(".dd")
        pg.evaluate("""(label) => [...document.querySelectorAll('.dd .dd-item')].find(b => b.textContent.replace('✓', '').trim() === label).click()""", label)
    check(sp.locator(".cp-item.done").count() == 1 and sp.locator(".cp-item.done .cp-st").inner_text().startswith("DONE"), "a ticked item shows DONE and does not count")
    sp.locator(".cp-item", has_text="Design").locator("button.cp-sp").click()
    btn, dd = sp.locator(".cp-item", has_text="Design").locator("button.cp-sp").bounding_box(), sp.locator(".dd").bounding_box()
    check(sp.locator(".dd .dd-title").inner_text() == "Story points" and sp.locator(".dd .dd-item").count() == 9 and dd["y"] >= btn["y"] + btn["height"] - 1,
          "points: a drop-down with 8 values + No estimate, opening down")
    sp.screenshot(path=str(OUT / "kid-3b-points-dropdown.png"), full_page=True)
    sp.keyboard.press("Escape")
    choose(sp, "Design", "cp-sp", "5")
    sp.wait_for_function("(window.__cardById('" + CARD + "').customFieldItems || []).some(x => x.value.number === '7')")
    check(field() == "7", "Design 5 + Copy 2 = 7")
    sp.screenshot(path=str(OUT / "kid-3-card-points.png"), full_page=True)
    choose(sp, "Design", "cp-sp", "No estimate")
    sp.wait_for_function("(window.__cardById('" + CARD + "').customFieldItems || []).some(x => x.value.number === '2')")
    check(True, "'No estimate' clears it: back to 2")
    choose(sp, "Design", "cp-sp", "3")
    sp.wait_for_function("(window.__cardById('" + CARD + "').customFieldItems || []).some(x => x.value.number === '5')")
    # status of an item in the card: In progress moves the card, DONE on the last open item moves it to Done
    choose(sp, "Design", "cp-st", "IN PROGRESS")
    sp.wait_for_function("window.__cardById('" + CARD + "').idList === 'L_prog'", timeout=5000)
    check(True, "status In progress on an item moves the card to In progress")
    sp.wait_for_timeout(300)
    check(sp.locator(".cp-item", has_text="Design").locator(".cp-st").inner_text().startswith("IN PROGRESS") and
          sp.locator(".cp-item", has_text="Copy").locator(".cp-st").inner_text().startswith("TO DO"),
          "only that item is IN PROGRESS, the other keeps TO DO")
    check(sp.evaluate("window.__state.plugin['" + CARD + "'].st") == {"00kitem1": 1}, "in-progress items are kept on the card ('st')")
    sp.evaluate("window.__tickIn('" + CARD + "', ('kitem2').padStart(24, '0'), 'complete'); window.__rerender()")
    sp.wait_for_function("(window.__cardById('" + CARD + "').customFieldItems || []).some(x => x.value.number === '3')")
    check(True, "an item ticked in the card: its points drop out of the card's points (5 -> 3)")
    sp.close()

    # ---------- connector: the field follows ticks while the card is closed ----------
    cp = open_page("index.html", TODO_CARD)
    cp.wait_for_function("!!window.__caps")
    r = cp.evaluate("""async () => {
      const S = window.__state, c = S.card;
      S.plugin[c.id] = { pts: { [c.checklists[0].checkItems[0].id.slice(-8)]: 8, [c.checklists[0].checkItems[1].id.slice(-8)]: 2 } };
      const badges = await window.__caps['card-badges'](TrelloPowerUp.iframe());
      await new Promise(r => setTimeout(r, 600));
      const det = await window.__caps['card-detail-badges'](TrelloPowerUp.iframe());
      det[0].callback(TrelloPowerUp.iframe());
      return { badge: badges[0].text, field: (c.customFieldItems || []).map(x => x.value.number)[0], detail: det[0].text, popup: window.__lastPopup.args };
    }""")
    check(r["badge"] == "10" and r["field"] == "10", f"badge and field = 8 + 2 without opening the card: {r}")
    check(r["detail"] == "10" and r["popup"] == {"items": 1}, f"card-back badge shows the sum and points to the items: {r}")
    cp.close()

    # ---------- Estimate window: a card with a checklist is a row per open item ----------
    ep = open_page("estimate.html", TODO_CARD[:-1] + """;
      S.cards.P1 = { id: 'cardP1'.padStart(24, '0'), shortLink: 'P1', name: 'Plain card', idList: 'L_todo', idMembers: ['mem' + '1'.padStart(21, '0')],
        closed: false, pos: 2, customFieldItems: [] }; }""")
    ep.set_viewport_size({"width": 800, "height": 680})
    ep.wait_for_selector(".est-row")
    rows = lambda: ep.eval_on_selector_all(".est-title", "els => els.map(e => e.childNodes[0].textContent)")
    check(rows() == ["Design", "Plain card"], f"'No estimate': the unestimated item and the plain card: {rows()}")
    ep.click(".est-tab[data-tab=all]")
    check(rows() == ["Design", "Copy [2]", "Plain card"], f"'All': open items of the checklist card, then the plain card: {rows()}")
    ep.click(".est-tab[data-tab=none]")
    check("Landing page" in ep.inner_text(".est-item small"), "an item row says which card it is on")
    ep.screenshot(path=str(OUT / "kid-4-estimate.png"))
    ep.locator(".est-row", has_text="Design").locator(".est-chip[data-v='3']").click()
    ep.wait_for_function("(window.__cardById('" + CARD + "').customFieldItems || []).some(x => x.value.number === '5')")
    st = ep.evaluate("window.__state")
    check(st["plugin"][CARD]["pts"] == {"00kitem1": 3}, f"item points saved on the card: {st['plugin'][CARD]['pts']}")
    check(True, "card points = Design 3 + Copy [2] = 5")
    ep.close()

    real = [e for e in errors if "favicon" not in e]
    check(not real, f"no JS errors: {real}")
    # ---------- a card with a checklist moved to Done: its items are done ----------
    dn = open_page("cardpoints.html", TODO_CARD.replace("idList: 'L_todo'", "idList: 'L_done'"))
    dn.wait_for_selector(".cp-item")
    dn.wait_for_function("window.__cardById('" + CARD + "').checklists[0].checkItems.every(i => i.state === 'complete')", timeout=5000)
    dn.wait_for_timeout(300)
    labels = dn.locator(".cp-st").all_inner_texts()
    check(all(x.startswith("DONE") for x in labels), f"card in Done: every item shows DONE and is ticked: {labels}")
    dn.close()

    # ---------- "＋ Cards" menu stays open, several jobs one after another, progress per row ----------
    mm = open_page("section.html", AS_MARIA)
    mm.wait_for_selector(".my-btn")
    mm.evaluate("window.__postDelay = 500")
    mm.locator(".my-btn").first.click()
    check(mm.locator(".my-menu .my-x").count() == 1, "the menu has a × to close it")
    mm.locator(".my-menu .my-row").first.locator("button", has_text="Checklist").click()
    mm.wait_for_selector(".my-menu .my-row.job")
    check(mm.locator(".my-menu").count() == 1, "the menu stays open after a click on ☰ Checklist")
    second = mm.locator(".my-menu .my-row:not(.job):not(.all)").first
    who2 = second.locator(".my-name").inner_text()
    second.locator("button", has_text="Each").click()
    mm.wait_for_function("document.querySelectorAll('.my-menu .my-row.job').length === 2")
    mm.wait_for_selector(".my-menu .my-prog", state="attached")
    mm.screenshot(path=str(OUT / "kid-8b-menu-progress.png"), full_page=True)
    jt = mm.locator(".my-menu .my-row.job").all_inner_texts()
    check(len(jt) == 2 and ("Waiting" in jt[1] or "/" in jt[1] or "✓" in jt[1]), f"two jobs, one after another, with a progress bar: {jt}")
    check(mm.locator(".my-btn").first.inner_text().startswith("Creating"), "the button shows the cards are being made")
    mm.wait_for_function("document.querySelectorAll('.my-menu .my-ok').length === 2", timeout=20000)
    ok = mm.locator(".my-menu .my-ok").all_inner_texts()
    check(mm.locator(".my-menu").count() == 1 and len(ok) == 2, f"both done, the menu is still open: {ok}")
    st = mm.evaluate("window.__state")
    check(any(c["name"].endswith(" / Spring merch 24.11") and MARIA in c["idMembers"] for c in st["cards"].values()), "my checklist card is there")
    check(sum(1 for c in st["cards"].values() if c["name"].endswith("— Spring merch 24.11") and len(c["idMembers"]) == 1 and c["idMembers"][0] != MARIA) >= 2,
          f"separate cards for {who2}")
    mm.locator(".my-menu .my-x").click()
    check(mm.locator(".my-menu").count() == 0, "× closes the menu")
    mm.locator(".my-btn").first.click()
    mm.mouse.click(700, 880)
    check(mm.locator(".my-menu").count() == 0, "a click outside closes the menu")
    mm.close()

    # ---------- "＋ Cards" for other people: Everyone → one checklist card per person ----------
    ev = open_page("section.html", AS_MARIA)
    ev.wait_for_selector(".my-btn")
    ev.locator(".my-btn").first.click()
    ev.locator(".my-row.all button", has_text="Checklist").click()
    ev.wait_for_function("Object.values(window.__state.cards).filter(c => c.name.endsWith(' / Spring merch 24.11')).length === 4", timeout=15000)
    ev.wait_for_timeout(500)
    st = ev.evaluate("window.__state")
    kids = [c for c in st["cards"].values() if c["name"].endswith(" / Spring merch 24.11")]
    per = sorted((len(c["idMembers"]), len(c["checklists"][0]["checkItems"])) for c in kids)
    check(per == [(1, 1), (1, 1), (1, 2), (1, 2)], f"Everyone: a card per tagged person with only their items: {per}")
    check(ev.locator(".my-btn").all_inner_texts() == ["＋ Cards", "＋ Cards (4) ▾"] and ev.locator(".my-btn").first.is_disabled(), f"Spring has nothing left: grey, inactive button: {ev.locator('.my-btn').all_inner_texts()}")
    ev.screenshot(path=str(OUT / "kid-9-everyone.png"), full_page=True)
    two = [c for c in kids if len(c["checklists"][0]["checkItems"]) == 2 and MARIA not in c["idMembers"]][0]
    ev.evaluate(f"window.__cardById('{two['id']}').idList = 'L_done'")
    ev.click("button[data-action=refresh]")
    ev.wait_for_function(f"window.__cardById('{two['id']}').checklists[0].checkItems.every(i => i.state === 'complete')", timeout=5000)
    check(True, "a checklist card moved to Done by hand: its items are ticked when the epic is opened")
    ev.wait_for_timeout(500)
    who = [m for m in two["idMembers"]][0]
    done_chips = ev.evaluate("(m) => [...document.querySelectorAll('.chip.kid[data-member=\"' + m + '\"]')].map(b => b.textContent)", who)
    check(done_chips and all("DONE" in x for x in done_chips), f"its chips in the epic say DONE: {done_chips}")
    ev.close()

    # ---------- no duplicate items when the epic's records lag behind (Trello reads right after a write) ----------
    dp = open_page("section.html", AS_MARIA)
    dp.wait_for_selector(".my-btn")
    dp.locator(".my-btn").first.click()
    dp.locator(".my-row").first.locator("button", has_text="Checklist").click()
    dp.wait_for_function("Object.values(window.__state.cards).some(c => c.name.endsWith(' / Spring merch 24.11') && (c.checklists || [])[0] && c.checklists[0].checkItems.length === 2)", timeout=10000)
    dp.wait_for_timeout(800)
    # the epic "forgets" which items went into the card, as a stale read would show it; then the epic is opened again
    dp.evaluate("() => { const g = window.__state.plugin.card.groups; Object.values(g).forEach(x => { x.i = {}; }); }")
    dp.click("button[data-action=refresh]")
    dp.wait_for_timeout(1500)
    kc = [c for c in dp.evaluate("window.__state")["cards"].values() if c["name"].endswith(" / Spring merch 24.11")]
    n_items = [len(c["checklists"][0]["checkItems"]) for c in kc]
    check(n_items == [2], f"items already in the card are linked again, not added twice: {n_items}")
    dp.close()

    # ---------- status from the epic for items in a checklist card ----------
    sp2 = open_page("section.html", AS_MARIA)
    sp2.wait_for_selector(".my-btn")
    sp2.locator(".my-btn").first.click()
    sp2.locator(".my-row").first.locator("button", has_text="Checklist").click()
    sp2.wait_for_selector(".chip.kid")
    sp2.wait_for_timeout(600)
    kidc = lambda: [c for c in sp2.evaluate("window.__state")["cards"].values() if c["name"].endswith(" / Spring merch 24.11")][0]
    def pick(locator, label):
        locator.click()
        sp2.wait_for_selector(".dd")
        sp2.evaluate("""(label) => [...document.querySelectorAll('.dd .dd-item')].find(b => b.textContent.replace('✓', '').trim() === label).click()""", label)
    sp2.locator(".chip.kid").first.click()
    sp2.wait_for_selector(".dd")
    check(sp2.locator(".dd .dd-item").all_inner_texts() == ["✓TO DO", "IN PROGRESS", "DONE"] or
          [x.replace("\n", "") for x in sp2.locator(".dd .dd-item").all_inner_texts()] == ["✓TO DO", "IN PROGRESS", "DONE"],
          f"chip opens a drop-down: TO DO / IN PROGRESS / DONE, no @name and no 'Open card': {sp2.locator('.dd .dd-item').all_inner_texts()}")
    sp2.keyboard.press("Escape")
    pick(sp2.locator(".chip.kid").first, "IN PROGRESS")
    sp2.wait_for_function("Object.values(window.__state.cards).some(c => c.name.endsWith(' / Spring merch 24.11') && c.idList === 'L_prog')", timeout=5000)
    check(kidc()["idList"] == "L_prog", "one item → In progress from the epic moves the whole checklist card to In progress")
    sp2.wait_for_timeout(600)
    chips2 = [sp2.locator(".chip.kid").nth(i).inner_text() for i in (0, 1)]
    check("IN PROGRESS" in chips2[0].upper() and "TO DO" in chips2[1], f"the other item keeps its status (TO DO): {chips2}")
    sp2.wait_for_timeout(600)
    pick(sp2.locator(".chip.kid").first, "DONE")
    sp2.wait_for_timeout(1200)
    k = kidc()
    check(k["idList"] == "L_prog" and [i["state"] for i in k["checklists"][0]["checkItems"]].count("complete") == 1, "one of two items DONE: ticked, card stays")
    pick(sp2.locator(".chip.kid").nth(1), "DONE")
    sp2.wait_for_function("Object.values(window.__state.cards).some(c => c.name.endsWith(' / Spring merch 24.11') && c.idList === 'L_done')", timeout=5000)
    check(kidc()["idList"] == "L_done", "all of the person's items DONE from the epic: the card moves to Done")
    sp2.close()

    b.close()

srv.shutdown()
print("\nFAILED:" if fails else "\nALL PASSED", *fails, sep="\n  ")
sys.exit(1 if fails else 0)

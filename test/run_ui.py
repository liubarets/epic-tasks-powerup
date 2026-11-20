"""UI smoke test: loads section.html with a mocked Trello and exercises the main flows.
Run from the repo root:  python3 test/run_ui.py
"""
import functools, http.server, json, pathlib, sys, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
MOCK = (ROOT / "test" / "mock-powerup.js").read_text(encoding="utf-8")
OUT = ROOT / "test" / "out"
OUT.mkdir(exist_ok=True)

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
handler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"

fails = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 720, "height": 900}, device_scale_factor=2)
    page.route("https://p.trellocdn.com/power-up.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
    page.route("https://p.trellocdn.com/power-up.min.css", lambda r: r.fulfill(body="", content_type="text/css"))
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(f"{BASE}/section.html")
    page.wait_for_selector(".cl")
    S = lambda: page.evaluate("window.__state")

    check(page.locator(".item").count() == 10, "renders all 10 checklist items")
    check(page.locator(".chip.unknown").count() == 1, "unknown @former_employee shown as non-member chip")
    check(page.locator(".item input[type=checkbox]").count() == 0, "no per-item checkboxes in the section")
    body = page.inner_text("body")
    check("＋ TO DO" in body and "＋ TODO" not in body, "chip label is '＋ TO DO'")
    check("✓ DONE" in body and "✔" not in body, "done chip says '✓ DONE' (same check mark as other statuses)")
    check(not any(ch in body for ch in "абвгдежзиклмнопрстуфхцчшщьюяіїє"), "UI text is English only")
    check("✓ In progress" in page.inner_text("body"), "linked card status shows its list name")
    st = S()
    spring_last = st["checklists"][0]["checkItems"][5]
    check(spring_last["state"] == "complete", "auto-complete ticked item whose only TODO card is in Done")
    page.screenshot(path=str(OUT / "1-initial.png"), full_page=True)

    # 1) add "Approve with legal" (Spring) to Maria's TODO
    first = page.locator(".item").nth(0)
    first.locator("button.chip.add").first.click()
    page.wait_for_function("Object.values(window.__state.cards).length === 3")
    page.wait_for_selector(".item >> nth=0 >> .chip.linked")
    st = S()
    new = [c for c in st["cards"].values() if c["idList"] == "L_todo"][0]
    check(new["name"] == "Approve with legal — Spring merch 24.11", f"TODO card name: {new['name']}")
    check(new["idMembers"] == ["mem" + "1".zfill(21)], "TODO card assigned to maria")
    check(st["checklists"][0]["checkItems"][0]["name"] == "Approve with legal @maria_petrenko", "epic item untouched (stays in checklist)")
    check(new.get("urlSource") == st["card"]["url"] and not any(r["path"].endswith("/attachments") for r in st["requests"]),
          "epic link attached in the same request as the card (no extra call)")
    check(all("fields=" in r for r in st.get("batchRoutes", [])[:2]), f"linked cards fetched with only the needed fields: {st.get('batchRoutes', [])[:1]}")
    check(new["desc"] == "[PRODUCT LAUNCHES & UPDATES](https://trello.com/c/EPIC0001/1-product-launches) / Spring merch 24.11", f"TODO card desc: {new['desc']}")
    check(new["idLabels"] == [], "TODO card has no labels")

    # 2) set P1 on that item -> item renamed, linked TODO card gets the emoji (no labels)
    page.locator(".item").nth(0).locator("select.prio").select_option("1")
    page.wait_for_function("window.__state.checklists[0].checkItems[0].name.startsWith('🔴')")
    page.wait_for_timeout(300)
    st = S()
    new = [c for c in st["cards"].values() if c["idList"] == "L_todo"][0]
    check(len(st["board"]["labels"]) == 1, "no priority labels created on the board")
    check(new["name"].startswith("🔴 ") and new["idLabels"] == [], "linked TODO card synced to P1 by emoji only")
    # someone edited the TO DO card title: the emoji is replaced where it stands
    page.evaluate("Object.values(window.__state.cards).find(c => c.idList === 'L_todo').name = '[5] 🔴 Approve with legal — Spring merch 24.11'")
    page.click("button[data-action=refresh]")
    page.wait_for_timeout(500)
    page.locator(".item").nth(0).locator("select.prio").select_option("3")
    page.wait_for_function("window.__state.checklists[0].checkItems[0].name.startsWith('🟢')")
    page.wait_for_timeout(300)
    renamed = [c for c in S()["cards"].values() if c["idList"] == "L_todo"][0]["name"]
    check(renamed == "[5] 🟢 Approve with legal — Spring merch 24.11", f"emoji replaced in place in an edited title: {renamed}")
    page.locator(".item").nth(0).locator("select.prio").select_option("1")
    page.wait_for_function("window.__state.checklists[0].checkItems[0].name.startsWith('🔴')")
    page.wait_for_timeout(300)

    # 3) "Assign to me" on an item where I'm not assigned
    page.locator(".item").nth(1).locator("button.chip.ghost").click()
    page.wait_for_function("Object.values(window.__state.cards).length === 4")
    st = S()
    mine = [c for c in st["cards"].values() if "mem00000000000000000000me" in c["idMembers"]]
    check(len(mine) == 1, "'take it myself' creates a card for me")
    page.wait_for_timeout(300)
    check(page.locator(".item").nth(1).locator(".chip.me.linked").count() == 1 and page.locator(".item").nth(1).locator(".chip.ghost").count() == 0, "my chip replaces the take-it button")

    # 4) sort Retail checklist by priority
    page.locator("button[data-action=sort]").nth(1).click()
    page.wait_for_function("window.__state.checklists[1].checkItems[0].name.startsWith('🔴')", timeout=5000)
    page.wait_for_timeout(300)
    st = S()
    retail_names = [i["name"] for i in st["checklists"][1]["checkItems"]]
    check(retail_names[0].startswith("🔴 Approve"), f"sort puts P1 first: {retail_names[0]}")

    # 4b) "Add all" moved to the TASKS header (connector), nothing per checklist
    check(page.locator("button[data-action=addall]").count() == 0, "no per-checklist 'Add all' buttons in the section")

    # 4c) person removed from their TO DO card -> back to "+ TO DO"; taker removed -> chip gone
    page.evaluate("""() => {
      const cards = Object.values(window.__state.cards);
      cards.find(c => c.name.startsWith('🔴 Video for educational zones')).idMembers = [];
      cards.find(c => c.idMembers.includes('mem00000000000000000000me')).idMembers = [];
    }""")
    page.click("button[data-action=refresh]")
    page.wait_for_timeout(600)
    edu = page.locator(".item").nth(3)
    check(edu.locator(".chip.linked").count() == 0 and edu.locator(".chip.add").count() == 2, "removed from card -> chip is '+ TO DO' again")
    took = page.locator(".item").nth(1)
    check(took.locator(".chip.me").count() == 0 and took.locator(".chip.ghost").count() == 1, "taker removed from card -> 'Assign to me' is back")

    # 4d) card moved out of Done -> epic item reopens; manual ticks are respected; back to Done -> ticked again
    def refresh_until(js):
        page.click("button[data-action=refresh]")
        page.wait_for_function(js)
        page.wait_for_timeout(400)
    page.evaluate("""() => {
      window.__move('Spring merch - speeches', 'L_prog');
      window.__tick(0, 0, 'complete');   // ticked by hand while its card is still in TO DO (never was in Done)
    }""")
    refresh_until("window.__state.checklists[0].checkItems[5].state === 'incomplete'")
    st = S()
    check(st["checklists"][0]["checkItems"][5]["state"] == "incomplete", "card moved Done -> In progress: epic item unticked")
    calls_before = st.get("epicHistoryCalls", 0)
    check(page.locator(".item").nth(5).get_attribute("class") == "item" and "✓ In progress" in page.locator(".item").nth(5).inner_text(),
          "reopened item is no longer struck through and shows the card's list")
    check(st["checklists"][0]["checkItems"][0]["state"] == "complete", "item ticked by hand while its card is open stays ticked")
    page.evaluate("window.__tick(0, 5, 'complete')")
    page.click("button[data-action=refresh]")
    page.wait_for_timeout(800)
    check(S()["checklists"][0]["checkItems"][5]["state"] == "complete", "ticked again by hand after the card left Done: stays ticked")
    page.evaluate("window.__state.epicHistoryCalls = 0")
    page.click("button[data-action=refresh]")
    page.wait_for_timeout(800)
    # item 0 is ticked by hand with its card in TO DO (never in Done) and item 5 was re-ticked after its card left Done:
    # only item 5's card ever left Done, so the epic history is fetched (since that move) and nothing is unticked
    st = S()
    check(st["checklists"][0]["checkItems"][0]["state"] == "complete" and st["checklists"][0]["checkItems"][5]["state"] == "complete",
          "manual ticks survive repeated refreshes")
    page.evaluate("window.__move('Spring merch - speeches', 'L_done'); window.__move('Spring merch - speeches', 'L_prog')")
    refresh_until("window.__state.checklists[0].checkItems[5].state === 'incomplete'")
    check(True, "card went to Done and out again later: item reopened again")
    page.evaluate("window.__move('Spring merch - speeches', 'L_done')")
    refresh_until("window.__state.checklists[0].checkItems[5].state === 'complete'")
    check(True, "card back in Done: epic item ticked again")

    # 4e) TO DO list wrongly ticked as a "Done" list in old settings -> still not done
    page.evaluate("window.__state.plugin.board.cfg.doneListIds = ['L_done', 'L_todo']")
    page.click("button[data-action=refresh]")
    page.wait_for_timeout(600)
    first_chip = page.locator(".item").nth(0).locator(".chip").first.inner_text()
    check("✓ TO DO" in first_chip and "DONE" not in first_chip, f"card in TO DO is not done even if TO DO is listed as Done: {first_chip}")
    page.evaluate("window.__state.plugin.board.cfg.doneListIds = ['L_done']")

    # 5) filters
    page.check("input[data-action=hideDone]")
    check(page.locator(".item.done").count() == 0, "hide-done filter")
    page.uncheck("input[data-action=hideDone]")
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "2-after-actions.png"), full_page=True)

    # 6) open linked card
    page.locator(".chip.linked").first.click()
    check(len(S()["shown"]) == 1, "clicking a linked chip opens the card")

    real_errors = [e for e in errors if "favicon" not in e]
    check(not real_errors, f"no JS errors: {real_errors}")

    # settings popup renders
    sp = b.new_page(viewport={"width": 320, "height": 520}, device_scale_factor=2)
    sp.route("https://p.trellocdn.com/power-up.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
    sp.route("https://p.trellocdn.com/power-up.min.css", lambda r: r.fulfill(body="", content_type="text/css"))
    sp.goto(f"{BASE}/settings.html")
    sp.wait_for_selector("#todo option[selected]", state="attached")
    check(sp.eval_on_selector("#todo", "e => e.options[e.selectedIndex].text") == "TO DO", "settings preselects TO DO")
    done_state = sp.evaluate("[...document.querySelectorAll('input[name=done]')].map(i => [i.value, i.checked, i.disabled])")
    check(["L_todo", False, True] in done_state and ["L_done", True, False] in done_state, f"TO DO is greyed out under Done lists: {done_state}")
    sp.select_option("#todo", "L_prog")
    done_state = sp.evaluate("[...document.querySelectorAll('input[name=done]')].map(i => [i.value, i.checked, i.disabled])")
    check(["L_prog", False, True] in done_state and ["L_todo", False, False] in done_state, f"greyed-out list follows the TO DO choice: {done_state}")
    sp.select_option("#todo", "L_todo")
    sp.screenshot(path=str(OUT / "3-settings.png"))

    # connector registers capabilities
    ctx = b.new_context(viewport={"width": 304, "height": 400}, device_scale_factor=2)
    cp = ctx.new_page()
    cp.route("https://p.trellocdn.com/power-up.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
    cp.goto(f"{BASE}/index.html")
    caps = cp.evaluate("Object.keys(window.__caps || {})")
    check(set(caps) == {"card-back-section", "show-settings", "authorization-status", "show-authorization", "board-buttons", "card-badges", "card-detail-badges"}, f"capabilities: {caps}")

    # "＋ Add all to TO DO" header action opens the menu popup right away (no awaiting data first)
    r = cp.evaluate("""() => {
      const t = TrelloPowerUp.iframe();
      return window.__caps['card-back-section'](t).then(sec => {
        const before = window.__state.popups.length;
        sec.action.callback(t);                          // synchronous: the popup call must happen in the click
        return { title: sec.title, text: sec.action.text, opened: window.__state.popups.slice(before) };
      });
    }""")
    check(r["title"] == "TASKS" and r["text"] == "＋ Add all to TO DO", f"header: {r['title']} / {r['text']}")
    check(r["opened"] == ["./addall.html"], f"button opens the menu popup immediately: {r['opened']}")

    def open_menu(patch=None, token=None):
        mp = ctx.new_page()
        mp.route("https://p.trellocdn.com/power-up.min.js", lambda rr: rr.fulfill(body=MOCK, content_type="application/javascript"))
        mp.route("https://p.trellocdn.com/power-up.min.css", lambda rr: rr.fulfill(body="", content_type="text/css"))
        if patch:
            mp.add_init_script("window.__mockPatch = " + patch)
        if token:
            mp.add_init_script("window.__args = " + json.dumps({"token": token}))
        mp.goto(f"{BASE}/addall.html")
        mp.wait_for_selector(".menu, .msg:not(.muted)")
        return mp

    mp = open_menu()
    menu = [x.strip() for x in mp.locator(".menu button").all_inner_texts()]
    check(menu == ["All tasks (10)", "Spring merch 24.11 (6)", "Retail SDK - 26.11 (4)"], f"menu: {menu}")
    mp.screenshot(path=str(OUT / "4-add-menu.png"))
    mp.locator(".menu button", has_text="Retail SDK").click()
    mp.wait_for_function("window.__state.closed === 1")
    st = mp.evaluate("window.__state")
    created = [x["q"]["name"] for x in st["requests"] if x["method"] == "POST" and x["path"] == "/cards"]
    retail_open = [i["name"].split(" @")[0] for i in st["checklists"][1]["checkItems"] if i["state"] != "complete"]
    todo_order = [c["name"] for c in sorted([c for c in st["cards"].values() if c["idList"] == "L_todo"], key=lambda c: c["pos"])]
    check([n.split(" — ")[0] for n in todo_order] == retail_open and len(created) == 4,
          f"Retail: 4 cards created in parallel, TO DO list keeps the checklist order: {todo_order}")
    check(st["alerts"] == ["✓ Created 4 TO DO cards"] and st["closed"] == 1, f"success alert + popup closed: {st['alerts']}")
    check(len(st["plugin"]["card"]["links"]) == 2 + 4, "links saved for the new cards")
    check(not any("former_employee" in json.dumps(x) for x in created), "non-members are skipped")
    mp.close()

    mp = open_menu("S => { S.checklists[1].checkItems.forEach(i => i.state = 'complete'); }")
    menu = [x.strip() for x in mp.locator(".menu button").all_inner_texts()]
    check(menu == ["Spring merch 24.11 (6)"], f"one checklist left -> no 'All tasks': {menu}")
    mp.close()

    mp = open_menu("S => { S.checklists.forEach(cl => cl.checkItems.forEach(i => i.state = 'complete')); }")
    check(mp.locator(".menu").count() == 0 and mp.inner_text(".msg").startswith("Nothing to add"), "nothing left -> message instead of the menu")
    mp.close()

    mp = open_menu("S => { delete S.plugin.board.cfg.todoListId; }")
    check("Choose the TO DO list" in mp.inner_text(".msg"), "no TO DO list configured -> hint")
    mp.close()

    # background job: the connector creates the cards, the popup only shows progress; closing it doesn't stop the job
    def click_header_button():
        return cp.evaluate("""() => {
          const t = TrelloPowerUp.iframe();
          return window.__caps['card-back-section'](t).then(sec => { sec.action.callback(t); return window.__lastPopup.args.token; });
        }""")
    cp.evaluate("window.__postDelay = 900")
    tok = click_header_button()
    mp = open_menu(token=tok)
    menu = [x.strip() for x in mp.locator(".menu button").all_inner_texts()]
    check(menu == ["All tasks (10)", "Spring merch 24.11 (6)", "Retail SDK - 26.11 (4)"], f"background menu: {menu}")
    mp.locator(".menu button", has_text="All tasks").click()
    mp.wait_for_function("document.querySelector('.progress-count') && /^[1-9]\\d*\\/10$/.test(document.querySelector('.progress-count').textContent)")
    first = mp.inner_text(".progress-count")
    mp.screenshot(path=str(OUT / "5-progress.png"))
    hint = mp.inner_text(".progress")
    mp.close()  # the user closes the popup half-way
    check("keep being added" in hint, f"popup says the job continues in the background: {hint!r}")
    tok2 = click_header_button()
    mp2 = open_menu(token=tok2)
    mp2.wait_for_selector(".progress-count")
    second = mp2.inner_text(".progress-count")
    check(mp2.locator(".menu").count() == 0, f"reopened popup shows the running job ({first} -> {second}), not the menu")
    cp.wait_for_function("Object.keys(window.__state.cards).length === 2 + 10", timeout=20000)
    mp2.wait_for_function("document.querySelector('.msg') && document.querySelector('.msg').textContent.indexOf('Created 10') !== -1", timeout=5000)
    st = cp.evaluate("window.__state")
    check(len(st["cards"]) == 12 and len(st["plugin"]["card"]["links"]) == 12, "all 10 cards created and linked although the first popup was closed")
    check(st["alerts"][-1] == "✓ Created 10 TO DO cards", f"connector alert: {st['alerts'][-1:]}")
    mp2.wait_for_function("window.__state.closed === 1", timeout=5000)
    check(True, "popup closes itself when the job is done")
    mp2.close()

    # priority change is finished by the connector even if the epic is closed right after the click
    secp = ctx.new_page()
    secp.route("https://p.trellocdn.com/power-up.min.js", lambda rr: rr.fulfill(body=MOCK, content_type="application/javascript"))
    secp.route("https://p.trellocdn.com/power-up.min.css", lambda rr: rr.fulfill(body="", content_type="text/css"))
    secp.goto(f"{BASE}/section.html")
    secp.wait_for_selector(".cl")
    secp.locator(".item").nth(3).locator("select.prio").select_option("3")
    secp.close()  # the epic is closed at once
    cp.wait_for_function("window.__state.checklists[0].checkItems[3].name.startsWith('🟢')", timeout=5000)
    st = cp.evaluate("window.__state")
    edu_card = [c for c in st["cards"].values() if "Video for educational zones" in c["name"]][0]["name"]
    check(st["checklists"][0]["checkItems"][3]["name"].startswith("🟢 Video for educational zones") and edu_card.startswith("🟢 Video for educational zones"),
          f"priority set in the background after the epic was closed: item + card '{edu_card}'")

    b.close()

srv.shutdown()
print("\nFAILED:" if fails else "\nALL PASSED", *fails, sep="\n  ")
sys.exit(1 if fails else 0)

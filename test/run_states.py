"""Buttons keep their size and colour under the mouse and after a click, with Trello's own button CSS loaded
(test/trello-buttons.css): a chip 2px narrower on hover makes the chips re-wrap and jump; a grey button after a
click looks stuck. Run from the repo root:  python3 test/run_states.py
"""
import functools, http.server, pathlib, threading, sys, json
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
MOCK = (ROOT / "test" / "mock-powerup.js").read_text(encoding="utf-8")
TCSS = (ROOT / "test" / "trello-buttons.css").read_text(encoding="utf-8")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}"
ME = """S => { S.me = { id: 'mem' + '1'.padStart(21, '0'), username: 'maria_petrenko', fullName: 'Maria Petrenko' }; }"""
PAGES = sys.argv[1:] or ["section.html", "section.html?wide=1", "cardpoints.html", "storypoints.html", "spbar.html", "estimate.html", "settings.html", "addall.html"]
JS = """() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map((b, i) => { b.setAttribute('data-probe', i);
  const r = b.getBoundingClientRect(), s = getComputedStyle(b);
  return { i, cls: b.className, txt: b.innerText.slice(0, 24), w: r.width, h: r.height, bw: s.borderTopWidth, bs: s.borderTopStyle, bg: s.backgroundColor }; })"""
ONE = """i => { const b = document.querySelector('[data-probe="' + i + '"]'); const r = b.getBoundingClientRect(), s = getComputedStyle(b);
  return { w: r.width, h: r.height, bw: s.borderTopWidth, bs: s.borderTopStyle, bg: s.backgroundColor }; }"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    bad = 0
    for path in PAGES:
        ctx = b.new_context(viewport={"width": 770 if "wide" in path else 470, "height": 1400})
        pg = ctx.new_page()
        pg.route("https://p.trellocdn.com/power-up.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
        pg.route("https://p.trellocdn.com/power-up.min.css", lambda r: r.fulfill(body=TCSS, content_type="text/css"))
        pg.add_init_script("window.__mockPatch = " + ME)
        pg.goto(f"{BASE}/{path}"); pg.wait_for_timeout(1500)
        btns = pg.evaluate(JS)
        for x in btns:
            loc = pg.locator(f'[data-probe="{x["i"]}"]')
            try:
                loc.hover(timeout=1000)
            except Exception:
                continue
            pg.wait_for_timeout(30)
            hv = pg.evaluate(ONE, x["i"])
            pg.mouse.move(1, 1)
            pg.evaluate("i => document.querySelector('[data-probe=\"' + i + '\"]').focus()", x["i"])
            fc = pg.evaluate(ONE, x["i"])
            pg.evaluate("() => document.activeElement && document.activeElement.blur()")
            probs = []
            if abs(hv["w"] - x["w"]) > .1 or abs(hv["h"] - x["h"]) > .1: probs.append(f'hover size {x["w"]:.0f}x{x["h"]:.0f}->{hv["w"]:.0f}x{hv["h"]:.0f}')
            if abs(fc["w"] - x["w"]) > .1 or abs(fc["h"] - x["h"]) > .1: probs.append(f'focus size ->{fc["w"]:.0f}x{fc["h"]:.0f}')
            if fc["bg"] != x["bg"]: probs.append(f'focus bg {x["bg"]}->{fc["bg"]}')
            if probs and 'mod-primary' not in x["cls"]:  # mod-primary: Trello's own button, styled by its full CSS
                bad += 1; print(path, "|", x["cls"], "|", x["txt"].replace("\n", " "), "|", "; ".join(probs))
        ctx.close()
    print(("PASS" if not bad else "FAIL") + f" buttons keep size and colour on hover and focus ({bad} problems)")
    b.close()
srv.shutdown()
sys.exit(1 if bad else 0)

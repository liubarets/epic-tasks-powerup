#!/usr/bin/env python3
"""Generate a JavaScript snippet that commits files through GitHub's web "Upload files" page.

Why: the Claude sessions that built Teamload had no git credentials for this repo, so every deploy
went through the browser: open https://github.com/<owner>/<repo>/upload/<branch>/<dir>, run the
snippet in that page (javascript tool of the browser extension), and GitHub commits the files.

Two modes:

  full   - upload whole files (good for new files and binaries):
           gen_upload.py full  OUT.js "commit message" path/to/a.js path/to/b.js
           All files must go to the SAME directory (the one in the upload URL).

  patch  - fetch the current file from the GitHub API, check its SHA-256, apply exact string
           replacements, check the new SHA-256, then upload (keeps the snippet small):
           gen_upload.py patch OUT.js "commit message" DIR SPEC.json
           SPEC.json: {"style.css": {"path": "local/new/version/css/style.css",
                                     "reps": [["old text", "new text"], ...]}}
           DIR is the repo directory of the files (e.g. "css"), BRANCH is taken from --branch.

Options: --branch main (default), --repo liubarets/epic-tasks-powerup (default).
Pushing to main deploys to GitHub Pages within ~1 minute (the CDN and browsers cache files for up to
10 minutes: test in a fresh tab after waiting).
"""
import argparse, base64, gzip, hashlib, json, sys

def h16(b):
    return hashlib.sha256(b).hexdigest()[:16]

UPLOAD = r"""
const input = document.getElementById('upload-manifest-files-input'); const dt = new DataTransfer();
for (const [n, c] of Object.entries(files)) dt.items.add(new File([c], n));
input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
await new Promise(r => setTimeout(r, 5000));
const txt = document.querySelector('main').innerText; const listed = Object.keys(files).every(n => txt.indexOf(n) !== -1);
const msg = document.querySelector('input[name="message"], #commit-summary-input');
if (msg) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(msg, MSG); msg.dispatchEvent(new Event('input', { bubbles: true })); }
const desc = document.querySelector('textarea[name="description"], #commit-description-textarea');
if (desc && DESC) { const st = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; st.call(desc, DESC); desc.dispatchEvent(new Event('input', { bubbles: true })); }
const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Commit changes' && !b.disabled);
if (listed && btn) setTimeout(() => btn.click(), 50);
'files=' + Object.keys(files).length + ' listed=' + listed + ' commit=' + !!btn; }
"""

HEX = "const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16);\n"

def full(a):
    files = {}
    for p in a.paths:
        raw = open(p, 'rb').read()
        files[p.split('/')[-1]] = {"b64": base64.b64encode(gzip.compress(raw, 9)).decode(), "h": h16(raw)}  # gzip keeps the snippet small
    js = ("const MSG = " + json.dumps(a.message) + ", DESC = " + json.dumps(a.description) + ";\n"
          "const F = " + json.dumps(files) + ";\n" + HEX +
          "const files = {}, bad = [];\n"
          "const gunzip = async (z) => new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());\n"
          "for (const [n, f] of Object.entries(F)) { const b = await gunzip(Uint8Array.from(atob(f.b64), c => c.charCodeAt(0))); if (await hex(b) !== f.h) bad.push(n); files[n] = new Blob([b]); }\n"
          "if (bad.length) { 'HASH MISMATCH ' + bad.join(', '); } else {" + UPLOAD)
    return js, {n: f["h"] for n, f in files.items()}

def patch(a):
    spec = json.load(open(a.spec))
    D = {}
    for fn, s in spec.items():
        new = open(s['path'], encoding='utf-8').read(); old = new
        for x, y in s['reps']:
            assert new.count(y) == 1, (fn, y[:50]); old = old.replace(y, x)
        D[fn] = {"old": h16(old.encode()), "new": h16(new.encode()), "reps": s['reps']}
    api = "https://api.github.com/repos/" + a.repo + "/contents/" + (a.dir + "/" if a.dir else "")
    js = ("const MSG = " + json.dumps(a.message) + ", DESC = " + json.dumps(a.description) + ";\n"
          "const D = " + json.dumps(D, ensure_ascii=False) + ";\n" + HEX +
          "const files = {}, bad = [];\n"
          "for (const [n, d] of Object.entries(D)) {\n"
          "  const j = await (await fetch(" + json.dumps(api) + " + n + '?ref=" + a.branch + "&t=' + Date.now(), { cache: 'no-store' })).json();\n"
          "  let txt = new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\\n/g, '')), c => c.charCodeAt(0)));\n"
          "  if (await hex(new TextEncoder().encode(txt)) !== d.old) { bad.push(n + ' old'); continue; }\n"
          "  for (const [x, y] of d.reps) { if (txt.split(x).length !== 2) { bad.push(n + ' rep'); break; } txt = txt.split(x).join(y); }\n"
          "  if (await hex(new TextEncoder().encode(txt)) !== d.new) { bad.push(n + ' new'); continue; }\n"
          "  files[n] = txt;\n}\n"
          "if (bad.length) { 'MISMATCH ' + bad.join(', '); } else {" + UPLOAD)
    return js, {n: (d["old"], d["new"]) for n, d in D.items()}

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--branch', default='main'); ap.add_argument('--repo', default='liubarets/epic-tasks-powerup')
    ap.add_argument('--description', default='', help='extended commit description (e.g. attribution lines)')
    sub = ap.add_subparsers(dest='mode', required=True)
    f = sub.add_parser('full'); f.add_argument('out'); f.add_argument('message'); f.add_argument('paths', nargs='+')
    p = sub.add_parser('patch'); p.add_argument('out'); p.add_argument('message'); p.add_argument('dir'); p.add_argument('spec')
    a = ap.parse_args()
    js, info = full(a) if a.mode == 'full' else patch(a)
    open(a.out, 'w', encoding='utf-8').write(js)
    print(a.out, info)

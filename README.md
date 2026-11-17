# Epic Tasks — a Trello Power-Up

A custom Power-Up that adds a **"TASKS"** section to the back of an epic card:

- A **priority** for every checklist item (🔴 P1 / 🟠 P2 / 🟢 P3) and a "↕ Sort by priority" button.
- A chip for **every assignee** next to each item: `@username ＋ TO DO`. A click creates a card in your TO DO list assigned to that person. **The item stays in the epic.**
- "＋ Add all to TO DO" in the TASKS header: pick a checklist or "All tasks" and create the missing TO DO cards for the open items in one click.
- After that the chip shows the card's status: `✓ TO DO`, `✓ IN PROGRESS`, `✓ DONE`. Clicking the chip opens the card.
- "＋ Assign to me": take an item you are not mentioned in.
- "Only mine" and "Hide completed" filters, open P1 counter.

Installed **once per Workspace**. Nobody on the team needs a browser extension.

---

## How it works

| What | Where it is stored |
|---|---|
| Priority | An emoji at the start of the item name (`🔴 Approve with legal`). It is visible in the regular Trello checklist and on the "My tasks" page too. |
| Item assignees | `@username` in the item text, plus the native checklist-item assignee if one is set. |
| TO DO card | Name: `🔴 Approve with legal — Merch launch`. Member: the assignee. Description: `[Epic name](epic link) / Checklist name`. Due date: from the item. Attachment: link to the epic. No labels — the emoji in the name is the priority. |
| Item → card link | In the Power-Up data on the epic card. The checklist item itself is not changed. The link counts only while the card exists and the person is still a member of it: if they remove themselves from the card (or the card is deleted), the item shows "＋ TO DO" for them again. |
| Priority change | Updates the item and the emoji in TO DO cards that are not done yet. |
| "Add all to TO DO" | The button sits in the TASKS header. Trello draws it, so it can't show a counter. A click opens a menu with the checklists that have something to add and how many cards each will create, plus "All tasks" (every checklist at once) when more than one does. One card per open item × assignee that doesn't have a card yet; items without assignees and people who are not board members are skipped. When there is nothing to add, Trello shows a short notice instead of the menu. |
| Auto-complete | When every assignee of an item has a TO DO card and all of them are in a "Done" list, the item in the epic is ticked. If one of those cards is later moved out of Done (e.g. back to In progress), the item is unticked again; the Power-Up checks this against Trello's activity history, so it also catches moves made while nobody had the epic open. An item you tick by hand while a card is still open (including after a card was moved back) is left alone. Only moving a card to Done completes it: a card archived from TO DO / In progress counts as cancelled (the item stays open and the chip shows "＋ TO DO" again), while a card archived from Done stays done. This happens when someone opens the epic. Can be turned off in settings. |

---

## Installation (≈20 minutes, done by a Workspace admin)

### 1. Host the files (HTTPS)

Any static hosting works. The simplest option is **GitHub Pages**:

1. Create a repository (e.g. `epic-tasks-powerup`) and upload the **contents** of this folder.
2. Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/ (root)` → Save.
3. In a minute or two the site is available at `https://<your-login>.github.io/epic-tasks-powerup/`.

> If company policy doesn't allow GitHub, an internal web server, Azure Static Web Apps, Netlify etc. work too. No backend is needed.

### 2. Register the Power-Up

1. Open https://trello.com/power-ups/admin → **New**.
2. Workspace: your Workspace. Name: `Epic Tasks`.
   **Iframe connector URL**: `https://<your-login>.github.io/epic-tasks-powerup/index.html`.
   Enter a contact e-mail → Create.
3. **Capabilities** tab: enable
   - `Card back section`
   - `Show settings`
   - `Authorization status`
   - `Show authorization`

### 3. Authorization (pick one)

**Option A: Trello auth (simpler)**
1. **Trello Auth** tab → *Generate a new Trello Auth API key*.
2. Copy the key into `js/config.js` → `APP_KEY`.
3. On the same page, under **Allowed origins**, add `https://<your-login>.github.io`.

**Option B: OAuth 2.0** (Trello recommends it for new apps)
1. **OAuth 2.0** tab → security type **Public**.
2. Callback URL: `https://<your-login>.github.io/epic-tasks-powerup/auth-redirect.html`.
3. Scopes: `read:board:trello`, `write:board:trello`.
4. Put the Client ID into `js/config.js` → `OAUTH2_CLIENT_ID`.

Commit `config.js`. The API key and the Client ID are public by design in Trello — they are not secrets. Never put the **Secret** from the API key page into the code.

### 4. Enable it on a board

1. Board → **Power-Ups** → **Custom** → *Epic Tasks* → **Add**.
2. Power-Ups → Epic Tasks → **Authorize account** → "Connect" → Allow. Trello shows **Edit Power-Up settings** only after authorization. Alternatively use the ⚙ button in the "TASKS" section on a card.
3. Power-Ups → Epic Tasks → **Edit Power-Up settings**:
   - **TO DO list**: where new cards go (e.g. `TO DO`).
   - **Done lists**: e.g. `Done`. The TO DO list itself can't be a Done list (it is greyed out there).
   - New card position and auto-complete.

### 5. Every team member: one click

The first time someone opens an epic, the "TASKS" section shows a **Connect** button. They click it, allow access, and that's it.

---

## Limitations

- Trello doesn't let a Power-Up change how the **native** checklist looks. That's why buttons and priorities live in a separate section on the card back, while the native checklist stays as is (the priority emoji is visible there as well). Items are ticked in the native checklist.
- The section appears only on cards that have a checklist.
- The TO DO list must be on the **same board**.
- The section refreshes when the card is opened, after every action in it, and with the ⟳ button. There is no live sync with other people's changes while the card is open.
- Trello mobile apps may not show custom Power-Up sections. Emoji priorities and TO DO cards are visible there as regular Trello data.
- Assignees are taken from `@username` in the item text. If the person is not a board member, their chip is grey and inactive.
- After an update, GitHub Pages may serve the old version from cache for up to 10 minutes.

## Security

- There is no server side. All requests go straight from the user's browser to the Trello API, on their behalf and with their permissions.
- The token is stored by Trello's own library in the user's private Power-Up data. It can be revoked in Trello → Settings → Applications / Power-Ups.

## Structure

```
index.html          connector (registers capabilities)
section.html        "TASKS" section
settings.html       board settings
addall.html         "Add to TO DO" menu (opened from the TASKS header)
auth.html           connect window
auth-redirect.html  OAuth 2.0 callback
js/config.js        ← the only file you need to edit
js/core.js          logic (priorities, mentions, sorting)
js/todo.js          loading the epic, link validity, creating TO DO cards
js/auth.js          authorization + REST
js/section.js       section UI
js/client.js        connector + "Add all to TO DO" header button
js/addall.js        "Add to TO DO" menu UI
js/settings.js      settings UI
css/style.css
img/icon-gray.svg
test/               tests (not deployed)
```

## Tests

```bash
node --test test/core.test.js     # logic
python3 test/run_ui.py            # UI against a mocked Trello (needs playwright + Chrome)
```

# Teamload — a Trello Power-Up

Story points with live per-person totals, quick estimating, and one-click TO DO cards from epic checklists.

It adds a **"TASKS"** section to the back of an epic card:

- **Big epics fit without scrolling.** Trello cuts a Power-Up's card section at 1500 px (no scroll inside), so an item's name and its chips share one line when they fit, and when the epic is still taller, checklists fold to a one-line header (name, done/total, Sort, ＋ Cards): first the finished ones, then those with nothing left to hand out, then from the bottom. A hint says so. A click on a checklist's name opens or folds it; opening one folds another if needed, and what you opened by hand stays open.
- Every checklist is a block like Trello's own panels: a thin frame with rounded corners, the header on Trello's light grey (priority, name, "Sort by priority" and "＋ Cards" on the first line; done/total and the progress bar on a line of their own under the name, as in Trello's checklists), its items on white and set in a little under it. The checklist's priority select and the items' ones have the same width.
- A **priority** for every checklist item (🔴 P1 / 🟠 P2 / 🟢 P3 / ⚪ P4 low / ↪️ NS next sprint) and a "↕ Sort by priority" button (P1 … P4, then no priority, then NS at the bottom). **↪️ NS** items (or every item of an NS checklist that has no priority of its own) are not offered by "＋ Cards" / "＋ All cards" and are not added to people's checklist cards by themselves; their chip still makes a card if someone wants it now.
- A chip for **every assignee** next to each item: `@username ＋ TO DO`. A click creates a card in your TO DO list assigned to that person. **The item stays in the epic.**
- After that the chip shows the status: `✓ TO DO`, `✓ In progress`, `✓ DONE`. A click opens a drop-down list styled like Trello's (title, ×, ✓ on the current status) that always opens **down** from the chip; anyone can change the status there (TO DO / In progress / DONE). A separate card moves to that list. **An item in a checklist card has its own status**: In progress moves the whole card out of TO DO, but the card's other items keep their status; DONE ticks the item, and when all items of the card are done the card moves to Done. A checklist card moved to a Done list by hand makes all its items DONE (they get ticked the next time the epic or the card is opened). **Moved back out of Done** (to a TO DO column or In progress) while all its items are still ticked, the card gets a warning everywhere, with no buttons: a yellow notice in its STORY POINTS section, a yellow "⚠ Statuses" badge on the card on the board, and "☰ DONE ⚠" on the people's chips in the epic. It goes away as soon as one item is set back to TO DO / In progress, or the card returns to Done. Ticking every item in Trello's own checklist does not move a card to Done by itself (that would send a card someone just took out of Done straight back); use the status DONE from Teamload for that. The in-progress list is found **by its name only**, never by where it stands, so reordering columns changes nothing: "In progress" first, else a name with "progress", "Doing", "WIP", "В роботі"/"У роботі", "В процесі"; TO DO columns and Done lists never count. A board with no such column offers only TO DO and DONE.
- "＋ Assign to me": adds your @username to an item you are not mentioned in. It does not create a TO DO card: use your chip or "＋ Cards" for that.
- **"＋ Cards (n) ▾"** in a checklist header: n = open items × assignees of that checklist with no card yet. Anyone can use it, for themselves or for others. The menu has a row per person tagged in those items (me first, with their count) and an **Everyone** row. The menu stays open until a click outside it, Esc or its ×, so cards for several people can be started one after another; the jobs run in turn and every row shows a progress bar in its own place (the list is not re-sorted) (`☰ 1 / 2`, then `✓ 2 items added`). Each row has two buttons:
  - **☰ Checklist**: a card "Epic / Checklist" in TO DO with that person as its member and a checklist of just their items (priority emoji and due dates kept, no @mentions). If they already have such a card for this checklist, the items are added to it.
  - **▤ Each**: separate cards, as the chips do.
  People not tagged in the checklist are not listed. When every open item has a card, the button stays, grey and inactive.
- **"＋ All cards (n) ▾"** next to ⟳ ⚙ (epics with two or more checklists): the same menu for the whole epic, n and every person's count summed over all checklists. **☰ Checklist** makes a card per checklist for each person (as if "☰ Checklist" was pressed on every checklist: two checklists → two cards), **▤ Each** a card per item. Items that already have a card are skipped, so pressing it again makes no duplicates; one progress bar per row covers all the checklists.

And **story points** for the board (turned on per board in settings):

- The points live in Trello's own number field **"Story points"**. Each card shows them as a badge in its icon row (⚡ 5); TO DO cards without an estimate get a yellow ⚡ ?.
- Typing `[3]` or `(3)` in a card title still works (also `[0,5]`, `(0,5)`, `{3}`): the number is moved into the field and removed from the title. Only a number inside the brackets counts, so `(v2)`, `(Lviv)` or a date like `(24.11)` stay in the title.
- The **SP** button in the board header (the Teamload icon: a white ⚡ on blue) opens a **panel at the bottom of the board**: the TO DO list, the picked person and their points ("Dmytro Voloshyn · 14 points"). The panel updates by itself while you work — when someone changes points, members or moves cards — and stays open (it reopens on its own the next time you open the board) until you close it with ×. A click on the person opens a list like Trello's own filter: checkbox on the left, each person's points on the right, the TO DO total on top, search by name; clicking the ticked person unpicks them (then the panel shows the total for everyone). The picked person is personal: everyone picks their own.
- **Estimating without opening cards:** the panel shows "Unestimated" (or "All estimated"), without a count. A click opens a big window with the TO DO cards of the picked person, one row each with 0.5, 1, 2, 3, 5, 8, 13, 21. One click saves the value; cards estimated there stay listed with a ✓ until the window is closed. Tabs: "No estimate" and "All" (to change a value). The person can be changed in the window too. Setting values needs Teamload to be connected.
- On the card back, the "Story points" badge opens quick values: 0.5, 1, 2, 3, 5, 8, 13, 21, No estimate.
- **A card with a checklist is estimated item by item** (any card in TO DO, including people's checklist cards): a **STORY POINTS** section on its back lists every item with, on the right, a points drop-down (⚡ 3 ▾, in a white frame) and a status drop-down in Trello's colours (TO DO grey / IN PROGRESS blue / DONE green; same rules as in the epic; both open down). Points and status stand in two columns (every status button is as wide as the widest one), and the card's points — the sum of its open items — are shown next to the section's title, on its line. Ticking an item takes its points out of the card's points at once. A click on the value already set clears it. In the Estimate window such a card is one row per open item.

Installed **once per Workspace**. Nobody on the team needs a browser extension.

---

## Sprints

- Lists named **"SPRINT 48"** (also "Sprint", "Спринт", "Спрінт") hold the epics of that sprint; each sprint has its own TO DO column, **"TO DO SP48"**.
- Cards made from an epic go to the TO DO column of the epic's sprint. The column is **created automatically** the first time someone adds tasks from an epic of that sprint, to the right of DONE (after the TO DO SP columns already there). If two people make it at the same moment, one is kept and the other archived.
- Every "TO DO SP<n>" column counts as a TO DO list: STORY POINTS on the card back, the yellow ⚡ ? badge, the TO DO status in the epic (named after the column, e.g. "TO DO SP48"). Unfinished tasks stay in their sprint's column.
- The **panel** counts the **newest** sprint's column by default. Its switcher (the column name on the left) lists all TO DO SP columns, newest first, with points; picking an older one is personal and lasts until a newer sprint column appears. The people list and the Estimate window use the same column.
- The newest sprint is the one with the highest number; numbering that starts again from 1 in a new year is recognised (a gap of more than 2 between numbers: "1" after "52").
- An epic outside a sprint list uses the TO DO list from settings, as before. A board without TO DO SP columns works as before.
- **A copy of an epic** (the team copies epics to the next sprint) does not take over the original's cards: the epic marks its Teamload data with its own id, and a copy starts clean.

## How it works

| What | Where it is stored |
|---|---|
| Priority | An emoji in the item name (`🔴 Approve with legal`), added at the start. It is visible in the regular Trello checklist and on the "My tasks" page too. If a title is edited later and the emoji ends up elsewhere (`[5] 🟢 Video …`), it is still found and replaced where it stands. |
| Item assignees | `@username` in the item text, plus the native checklist-item assignee if one is set. |
| TO DO card | Name: `🔴 Approve with legal — Merch launch`. Member: the assignee. Description: `[Epic name](epic link) / Checklist name`. Due date: from the item. Nothing is attached (so Trello shows no Attachments section). No labels — the emoji in the name is the priority. |
| Item → card link | In the Power-Up data on the epic card. The checklist item itself is not changed. The link counts only while the card exists and the person is still a member of it: if they remove themselves from the card (or the card is deleted), the item shows "＋ TO DO" for them again. |
| Priority change | Updates the item and the emoji in TO DO cards that are not done yet and in the item in people's checklist cards, wherever the emoji stands; **only the emoji changes**, the rest of a name edited in the card stays. A checklist's priority (🔴/🟠/🟢 select in its header) goes into the cards made from it the same way: people's checklist cards `Epic / 🔴 Checklist` (name, the checklist inside, the first line of the description) and the separate cards `Item — 🔴 Checklist`. The epic's priority is the one that counts: set, changed or removed after the cards were made, it reaches them too, also when it was typed in Trello itself (on the next opening of the epic). Cards in a Done list or archived are left alone. The new priority shows at once and is saved in the background, so it is applied even if you close the epic right away (the same goes for "Sort by priority"). |
| Story points | The Trello custom field "Story points" (number), created from the settings with one click and hidden from the card front (the Power-Up's badge shows the number instead). A card with several members counts fully for each of them; the TO DO total counts every card once. A card whose title still has `[n]` counts too. |
| Moving `[n]` / `(n)` from titles | Optional, per board ("Move [n] or (n) from card titles into the field automatically"). The value is written to the field first, then the title is cleaned, so nothing is lost if renaming fails. It runs in the browser of anyone who connected Teamload while the board is open, usually within a second; "Move now" in the settings does all cards at once. Only 1–3 digits count (`[2025]` is not points); in round and curly brackets at most one digit after the point, so a date like `(24.11)` is not taken for points. |
| Checklist card | Name `Epic name / Checklist name`, the person as its member, `[Epic](link) / Checklist` as description, nothing attached, one checklist named like the epic's. The card knows its epic (Power-Up data `kid` on the card) and gets no TASKS section. The epic remembers which items are in whose card (Power-Up data `groups`: checklist × person → card and its items). An item × person is in a separate card **or** in a checklist card, never both: the chip shows where and the item's status (`☰ TO DO`, `☰ In progress`, `☰ DONE`). Items that are IN PROGRESS are kept on the card (Power-Up data `st`). |
| Keeping epic and checklist cards in step | When someone opens the epic: a new item for a person who has a checklist card for its checklist is added to that card (unless the card is in a Done list, archived, or the person left it); the priority emoji and due date are copied from the epic into the cards (names are not: they may be corrected in the card); ticks go both ways and the latest change wins — ticked in the card → ticked in the epic once every assignee is done, unticked in the card → reopened in the epic, ticked or unticked by hand in the epic → the same in people's cards. Cards are never moved: people move them. |
| Item points | Power-Up data `pts` on the card (last 8 characters of the item id → points). `[n]` or `(n)` typed into an item moves there (with "Move [n]…" on), and `[n]` in an epic item becomes the starting points of that item in people's checklist cards. The card's "Story points" field is the sum of open items; it is updated by the STORY POINTS section, by the Estimate window, and by the card badges while anyone who connected Teamload has the board open — so ticking an item updates the field and the SP panel without opening the card. A card whose items have no points keeps its own value. |
| Data limit | Trello keeps at most 4096 characters of Power-Up data per card. The epic's `links` and `groups` fit about 100 item × person pairs; past that Teamload refuses the change with a clear message instead of failing half-way. |
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
2. Workspace: your Workspace. Name: `Teamload`.
   **Iframe connector URL**: `https://<your-login>.github.io/epic-tasks-powerup/index.html`.
   Enter a contact e-mail → Create.
3. **Capabilities** tab: enable
   - `Card back section`
   - `Show settings`
   - `Authorization status`
   - `Show authorization`
   - `Board buttons`, `Card badges`, `Card detail badges` (story points)

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

1. Board → **Power-Ups** → **Custom** → *Teamload* → **Add**.
2. Power-Ups → Teamload → **Authorize account** → "Connect" → Allow. Trello shows **Edit Power-Up settings** only after authorization. Alternatively use the ⚙ button in the "TASKS" section on a card.
3. Power-Ups → Teamload → **Edit Power-Up settings**:
   - **TO DO list**: where new cards go (e.g. `TO DO`).
   - **Done lists**: e.g. `Done`. The TO DO list itself can't be a Done list (it is greyed out there).
   - New card position and auto-complete.
   - **Story points** (optional): tick "Show story points", click "Create field “Story points”", optionally tick "Move [n] from card titles…" and use "Move now". After saving, reload the board once to see the SP button (Power-Ups menu → Buttons → SP switches it on/off in the header).

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
- Trello doesn't let a Power-Up draw inside its own checklist, so the story point and status drop-downs live in a STORY POINTS section under it.
- The panel's "N unestimated" counts cards whose field is empty. A card estimated by items counts as unestimated only while none of its open items has points; the Estimate window lists every unestimated item.
- Removing an item from your checklist card by hand doesn't take you off it in the epic: the item is added again the next time someone opens the epic. Change the epic instead.
- Story points: Trello doesn't tell Power-Ups which board filter is on, and doesn't let them add content to the middle of the board header or list headers. That's why the person is chosen in the panel at the bottom of the board and the SP button sits among the other header buttons. Card badges always come after Trello's own icons.

## Security

- There is no server side. All requests go straight from the user's browser to the Trello API, on their behalf and with their permissions.
- The token is stored by Trello's own library in the user's private Power-Up data. It can be revoked in Trello → Settings → Applications / Power-Ups.

## Structure

```
index.html          connector (registers capabilities)
section.html        "TASKS" section
settings.html       board settings
spbar.html          story points panel at the bottom of the board
storypoints.html    person list (opened from the panel)
estimate.html       "Estimate story points" window (opened from the panel)
spedit.html         quick story point values (card back badge)
cardpoints.html     "STORY POINTS" section: points and status drop-downs for every item of a card with a checklist
js/dropdown.js      drop-down list like Trello's, drawn in the iframe so it always opens down
addall.html         "Add to TO DO" menu (opened from the TASKS header)
auth.html           connect window
auth-redirect.html  OAuth 2.0 callback
js/config.js        ← the only file you need to edit
js/core.js          logic (priorities, mentions, sorting)
js/todo.js          loading the epic, link validity, creating TO DO cards and checklist cards, epic ↔ card sync
js/auth.js          authorization + REST
js/section.js       section UI
js/client.js        connector (capabilities, badges, background jobs)
js/addall.js        "Add to TO DO" menu + progress
js/settings.js      settings UI
js/points.js        story points: [n] parsing, the field, sums, moving [n] into the field
js/spbar.js         story points panel (live)
js/storypoints.js   person list
js/estimate.js      "Estimate story points" window
js/spedit.js        quick values popup
js/cardpoints.js    STORY POINTS section (item points, the card's sum)
css/style.css
img/icon-gray.svg, img/teamload-icon.svg/.png (app icon and SP button), img/bolt.svg
test/               tests (not deployed)
```

## Tests

```bash
node --test test/core.test.js test/points.test.js   # logic
python3 test/run_ui.py            # TASKS section UI against a mocked Trello (needs playwright + Chrome)
python3 test/run_sp.py            # story points UI against a mocked Trello
python3 test/run_kid.py           # "＋ Cards", checklist cards, epic ↔ card sync, points per checklist item
python3 test/run_sprint.py        # sprints: TO DO SP<n> columns made on demand, the panel's sprint switcher, copied epics
python3 test/run_all.py           # "＋ All cards": cards for every checklist of the epic at once
```

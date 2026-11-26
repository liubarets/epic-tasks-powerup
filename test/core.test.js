// Run: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const members = [
  { id: 'm1aaaaaaaaaaaaaaaaaaaaaa', username: 'maria_petrenko', fullName: 'Maria' },
  { id: 'm2bbbbbbbbbbbbbbbbbbbbbb', username: 'tarasbondar', fullName: 'Taras' },
  { id: 'm3cccccccccccccccccccccc', username: 'v_kim', fullName: 'V Kim' },
];

test('priority parse / set / strip', () => {
  assert.equal(C.parsePriority('🔴 Approve with legal'), 1);
  assert.equal(C.parsePriority('🟢Check'), 3);
  assert.equal(C.parsePriority('Approve 🔴'), 1, 'emoji anywhere in the name counts');
  assert.equal(C.parsePriority('[5] 🟠 Video'), 2);
  assert.equal(C.parsePriority('🟠️ Video'), 2, 'with a variation selector');
  assert.equal(C.parsePriority('Video'), 0);
  assert.equal(C.withPriority('Approve', 2), '🟠 Approve');
  assert.equal(C.withPriority('🔴 Approve', 3), '🟢 Approve');
  assert.equal(C.withPriority('🔴 Approve', 0), 'Approve');
});

test('priority emoji is replaced where it stands (card titles edited by people)', () => {
  assert.equal(C.withPriority('[5] 🟢 Video for entry screens — Spring merch 24.11', 2), '[5] 🟠 Video for entry screens — Spring merch 24.11');
  assert.equal(C.withPriority('Video 🔴 — Spring', 3), 'Video 🟢 — Spring');
  assert.equal(C.withPriority('Video — Spring 🟠', 1), 'Video — Spring 🔴');
  assert.equal(C.withPriority('🟠️ Video', 1), '🔴 Video', 'variation selector is dropped with the old emoji');
  assert.equal(C.withPriority('[5] 🟢 Video', 0), '[5] Video');
  assert.equal(C.withPriority('Video 🟢', 0), 'Video');
  assert.equal(C.withPriority('[5] Video', 1), '🔴 [5] Video', 'no emoji yet: added at the start');
  assert.equal(C.stripPriority('[5]🟢Video'), '[5] Video');
  assert.equal(C.cleanTitle('[5] 🟠 Video for screens @maria_petrenko'), '[5] Video for screens');
  assert.equal(C.todoCardName('[5] 🟠 Video @maria_petrenko', 'Spring'), '🟠 [5] Video — Spring');
});

test('mentions and clean title', () => {
  const n = '🔴 Video for big entry screens in BR @olenashevchenko0711 @tarasbondar @sofia_melnyk';
  assert.deepEqual(C.parseMentions(n), ['olenashevchenko0711', 'tarasbondar', 'sofia_melnyk']);
  assert.equal(C.cleanTitle(n), 'Video for big entry screens in BR');
  assert.deepEqual(C.parseMentions('mail me at a@b.com'), []);
  assert.equal(C.cleanTitle('Approve with legal @maria_petrenko, then send'), 'Approve with legal, then send');
});

test('resolveAssignees: mentions + native assignee, unknowns flagged, no dupes', () => {
  const r = C.resolveAssignees({ name: 'Do it @tarasbondar @ghost_user @TarasBondar', idMember: 'm3cccccccccccccccccccccc' }, members);
  assert.deepEqual(r.map(a => [a.username, a.unknown]), [['tarasbondar', false], ['ghost_user', true], ['v_kim', false]]);
  const r2 = C.resolveAssignees({ name: 'X @v_kim', idMember: 'm3cccccccccccccccccccccc' }, members);
  assert.equal(r2.length, 1);
});

test('sortByPriority is stable and puts unprioritised last', () => {
  const items = [
    { id: 'a', name: 'A' }, { id: 'b', name: '🟢 B' }, { id: 'c', name: '🔴 C' },
    { id: 'd', name: 'D' }, { id: 'e', name: '🔴 E' }, { id: 'f', name: '🟠 F' },
  ];
  assert.deepEqual(C.sortByPriority(items).map(i => i.id), ['c', 'e', 'f', 'b', 'a', 'd']);
  assert.ok(C.sameOrder(items, items.slice()));
});

test('links: compact keys, pruning, size budget', () => {
  const k = C.linkKey('5f1234567890abcdef123456', 'm1aaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(k, '90abcdef123456'.slice(-10) + ':' + 'aaaaaaaa');
  const links = { [k]: 'AbCdEfGh', ['zzzzzzzzzz:aaaaaaaa']: 'x' };
  assert.deepEqual(C.pruneLinks(links, ['5f1234567890abcdef123456']), { [k]: 'AbCdEfGh' });
  // 100 item×member links must fit in Trello's 4096-char pluginData limit
  const big = {};
  for (let i = 0; i < 100; i++) big[C.linkKey('5f12345678' + String(i).padStart(14, '0'), 'm1aaaaaaaaaaaaaaaaaa' + i)] = 'AbCdEfGh';
  assert.ok(JSON.stringify(big).length < 4096, 'size ' + JSON.stringify(big).length);
});

test('done detection and TODO card name', () => {
  assert.equal(C.isCardDone({ idList: 'L1' }, ['L2']), false);
  assert.equal(C.isCardDone({ idList: 'L2' }, ['L2']), true);
  // only a Done list counts: due-complete or archived elsewhere is not done
  assert.equal(C.isCardDone({ idList: 'L1', dueComplete: true }, ['L2']), false);
  assert.equal(C.isCardDone({ idList: 'L1', closed: true }, ['L2']), false);
  assert.equal(C.isCardDone({ idList: 'L2', closed: true }, ['L2']), true);
  assert.equal(C.isCardCancelled({ idList: 'L1', closed: true }, ['L2']), true);
  assert.equal(C.isCardCancelled({ idList: 'L2', closed: true }, ['L2']), false);
  assert.equal(C.isCardCancelled({ idList: 'L1' }, ['L2']), false);
  assert.equal(C.todoCardName('🔴 Approve with legal @maria_petrenko', 'Spring merch 24.11'), '🔴 Approve with legal — Spring merch 24.11');
  assert.equal(C.todoCardName('Check WEB&B2C', 'Retail SDK - 26.11'), 'Check WEB&B2C — Retail SDK - 26.11');
});

test('allAssignees adds people who took the item via "Assign to me"', () => {
  const item = { id: 'item000000000000000000ab', name: 'Check WEB&B2C' };
  assert.deepEqual(C.allAssignees(item, members, {}), []);
  const links = { [C.linkKey(item.id, 'm2bbbbbbbbbbbbbbbbbbbbbb')]: 'abcd1234' };
  const r = C.allAssignees(item, members, links);
  assert.deepEqual(r.map(a => [a.username, a.taken]), [['tarasbondar', true]]);
  const mentioned = { id: item.id, name: 'X @tarasbondar' };
  assert.deepEqual(C.allAssignees(mentioned, members, links).map(a => a.username), ['tarasbondar']);
});

test('TO DO card description: "[Epic](url) / Checklist"', () => {
  const epic = { name: 'Epic: Q4 launches', url: 'https://trello.com/c/AbC/1-epic' };
  assert.equal(C.todoCardDesc(epic, 'Spring merch 24.11'), '[Epic: Q4 launches](https://trello.com/c/AbC/1-epic) / Spring merch 24.11');
  assert.equal(C.todoCardDesc({ name: 'A [b]', url: 'u' }, 'X'), '[A \\[b\\]](u) / X');
});

test('isLinkAlive: card must exist, not be cancelled, and still have the person', () => {
  const done = ['L2'];
  assert.equal(C.isLinkAlive(null, 'm1', done), false);
  assert.equal(C.isLinkAlive({ idList: 'L1', idMembers: ['m1'] }, 'm1', done), true);
  assert.equal(C.isLinkAlive({ idList: 'L1', idMembers: [] }, 'm1', done), false, 'removed from card');
  assert.equal(C.isLinkAlive({ idList: 'L1', idMembers: ['m2'] }, 'm1', done), false, 'reassigned');
  assert.equal(C.isLinkAlive({ idList: 'L1', idMembers: ['m1'], closed: true }, 'm1', done), false, 'archived from TO DO');
  assert.equal(C.isLinkAlive({ idList: 'L2', idMembers: ['m1'], closed: true }, 'm1', done), true, 'archived from Done');
});

test('reopen: an item is unticked only if a card left Done after the item was ticked', () => {
  const tick = (id, state, date) => ({ date, data: { checkItem: { id, state } } });
  const move = (from, to, date) => ({ date, data: { listBefore: { id: from }, listAfter: { id: to } } });
  const epic = [tick('i1', 'complete', '2026-11-17T10:00:00.000Z'), tick('i1', 'incomplete', '2026-11-17T09:00:00.000Z'),
    tick('i1', 'complete', '2026-11-17T08:00:00.000Z'), tick('i2', 'complete', '2026-11-17T07:00:00.000Z')];
  assert.equal(C.lastTicked(epic, 'i1'), '2026-11-17T10:00:00.000Z');
  assert.equal(C.lastTicked(epic, 'nope'), null);
  const card = [move('L_done', 'L_prog', '2026-11-17T09:30:00.000Z'), move('L_todo', 'L_done', '2026-11-17T09:00:00.000Z'),
    move('L_todo', 'L_prog', '2026-11-17T08:30:00.000Z')];
  assert.equal(C.lastLeftDone(card, ['L_done']), '2026-11-17T09:30:00.000Z');
  assert.equal(C.lastLeftDone(card, ['L_other']), null);
  assert.equal(C.lastLeftDone([move('L_done', 'L_done2', '2026-11-17T09:00:00.000Z')], ['L_done', 'L_done2']), null, 'Done -> another Done list is not reopening');
  assert.equal(C.shouldReopen('2026-11-17T09:00:00.000Z', '2026-11-17T09:30:00.000Z'), true, 'left Done after the tick');
  assert.equal(C.shouldReopen('2026-11-17T10:00:00.000Z', '2026-11-17T09:30:00.000Z'), false, 'ticked again by hand afterwards');
  assert.equal(C.shouldReopen('2026-11-17T10:00:00.000Z', null), false, 'card never was in Done');
  assert.equal(C.shouldReopen(null, '2026-11-17T09:30:00.000Z'), true, 'tick is older than the history we got');
});

test('checklist cards: groups, item lookup, keys, names', () => {
  const cl = 'cl0000000000000000000001', m = 'm1aaaaaaaaaaaaaaaaaaaaaa', item = '5f1234567890abcdef123456';
  assert.equal(C.groupKey(cl, m), '0000000001:aaaaaaaa');
  assert.equal(C.itemKey(item), '90abcdef123456'.slice(-10));
  assert.equal(C.kidSuffix('aaaa00000000000011111111'), '11111111');
  const groups = { [C.groupKey(cl, m)]: { s: 'KID00001', i: { [C.itemKey(item)]: '11111111' } } };
  assert.deepEqual(C.kidEntry(groups, cl, m, item), { shortLink: 'KID00001', suffix: '11111111' });
  assert.equal(C.kidEntry(groups, cl, 'm2bbbbbbbbbbbbbbbbbbbbbb', item), null, 'another person');
  assert.equal(C.kidEntry(groups, cl, m, 'other0000000000000000000'), null, 'another item');
  const cls = [{ checkItems: [{ id: 'aaaa00000000000011111111' }] }, { checkItems: [{ id: 'bbbb00000000000022222222' }] }];
  assert.equal(C.findKidItem(cls, '22222222').id, 'bbbb00000000000022222222');
  assert.equal(C.findKidItem(cls, '33333333'), null, 'item removed from the card');
  const pruned = C.pruneGroups({ ...groups, '0000000009:aaaaaaaa': { s: 'X', i: {} } }, [cl], []);
  assert.deepEqual(pruned, { [C.groupKey(cl, m)]: { s: 'KID00001', i: {} } }, 'gone checklist dropped, gone item dropped');
  assert.deepEqual(C.pruneGroups(groups, [cl], [item]), groups);
  assert.equal(C.kidCardName('PRODUCT LAUNCHES ', 'Spring merch 24.11'), 'PRODUCT LAUNCHES / Spring merch 24.11');
  assert.equal(C.kidItemName('Approve with legal @maria_petrenko'), 'Approve with legal');
  assert.equal(C.kidItemName('Video 🔴 for screens @a_b @c_d'), '🔴 Video for screens', 'priority first, no mentions');
  assert.equal(C.kidItemName('🟠 Banner [3] @a_b', (n) => n.replace(/\s*\[3\]/, '')), '🟠 Banner', 'points text removed when asked');
});

test('checklist cards: ticks between the epic and the cards, the latest change wins', () => {
  const T = (h) => '2026-11-17T' + h + ':00:00.000Z';
  // nothing to do
  assert.equal(C.tickDecision(true, true, {}), null);
  assert.equal(C.tickDecision(false, false, {}), null);
  // everyone ticked their items -> the epic follows
  assert.equal(C.tickDecision(false, true, { kidTick: T('10') }), 'tick-epic');
  assert.equal(C.tickDecision(false, true, {}), 'tick-epic', 'no history: the cards win');
  // the epic was unticked by hand after the last tick in the cards -> the cards follow the epic
  assert.equal(C.tickDecision(false, true, { kidTick: T('10'), epicUntick: T('11') }), 'untick-kids');
  assert.equal(C.tickDecision(false, true, { kidTick: T('12'), epicUntick: T('11') }), 'tick-epic', 'ticked in the card again later');
  // someone unticked their item after the epic was ticked -> the epic reopens
  assert.equal(C.tickDecision(true, false, { epicTick: T('10'), kidUntick: T('11') }), 'untick-epic');
  assert.equal(C.tickDecision(true, false, { kidUntick: T('11') }), 'untick-epic', 'the epic tick is older than the history');
  // the epic was ticked by hand -> the open items in the cards are ticked too
  assert.equal(C.tickDecision(true, false, { epicTick: T('12'), kidUntick: T('11') }), 'tick-kids');
  assert.equal(C.tickDecision(true, false, { epicTick: T('12') }), 'tick-kids');
  assert.equal(C.tickDecision(true, false, {}), 'tick-kids');
  // our own copies never undo each other: after 'tick-kids' the cards have a newer tick, not an untick
  assert.equal(C.tickDecision(true, false, { epicTick: T('12'), kidTick: T('13'), kidUntick: T('11') }), 'tick-kids');
});

test('checklist cards: lastState finds both directions', () => {
  const tick = (id, state, date) => ({ date, data: { checkItem: { id, state } } });
  const a = [tick('i1', 'incomplete', 'b'), tick('i1', 'complete', 'a'), tick('i2', 'incomplete', '0')];
  assert.equal(C.lastState(a, 'i1', 'incomplete'), 'b');
  assert.equal(C.lastState(a, 'i1', 'complete'), 'a');
  assert.equal(C.lastState(a, 'i3', 'complete'), null);
});

test('checklist cards: groups + links of a big epic still fit in 4096 characters', () => {
  const groups = {}, links = {};
  // 4 checklists × 12 items, 2 people on every item, all in checklist cards, plus 20 separate TO DO cards
  for (let c = 0; c < 4; c++) {
    for (let m = 1; m <= 2; m++) {
      const g = groups[C.groupKey('cl' + String(c).padStart(22, '0'), 'm1aaaaaaaaaaaaaaaaaaaa0' + m)] = { s: 'AbCdEf' + c + m, i: {} };
      for (let i = 0; i < 12; i++) g.i[C.itemKey('5f12345678' + String(c * 100 + i).padStart(14, '0'))] = C.kidSuffix('ab' + String(c * 100 + i).padStart(22, '0'));
    }
  }
  for (let i = 0; i < 20; i++) links[C.linkKey('6f12345678' + String(i).padStart(14, '0'), 'm1aaaaaaaaaaaaaaaaaaaa01')] = 'AbCdEfGh';
  const size = JSON.stringify({ links, groups }).length;
  assert.ok(size < 4096, 'size ' + size);
});

test('checklist card name: the checklist priority goes after the last " / ", the rest stays', () => {
  assert.equal(C.withKidCardPriority('TEST EPIC / ZYN SDK - 26.11', 1), 'TEST EPIC / 🔴 ZYN SDK - 26.11');
  assert.equal(C.withKidCardPriority('TEST EPIC / 🟢 GUNIA merch (edited)', 2), 'TEST EPIC / 🟠 GUNIA merch (edited)');
  assert.equal(C.withKidCardPriority('🔴 Big epic / Spring', 3), '🔴 Big epic / 🟢 Spring', "the epic's own emoji is left alone");
  assert.equal(C.withKidCardPriority('Epic / 🟠 Spring', 0), 'Epic / Spring');
  assert.equal(C.withKidCardPriority('Renamed card', 1), '🔴 Renamed card');
  assert.equal(C.kidCardPriority('🔴 Big epic / Spring'), 0);
  assert.equal(C.kidCardPriority('Epic / 🟠 Spring'), 2);
});

test('item status: own status per item, Done list makes everything done', () => {
  assert.equal(C.itemStatus('L_done', { state: 'incomplete' }, false, ['L_done']), 'done');
  assert.equal(C.itemStatus('L_prog', { state: 'complete' }, true, ['L_done']), 'done');
  assert.equal(C.itemStatus('L_prog', { state: 'incomplete' }, true, ['L_done']), 'prog');
  assert.equal(C.itemStatus('L_prog', { state: 'incomplete' }, false, ['L_done']), 'todo', 'the card being in progress does not change other items');
  const lists = [{ id: 'a', name: 'Backlog' }, { id: 't', name: 'TO DO' }, { id: 'x', name: 'Review' }, { id: 'p', name: 'In progress' }, { id: 'd', name: 'Done' }];
  assert.equal(C.progressListId(lists, { todoListId: 't', doneListIds: ['d'] }), 'p');
  assert.equal(C.progressListId(lists.filter((l) => l.id !== 'p'), { todoListId: 't', doneListIds: ['d'] }), null, 'no column named so: none (not the next one by place)');
  const moved = [{ id: 'p', name: 'IN PROGRESS' }, { id: 'd', name: 'Done' }, { id: 'x', name: 'Review' }, { id: 't', name: 'TO DO' }];
  assert.equal(C.progressListId(moved, { todoListId: 't', doneListIds: ['d'] }), 'p', 'found by name wherever it stands');
  const many = [{ id: 'w', name: 'WIP' }, { id: 'p', name: 'In-progress' }, { id: 'u', name: 'В роботі' }];
  assert.equal(C.progressListId(many, {}), 'p', '"In progress" wins over other names');
  assert.equal(C.progressListId([{ id: 'u', name: 'В роботі' }], {}), 'u');
  assert.equal(C.progressListId([{ id: 'u', name: 'Doing' }], { doneListIds: ['u'] }), null, 'a Done list is never in progress');
});

test('status plan: one item in progress moves the card, the others keep their status', () => {
  const base = { todoListId: 'T', progListId: 'P', doneListIds: ['D'] };
  const items = [{ id: 'a', state: 'incomplete' }, { id: 'b', state: 'incomplete' }, { id: 'c', state: 'complete' }];
  let p = C.statusPlan(Object.assign({ listId: 'T', items, itemId: 'a', status: 'prog' }, base));
  assert.deepEqual(p.items.map((x) => [x.id, x.state, x.prog]), [['a', 'incomplete', true], ['b', 'incomplete', false], ['c', 'complete', false]]);
  assert.equal(p.moveTo, 'P');
  // already in progress: no move
  p = C.statusPlan(Object.assign({ listId: 'P', items: [{ id: 'a', state: 'incomplete', prog: true }, { id: 'b', state: 'incomplete' }], itemId: 'b', status: 'prog' }, base));
  assert.equal(p.moveTo, null);
  assert.deepEqual(p.items.map((x) => x.prog), [true, true]);
  // the last open item done -> Done
  p = C.statusPlan(Object.assign({ listId: 'P', items: [{ id: 'a', state: 'complete' }, { id: 'b', state: 'incomplete', prog: true }], itemId: 'b', status: 'done' }, base));
  assert.equal(p.moveTo, 'D');
  assert.deepEqual(p.items.map((x) => [x.state, x.prog]), [['complete', false], ['complete', false]]);
  // one of two done -> stays
  p = C.statusPlan(Object.assign({ listId: 'P', items: [{ id: 'a', state: 'incomplete' }, { id: 'b', state: 'incomplete' }], itemId: 'b', status: 'done' }, base));
  assert.equal(p.moveTo, null);
  // a card in Done: its items count as done; reopening one as TO DO ticks the others and brings the card back
  p = C.statusPlan(Object.assign({ listId: 'D', items: [{ id: 'a', state: 'incomplete' }, { id: 'b', state: 'incomplete' }], itemId: 'a', status: 'todo' }, base));
  assert.equal(p.moveTo, 'T');
  assert.deepEqual(p.items.map((x) => x.state), ['incomplete', 'complete']);
  p = C.statusPlan(Object.assign({ listId: 'D', items: [{ id: 'a', state: 'complete' }], itemId: 'a', status: 'prog' }, base));
  assert.equal(p.moveTo, 'P');
});

test('priority in cards made from an epic: item part, checklist part, description line', () => {
  assert.equal(C.withTodoCardItemPriority('New task 1 — 🟢 GUNIA merch', 1), '🔴 New task 1 — 🟢 GUNIA merch', "the checklist's emoji is not the item's");
  assert.equal(C.todoCardItemPriority('New task 1 — 🟢 GUNIA merch'), 0);
  assert.equal(C.withTodoCardItemPriority('🔴 New task (edited) — 🟢 GUNIA', 0), 'New task (edited) — 🟢 GUNIA');
  assert.equal(C.withTodoCardChecklistPriority('🔴 New task — 🟢 GUNIA merch', 2), '🔴 New task — 🟠 GUNIA merch');
  assert.equal(C.withTodoCardChecklistPriority('🔴 New task — GUNIA merch', 1), '🔴 New task — 🔴 GUNIA merch');
  assert.equal(C.todoCardChecklistPriority('Renamed card'), null);
  assert.equal(C.withTodoCardChecklistPriority('Renamed card', 1), 'Renamed card');
  const d = '[TEST EPIC](https://trello.com/c/69gU2eQC/191-test-epic) / 🟢 GUNIA merch 24.11\nnotes / more';
  assert.equal(C.descChecklistPriority(d), 3);
  assert.equal(C.withDescChecklistPriority(d, 1), '[TEST EPIC](https://trello.com/c/69gU2eQC/191-test-epic) / 🔴 GUNIA merch 24.11\nnotes / more');
  assert.equal(C.withDescChecklistPriority(d, 0), '[TEST EPIC](https://trello.com/c/69gU2eQC/191-test-epic) / GUNIA merch 24.11\nnotes / more');
  assert.equal(C.descChecklistPriority('my own notes / 🟢 x'), null);
  assert.equal(C.withDescChecklistPriority('my own notes / 🟢 x', 1), 'my own notes / 🟢 x');
});

test('sprints: list names, TO DO SP columns, order across the new year', () => {
  assert.equal(C.sprintNumber('SPRINT 48'), 48);
  assert.equal(C.sprintNumber('Спрінт 3'), 3);
  assert.equal(C.sprintNumber('TO DO SP48'), null, 'a TO DO column is not a sprint list');
  assert.equal(C.sprintNumber('TO DO'), null);
  assert.equal(C.sprintTodoNumber('TO DO SP48'), 48);
  assert.equal(C.sprintTodoNumber('To do sp 7'), 7);
  assert.equal(C.sprintTodoNumber('TODO SP12'), 12);
  assert.equal(C.sprintTodoNumber('TO DO'), null);
  assert.equal(C.sprintTodoName(49), 'TO DO SP49');
  assert.deepEqual(C.sprintOrder([48, 47]), [47, 48]);
  assert.deepEqual(C.sprintOrder([1, 52, 51]), [51, 52, 1], 'new year: 1 comes after 52');
  assert.deepEqual(C.sprintOrder([2, 1]), [1, 2]);
  const lists = [{ id: 's47', name: 'SPRINT 47' }, { id: 's48', name: 'SPRINT 48' }, { id: 't', name: 'TO DO' }, { id: 'p', name: 'IN PROGRESS' },
    { id: 'd', name: 'DONE' }, { id: 't48', name: 'TO DO SP48' }, { id: 't47', name: 'TO DO SP47' }];
  const cfg = { todoListId: 't', doneListIds: ['d'] };
  assert.deepEqual(C.todoColumns(lists, cfg).map((c) => c.id), ['t47', 't48']);
  assert.deepEqual(C.todoColumns(lists.filter((l) => !/SP/.test(l.name)), cfg).map((c) => c.id), ['t'], 'no SP columns: the TO DO list from settings');
  assert.ok(C.isTodoList(lists, cfg, 't48') && C.isTodoList(lists, cfg, 't') && !C.isTodoList(lists, cfg, 'p'));
  assert.equal(C.panelColumn(lists, cfg, null).col.id, 't48', 'the newest sprint by default');
  assert.equal(C.panelColumn(lists, cfg, { id: 't47', newest: 't48' }).col.id, 't47', 'an older one, picked while 48 was the newest');
  assert.equal(C.panelColumn(lists.concat([{ id: 't49', name: 'TO DO SP49' }]), cfg, { id: 't47', newest: 't48' }).col.id, 't49', 'a newer sprint appeared: back to the newest');
  assert.equal(C.progressListId(lists, cfg), 'p');
  const unnamed = [{ id: 't', name: 'TO DO' }, { id: 'r', name: 'Review' }, { id: 'd', name: 'DONE' }, { id: 't48', name: 'TO DO SP48' }];
  assert.equal(C.progressListId(unnamed, cfg), null, 'no column named "in progress": none');
  assert.equal(C.progressListId([{ id: 't48', name: 'TO DO SP48' }, { id: 'p', name: 'In progress' }], cfg), 'p');
});

test('priorities: ⚪ P4 low and ↪️ NS next sprint', () => {
  assert.equal(C.parsePriority('⚪ Banner'), 4);
  assert.equal(C.parsePriority('⚪️ Banner'), 4, 'with the variation selector too');
  assert.equal(C.parsePriority('↪️ Release notes'), 5);
  assert.equal(C.parsePriority('↪ Release notes'), 5, 'without the variation selector too');
  assert.equal(C.parsePriority('⏭️ Release notes'), 5, 'the first NS emoji (⏭) still counts');
  assert.equal(C.withPriority('⏭️ Release notes', 5), '↪️ Release notes', 'and becomes ↪️');
  assert.equal(C.withPriority('🔴 Release notes', 5), '↪️ Release notes');
  assert.equal(C.withPriority('↪ Release notes', 1), '🔴 Release notes', 'replaced as a whole');
  assert.equal(C.withPriority('↪️ Release notes', 0), 'Release notes');
  assert.equal(C.withPriority('Banner', 4), '⚪ Banner');
  const items = ['↪️ a', 'b', '⚪ c', '🟢 d', '🔴 e'].map((name, i) => ({ id: String(i), name }));
  assert.deepEqual(C.sortByPriority(items).map((x) => x.name), ['🔴 e', '🟢 d', '⚪ c', 'b', '↪️ a'], 'P1 … P4, none, NS last');
  assert.equal(C.todoCardName('↪️ Release notes @olga', 'ZYN SDK'), '↪️ Release notes — ZYN SDK');
});

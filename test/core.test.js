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

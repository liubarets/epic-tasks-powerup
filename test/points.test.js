// Run: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/points.js');

test('parse [n] from a title', () => {
  assert.equal(P.parse('[3] Banner'), 3);
  assert.equal(P.parse('[0.5] Fix footer'), 0.5);
  assert.equal(P.parse('[0,5] Fix footer'), 0.5, 'comma works too');
  assert.equal(P.parse('🔴 Video [13] for screens'), 13, 'anywhere in the title');
  assert.equal(P.parse('[5] 🔴 Video [3]'), 5, 'the first one counts');
  assert.equal(P.parse('Report [2025]'), null, 'a year is not points');
  assert.equal(P.parse('Plain title'), null);
});

test('parse (n) and {n} from a title: only a number inside counts', () => {
  assert.equal(P.parse('(3) Banner'), 3);
  assert.equal(P.parse('Banner (5)'), 5);
  assert.equal(P.parse('(0,5) Fix footer'), 0.5);
  assert.equal(P.parse('(1.5) Fix footer'), 1.5);
  assert.equal(P.parse('{8} Landing'), 8);
  assert.equal(P.parse('{0,5} Landing'), 0.5);
  assert.equal(P.parse('Banner (v2)'), null, 'text in brackets is not points');
  assert.equal(P.parse('Event (Lviv)'), null);
  assert.equal(P.parse('Promo (5 banners)'), null, 'a number with words is not points');
  assert.equal(P.parse('Report (2025)'), null, 'a year is not points');
  assert.equal(P.parse('Spring merch (24.11)'), null, 'a date in round brackets is not points');
  assert.equal(P.parse('Plan {24.11}'), null);
  assert.equal(P.parse('[5) mixed'), null, 'brackets must match');
  assert.equal(P.parse('Banner (v2) [3]'), 3, 'first real estimate counts');
  assert.equal(P.parse('(2) Banner [5]'), 2, 'the first one counts');
  assert.equal(P.parse('[24.11] square'), 24.11, 'square brackets keep their old rule');
});

test('strip [n] and tidy spaces', () => {
  assert.equal(P.strip('[5] 🔴 Video for entry screens — Spring merch 24.11'), '🔴 Video for entry screens — Spring merch 24.11');
  assert.equal(P.strip('Video [3] for screens'), 'Video for screens');
  assert.equal(P.strip('Video for screens [0,5]'), 'Video for screens');
  assert.equal(P.strip('No points'), 'No points');
  assert.equal(P.strip('[3]'), '');
  assert.equal(P.strip('(5) 🔴 Video for entry screens — Spring merch 24.11'), '🔴 Video for entry screens — Spring merch 24.11');
  assert.equal(P.strip('Video (3) for screens'), 'Video for screens');
  assert.equal(P.strip('Video {0,5}'), 'Video');
  assert.equal(P.strip('Banner (v2) (3)'), 'Banner (v2)', 'only the estimate goes, other brackets stay');
  assert.equal(P.strip('Merch (24.11)'), 'Merch (24.11)');
});

test('fmt', () => {
  assert.equal(P.fmt(57.5), '57.5');
  assert.equal(P.fmt(0.1 + 0.2), '0.3');
  assert.equal(P.fmt(3), '3');
});

const fields = [{ id: 'f_other', name: 'Effort', type: 'number' }, { id: 'f_sp', name: 'Story points', type: 'number' }];

test('find the field: saved id first, then by name', () => {
  assert.equal(P.findField(fields, {}).id, 'f_sp');
  assert.equal(P.findField(fields, { sp: { fieldId: 'f_other' } }).id, 'f_other');
  assert.equal(P.findField([{ id: 'x', name: 'Story points', type: 'text' }], {}), null, 'must be a number field');
  assert.equal(P.findField(undefined, {}), null);
  assert.deepEqual(P.findField([], { sp: { fieldId: 'f_new' } }), { id: 'f_new', name: 'Story points', type: 'number' },
    'a just-created field is trusted before Trello lists it');
  assert.equal(P.findField([], { sp: { fieldId: 'f_new' } }, true), null, 'strict: only real fields');
});

const item = (n) => [{ idCustomField: 'f_sp', value: { number: String(n) } }];

test('card points: field wins, title [n] is the fallback', () => {
  assert.equal(P.cardPoints({ name: 'X', customFieldItems: item(5) }, 'f_sp'), 5);
  assert.equal(P.cardPoints({ name: '[3] X', customFieldItems: item(5) }, 'f_sp'), 5);
  assert.equal(P.cardPoints({ name: '[3] X', customFieldItems: [] }, 'f_sp'), 3);
  assert.equal(P.cardPoints({ name: 'X', customFieldItems: [] }, 'f_sp'), null);
  assert.equal(P.cardPoints({ name: '[2] X' }, null), 2, 'no field yet');
});

test('summarize one list: total once per card, each member gets full points', () => {
  const cards = [
    { idList: 'todo', name: 'A', idMembers: ['m1'], customFieldItems: item(3) },
    { idList: 'todo', name: '[2] B', idMembers: ['m1', 'm2'] },
    { idList: 'todo', name: 'C', idMembers: [] , customFieldItems: item(0.5) },
    { idList: 'todo', name: 'D', members: [{ id: 'm2' }] },
    { idList: 'done', name: '[8] E', idMembers: ['m1'] },
    { idList: 'todo', name: '[8] archived', idMembers: ['m1'], closed: true },
  ];
  const s = P.summarize(cards, 'f_sp', 'todo');
  assert.equal(s.total, 5.5);
  assert.equal(s.cards, 4);
  assert.equal(s.none, 1);
  assert.deepEqual(s.by.m1, { points: 5, cards: 2, none: 0 });
  assert.deepEqual(s.by.m2, { points: 2, cards: 2, none: 1 });
  assert.deepEqual(s.by._none, { points: 0.5, cards: 1, none: 0 });
});

test('migrate does nothing without [n] or without the field', async () => {
  assert.equal(await P.migrate({}, { id: 'c1', name: 'Plain' }, 'f_sp'), false);
  assert.equal(await P.migrate({}, { id: 'c1', name: '[3] X' }, null), false);
});

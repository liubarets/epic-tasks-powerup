// Story points: the number lives in the Trello custom field "Story points".
// "[3]", "(3)" or "{3}" typed in a card title still works: it is moved into the field (see migrate()).
// Pure helpers are unit-tested in test/points.test.js; REST helpers need EpicAuth.
(function (root) {
  'use strict';

  var FIELD_NAME = 'Story points';
  // Only a number inside the brackets counts: 1–3 digits, optional fraction.
  //   [3] [0.5] [0,5] [13]      square brackets
  //   (3) (0,5) {3} {1.5}       round or curly brackets: one digit after the point at most,
  //                             because "(24.11)" in a title is a date, not 24.11 points
  // "(v2)", "(Lviv)", "[2025]" (a year) are not points.
  var RE = /\[(\d{1,3}(?:[.,]\d{1,2})?)\]|\((\d{1,3}(?:[.,]\d)?)\)|\{(\d{1,3}(?:[.,]\d)?)\}/;

  function parse(name) {
    var m = RE.exec(String(name || ''));
    return m ? parseFloat((m[1] || m[2] || m[3]).replace(',', '.')) : null;
  }

  // Removes the first "[n]" / "(n)" / "{n}" and tidies the spaces around it.
  function strip(name) {
    var s = String(name || ''), m = RE.exec(s);
    if (!m) return s;
    return (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim();
  }

  function fmt(x) { return String(Math.round(Number(x) * 100) / 100); }

  // The board's "Story points" number field: the one saved in settings, otherwise found by name.
  // Trello's in-browser copy of the board learns about a new field only after a while, so a saved id
  // is trusted even if the list doesn't have it yet (strict = only what the list really has).
  function findField(fields, cfg, strict) {
    fields = fields || [];
    var id = cfg && cfg.sp && cfg.sp.fieldId;
    var saved = id && fields.filter(function (f) { return f.id === id; })[0];
    if (saved) return saved;
    var byName = fields.filter(function (f) { return f.type === 'number' && /^\s*story\s*points?\s*$/i.test(f.name || ''); })[0];
    if (byName) return byName;
    return id && !strict ? { id: id, name: FIELD_NAME, type: 'number' } : null;
  }

  function fieldValue(card, fieldId) {
    if (!fieldId) return null;
    var items = (card && card.customFieldItems) || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.idCustomField !== fieldId || !it.value || it.value.number == null || it.value.number === '') continue;
      var v = parseFloat(it.value.number);
      return isNaN(v) ? null : v;
    }
    return null;
  }

  // The field wins; a title that still has "[n]" / "(n)" (not moved yet) counts too.
  function cardPoints(card, fieldId) {
    var v = fieldValue(card, fieldId);
    return v != null ? v : parse(card && card.name);
  }

  function memberIds(card) {
    if (card.idMembers) return card.idMembers.slice();
    return (card.members || []).map(function (m) { return m.id; });
  }

  // Sums for one list: total (every card once) and per member (a card with two members counts for both).
  // by['_none'] = cards without members.
  // Tasks in a card: its open checklist items, or the card itself when it has no checklist
  // (from the card's badges: checkItems / checkItemsChecked).
  function cardTasks(c) {
    var b = (c && c.badges) || {}, n = Number(b.checkItems) || 0;
    return n > 0 ? Math.max(0, n - (Number(b.checkItemsChecked) || 0)) : 1;
  }

  function summarize(cards, fieldId, listId) {
    var out = { total: 0, cards: 0, tasks: 0, none: 0, by: {} };
    (cards || []).forEach(function (c) {
      if (!c || c.closed || (listId && c.idList !== listId)) return;
      var v = cardPoints(c, fieldId), n = cardTasks(c);
      out.cards++;
      out.tasks += n;
      if (v == null) out.none++; else out.total += v;
      var ids = memberIds(c);
      if (!ids.length) ids = ['_none'];
      ids.forEach(function (id) {
        var b = out.by[id] || (out.by[id] = { points: 0, cards: 0, tasks: 0, none: 0 });
        b.cards++;
        b.tasks += n;
        if (v == null) b.none++; else b.points += v;
      });
    });
    return out;
  }

  function cardsWord(n) { return n + (n === 1 ? ' card' : ' cards'); }
  function tasksWord(n) { return n + (n === 1 ? ' task' : ' tasks'); }

  // ---- Points of checklist items ----
  // A card with a checklist is estimated item by item: Teamload data "pts" on that card holds
  // { last 8 characters of the item id: n }. The card's "Story points" field is the sum of its open items.
  var ITEM_KEY = 8;
  function itemKey(itemId) { return String(itemId).slice(-ITEM_KEY); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  // An item's points: the stored value, else "[n]" / "(n)" still in its text.
  function itemPoints(item, pts) {
    var k = itemKey(item.id);
    if (has(pts, k) && pts[k] != null && !isNaN(parseFloat(pts[k]))) return parseFloat(pts[k]);
    return parse(item.name);
  }

  function allItems(card) {
    var out = [];
    (card && card.checklists || []).forEach(function (cl) { (cl.checkItems || []).forEach(function (it) { out.push(it); }); });
    return out;
  }

  // Is the card estimated item by item? Yes once any of its items has points (stored or "[n]" in the text).
  function itemMode(card, pts) {
    return allItems(card).some(function (it) { return itemPoints(it, pts) != null; });
  }

  // The card's "Story points" from its items: the sum of open items.
  // Not estimated by items → undefined (the card keeps its own value); nothing open → 0;
  // open items but none of them estimated → null (the card counts as unestimated).
  function checklistField(card, pts) {
    if (!itemMode(card, pts)) return undefined;
    var open = allItems(card).filter(function (it) { return it.state !== 'complete'; });
    if (!open.length) return 0;
    var sum = 0, any = false;
    open.forEach(function (it) {
      var v = itemPoints(it, pts);
      if (v != null) { sum += v; any = true; }
    });
    return any ? Math.round(sum * 100) / 100 : null;
  }

  // Drops points of items that are no longer on the card.
  function prunePoints(pts, card) {
    var alive = {};
    allItems(card).forEach(function (it) { alive[itemKey(it.id)] = 1; });
    var out = {};
    Object.keys(pts || {}).forEach(function (k) { if (alive[k] && pts[k] != null) out[k] = pts[k]; });
    return out;
  }

  // ---- REST (needs the member's token) ----
  function api(t, method, path, params, body) { return root.EpicAuth.request(t, method, path, params, body); }

  function setValue(t, cardId, fieldId, value) {
    return api(t, 'PUT', '/cards/' + cardId + '/customField/' + fieldId + '/item', null,
      value == null ? { value: '' } : { value: { number: String(value) } });
  }

  function boardFields(t, boardId) { return api(t, 'GET', '/boards/' + boardId + '/customFields'); }

  // Reuses a "Story points" number field if the board already has one (no duplicates on a second click).
  function createField(t, boardId) {
    return boardFields(t, boardId).then(function (fields) {
      var found = findField(fields, null, true);
      return found || api(t, 'POST', '/customFields', null, {
        idModel: boardId, modelType: 'board', name: FIELD_NAME, type: 'number', pos: 'top', display_cardFront: false,
      });
    });
  }

  // "[3] Banner" → field = 3, title = "Banner". The value is saved first, so nothing is lost if renaming fails.
  function migrate(t, card, fieldId) {
    var v = parse(card.name);
    if (v == null || !fieldId) return Promise.resolve(false);
    var name = strip(card.name);
    return setValue(t, card.id, fieldId, v).then(function () {
      return name ? api(t, 'PUT', '/cards/' + card.id, { name: name }) : null;
    }).then(function () { return true; });
  }

  var P = {
    FIELD_NAME: FIELD_NAME,
    parse: parse,
    strip: strip,
    fmt: fmt,
    findField: findField,
    fieldValue: fieldValue,
    cardPoints: cardPoints,
    summarize: summarize,
    cardsWord: cardsWord,
    tasksWord: tasksWord,
    cardTasks: cardTasks,
    itemKey: itemKey,
    itemPoints: itemPoints,
    allItems: allItems,
    itemMode: itemMode,
    checklistField: checklistField,
    prunePoints: prunePoints,
    setValue: setValue,
    boardFields: boardFields,
    createField: createField,
    migrate: migrate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  else root.EpicPoints = P;
})(this);

// Pure logic, no Trello/DOM dependencies (unit-tested in test/core.test.js).
(function (root) {
  'use strict';

  var PRIORITIES = [
    { level: 1, emoji: '🔴', short: 'P1', title: 'Urgent' },
    { level: 2, emoji: '🟠', short: 'P2', title: 'Important' },
    { level: 3, emoji: '🟢', short: 'P3', title: 'Can wait' },
  ];
  // The priority emoji can stand anywhere in a name (people edit titles, e.g. "[5] 🟢 Video"),
  // so it is looked up and replaced where it is. The first one counts.
  var PRIO_RE = /(🔴|🟠|🟢)\ufe0f?/u;
  // @username: Trello usernames = letters, digits, underscore. Must follow start/space/bracket
  // so e-mails like a@b.com are not treated as mentions.
  var MENTION_RE = /(^|[\s(,;])@([A-Za-z0-9_]{2,})/g;

  function byLevel(level) {
    for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].level === level) return PRIORITIES[i];
    return null;
  }

  function parsePriority(name) {
    var m = PRIO_RE.exec(String(name || ''));
    if (!m) return 0;
    for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].emoji === m[1]) return PRIORITIES[i].level;
    return 0;
  }

  // Removes the priority emoji wherever it is, keeping the text around it tidy.
  function stripPriority(name) {
    var s = String(name || '');
    var m = PRIO_RE.exec(s);
    if (!m) return s;
    var before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
    if (!before.trim()) return after.replace(/^\s+/, '');
    if (!after.trim()) return before.replace(/\s+$/, '');
    return before.replace(/\s+$/, '') + ' ' + after.replace(/^\s+/, '');
  }

  // Sets the priority: replaces the existing emoji in place, or puts a new one at the start.
  function withPriority(name, level) {
    var s = String(name || '');
    var p = byLevel(Number(level));
    var m = PRIO_RE.exec(s);
    if (m) return p ? s.slice(0, m.index) + p.emoji + s.slice(m.index + m[0].length) : stripPriority(s);
    return p ? p.emoji + ' ' + s : s;
  }

  function parseMentions(name) {
    var out = [];
    var re = new RegExp(MENTION_RE.source, 'g');
    var m;
    while ((m = re.exec(String(name || ''))) !== null) {
      var u = m[2].toLowerCase();
      if (out.indexOf(u) === -1) out.push(u);
    }
    return out;
  }

  function cleanTitle(name) {
    return stripPriority(name)
      .replace(new RegExp(MENTION_RE.source, 'g'), '$1')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .trim();
  }

  // Returns [{id, username, fullName, unknown}] — mentioned users first, then the
  // native checklist assignee (idMember) if it was not mentioned.
  function resolveAssignees(item, boardMembers) {
    var byUser = {}, byId = {};
    (boardMembers || []).forEach(function (m) {
      if (m.username) byUser[m.username.toLowerCase()] = m;
      byId[m.id] = m;
    });
    var out = [], seen = {};
    parseMentions(item.name).forEach(function (u) {
      var m = byUser[u];
      if (m) {
        if (!seen[m.id]) { seen[m.id] = 1; out.push({ id: m.id, username: m.username, fullName: m.fullName, unknown: false }); }
      } else {
        out.push({ id: null, username: u, fullName: u, unknown: true });
      }
    });
    if (item.idMember && !seen[item.idMember]) {
      var mm = byId[item.idMember];
      out.push({ id: item.idMember, username: mm ? mm.username : 'member', fullName: mm ? mm.fullName : '', unknown: !mm });
    }
    return out;
  }

  // Everyone who works on the item: mentioned/native assignees plus board members who took it
  // via "Assign to me" (they have a linked TO DO card but are not mentioned in the item text).
  function allAssignees(item, boardMembers, links) {
    var out = resolveAssignees(item, boardMembers);
    (boardMembers || []).forEach(function (m) {
      if (out.some(function (a) { return a.id === m.id; })) return;
      if (links && links[linkKey(item.id, m.id)]) {
        out.push({ id: m.id, username: m.username, fullName: m.fullName, unknown: false, taken: true });
      }
    });
    return out;
  }

  // Stable sort: P1, P2, P3, then items without priority; ties keep current order.
  function sortByPriority(items) {
    return items
      .map(function (it, idx) { return { it: it, idx: idx, l: parsePriority(it.name) || 99 }; })
      .sort(function (a, b) { return a.l - b.l || a.idx - b.idx; })
      .map(function (x) { return x.it; });
  }

  function sameOrder(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
    return true;
  }

  // Compact key to fit Trello's 4096-char pluginData limit.
  function linkKey(itemId, memberId) {
    return String(itemId).slice(-10) + ':' + String(memberId).slice(-8);
  }

  // Remove links of checklist items that no longer exist on the card.
  function pruneLinks(links, existingItemIds) {
    var alive = {};
    existingItemIds.forEach(function (id) { alive[String(id).slice(-10)] = 1; });
    var out = {};
    Object.keys(links || {}).forEach(function (k) {
      if (alive[k.split(':')[0]]) out[k] = links[k];
    });
    return out;
  }

  // Only a card that sits in a "Done" list counts as done. Archiving keeps the card's list,
  // so a card archived from Done is still done, while one archived from TO DO is not.
  function isCardDone(card, doneListIds) {
    if (!card) return false;
    return (doneListIds || []).indexOf(card.idList) !== -1;
  }

  // Archived without ever reaching a Done list = cancelled: treated as if there were no card.
  function isCardCancelled(card, doneListIds) {
    return !!(card && card.closed && !isCardDone(card, doneListIds));
  }

  // A linked TO DO card still counts for a person only while it exists, isn't cancelled and
  // the person is still a member of it. Otherwise the item is back to "＋ TO DO" for them.
  function isLinkAlive(card, memberId, doneListIds) {
    return !!card && !isCardCancelled(card, doneListIds) && (card.idMembers || []).indexOf(memberId) !== -1;
  }

  // When the item last got the given state ('complete' / 'incomplete'), from a card's
  // "updateCheckItemStateOnCard" actions (newest first, as Trello returns them). ISO date string or null.
  function lastState(actions, itemId, state) {
    var list = actions || [];
    for (var i = 0; i < list.length; i++) {
      var ci = list[i].data && list[i].data.checkItem;
      if (ci && ci.id === itemId && ci.state === state) return list[i].date;
    }
    return null;
  }

  // When the item was last ticked in the epic. ISO date string or null.
  function lastTicked(epicActions, itemId) { return lastState(epicActions, itemId, 'complete'); }

  // When the card last left a Done list for a list outside Done, from its "updateCard:idList"
  // actions (newest first). ISO date string or null.
  function lastLeftDone(cardActions, doneListIds) {
    var done = doneListIds || [];
    var list = cardActions || [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i].data || {};
      var from = d.listBefore && d.listBefore.id, to = d.listAfter && d.listAfter.id;
      if (done.indexOf(from) !== -1 && done.indexOf(to) === -1) return list[i].date;
    }
    return null;
  }

  // A ticked item is reopened when one of its cards left Done after the item was ticked.
  // If someone ticks the item again by hand after that, it stays ticked.
  function shouldReopen(tickedAt, leftDoneAt) {
    return !!leftDoneAt && (!tickedAt || leftDoneAt > tickedAt);
  }

  function todoCardName(itemName, checklistName) {
    var level = parsePriority(itemName);
    var title = cleanTitle(itemName);
    var name = checklistName ? title + ' — ' + checklistName : title;
    return level ? withPriority(name, level) : name;
  }

  // TO DO card description: "[Epic name](epic url) / Checklist name".
  function todoCardDesc(epic, checklistName) {
    var title = String(epic.name || '').replace(/([[\]\\])/g, '\\$1');
    return '[' + title + '](' + epic.url + ') / ' + checklistName;
  }

  function byPos(a, b) { return (a.pos || 0) - (b.pos || 0); }

  // ---- "One card per checklist × person" (checklist cards) ----
  // Power-Up data "groups" on the epic: { groupKey(checklist, person): { s: shortLink of their checklist card,
  //   i: { itemKey(epic item): last 8 characters of the id of the item in that card } } }.
  // Separate TO DO cards stay in "links"; an item × person is never in both (see todo.js).
  var KID_SUFFIX = 8;

  function itemKey(itemId) { return String(itemId).slice(-10); }

  function kidSuffix(kidItemId) { return String(kidItemId).slice(-KID_SUFFIX); }

  // The item in a checklist card (matched by the end of its id).
  function findKidItem(checklists, suffix) {
    if (!suffix) return null;
    for (var i = 0; i < (checklists || []).length; i++) {
      var items = checklists[i].checkItems || [];
      for (var j = 0; j < items.length; j++) {
        if (String(items[j].id).slice(-KID_SUFFIX) === suffix) return items[j];
      }
    }
    return null;
  }

  // Key of a checklist × person → their checklist card (Power-Up data "groups" on the epic).
  function groupKey(checklistId, memberId) { return String(checklistId).slice(-10) + ':' + String(memberId).slice(-8); }

  // Where an item × person sits in a checklist card: { shortLink, suffix } or null.
  function kidEntry(groups, checklistId, memberId, itemId) {
    var g = (groups || {})[groupKey(checklistId, memberId)];
    var suffix = g && g.i && g.i[itemKey(itemId)];
    return suffix ? { shortLink: g.s, suffix: suffix } : null;
  }

  // Drops groups of checklists that are gone and entries of items that are gone.
  function pruneGroups(groups, existingChecklistIds, existingItemIds) {
    var cls = {}, items = {};
    existingChecklistIds.forEach(function (id) { cls[String(id).slice(-10)] = 1; });
    existingItemIds.forEach(function (id) { items[itemKey(id)] = 1; });
    var out = {};
    Object.keys(groups || {}).forEach(function (k) {
      var g = groups[k];
      if (!g || !cls[k.split(':')[0]]) return;
      var i = {};
      Object.keys(g.i || {}).forEach(function (ik) { if (items[ik]) i[ik] = g.i[ik]; });
      out[k] = { s: g.s, i: i };
    });
    return out;
  }

  // Checklist card name: "Epic name / Checklist name".
  function kidCardName(epicName, checklistName) {
    return String(epicName || '').trim() + ' / ' + String(checklistName || '').trim();
  }

  // An item as it appears in a checklist card: the priority emoji first, no @mentions.
  // stripPoints (optional) removes "[n]" / "(n)": in the card, points live in Teamload data.
  function kidItemName(itemName, stripPoints) {
    var level = parsePriority(itemName);
    var title = cleanTitle(itemName);
    if (stripPoints) title = stripPoints(title);
    return level ? withPriority(title, level) : title;
  }

  // Ticks between the epic and the checklist cards: the latest change wins.
  //   epicDone  — the item is ticked in the epic;
  //   allDone   — every assignee is done (their item in a checklist card is ticked, or their TO DO card is in Done);
  //   h         — when things last happened (ISO strings or null):
  //               epicTick / epicUntick: the item in the epic; kidTick / kidUntick: its items in checklist cards.
  // Returns 'tick-epic' | 'untick-epic' | 'tick-kids' | 'untick-kids' | null.
  // Our own copies (ticking the cards after a tick in the epic, or the other way round) are changes in the
  // same direction, so they never undo each other.
  function tickDecision(epicDone, allDone, h) {
    h = h || {};
    if (epicDone === allDone) return null;
    if (!epicDone) {
      // Everyone ticked it in their cards; the epic was unticked by hand after that → the cards follow the epic.
      if (h.epicUntick && (!h.kidTick || h.epicUntick > h.kidTick)) return 'untick-kids';
      return 'tick-epic';
    }
    // Someone unticked their item after the epic was ticked → the epic reopens.
    if (h.kidUntick && (!h.epicTick || h.kidUntick > h.epicTick)) return 'untick-epic';
    // The epic was ticked by hand → the open items in the cards are ticked too.
    return 'tick-kids';
  }

  // The priority of a checklist card "Epic / Checklist" follows the checklist's priority: the emoji is set
  // in the part after the last " / " (so an emoji in the epic's name is left alone); the rest of the name,
  // which people may have edited, stays as it is.
  function withKidCardPriority(cardName, level) {
    var s = String(cardName || '');
    var i = s.lastIndexOf(' / ');
    if (i === -1) return withPriority(s, level);
    return s.slice(0, i + 3) + withPriority(s.slice(i + 3), level);
  }
  function kidCardPriority(cardName) {
    var s = String(cardName || '');
    var i = s.lastIndexOf(' / ');
    return parsePriority(i === -1 ? s : s.slice(i + 3));
  }

  // A separate TO DO card "🔴 Item — Checklist": the item's priority lives before the last " — ",
  // the checklist's after it. Only the emoji changes; the rest of the name stays as it is.
  function splitTodoName(name) {
    var s = String(name || ''), i = s.lastIndexOf(' — ');
    return i === -1 ? { head: s, tail: null } : { head: s.slice(0, i), tail: s.slice(i + 3) };
  }
  function todoCardItemPriority(name) { return parsePriority(splitTodoName(name).head); }
  function withTodoCardItemPriority(name, level) {
    var p = splitTodoName(name);
    return withPriority(p.head, level) + (p.tail === null ? '' : ' — ' + p.tail);
  }
  // null when the name has no checklist part.
  function todoCardChecklistPriority(name) {
    var p = splitTodoName(name);
    return p.tail === null ? null : parsePriority(p.tail);
  }
  function withTodoCardChecklistPriority(name, level) {
    var p = splitTodoName(name);
    return p.tail === null ? String(name || '') : p.head + ' — ' + withPriority(p.tail, level);
  }

  // The first line of a card made from an epic: "[Epic](https://trello.com/c/…) / Checklist". Its checklist
  // priority follows the epic; the rest of the description is left alone. null when the line isn't ours.
  var DESC_RE = /^\[[^\n]*\]\(https:\/\/trello\.com\/c\/[^)]*\) \/ /;
  function descChecklistPriority(desc) {
    var first = String(desc || '').split('\n')[0];
    return DESC_RE.test(first) ? kidCardPriority(first) : null;
  }
  function withDescChecklistPriority(desc, level) {
    var lines = String(desc || '').split('\n');
    if (!DESC_RE.test(lines[0])) return String(desc || '');
    lines[0] = withKidCardPriority(lines[0], level);
    return lines.join('\n');
  }

  // ---- Status of an item (TO DO / IN PROGRESS / DONE) ----

  // The "in progress" list: the board's list between the TO DO list and the first Done list
  // (preferring one named like "progress" / "doing"); null when the board has none.
  function progressListId(lists, cfg) {
    var ls = lists || [], done = (cfg && cfg.doneListIds) || [], todo = cfg && cfg.todoListId;
    var ti = -1, di = ls.length;
    ls.forEach(function (l, i) { if (l.id === todo) ti = i; });
    ls.forEach(function (l, i) { if (done.indexOf(l.id) !== -1 && i > ti && i < di) di = i; });
    var between = ti === -1 ? [] : ls.slice(ti + 1, di).filter(function (l) { return done.indexOf(l.id) === -1; });
    var named = function (l) { return /progress|doing|в робот|в процес/i.test(l.name || ''); };
    var pick = between.filter(named)[0] || between[0] ||
      ls.filter(function (l) { return named(l) && l.id !== todo && done.indexOf(l.id) === -1; })[0];
    return pick ? pick.id : null;
  }

  // An item in a card with a checklist has its own status: DONE when ticked (or when the whole card is in a
  // Done list), IN PROGRESS when marked so (Teamload data "st" on the card), else TO DO.
  function itemStatus(cardListId, item, inProgress, doneListIds) {
    if ((doneListIds || []).indexOf(cardListId) !== -1 || (item && item.state === 'complete')) return 'done';
    return inProgress ? 'prog' : 'todo';
  }

  // What changes when one item of a card with a checklist gets a new status. Other items keep theirs
  // (in a card that sits in Done they all count as done, so they get ticked).
  //   o = { listId, items: [{ id, state, prog }], itemId, status: 'todo'|'prog'|'done', todoListId, progListId, doneListIds }
  // Returns { items: [{ id, state, prog }] (all items, after the change), moveTo: list id or null }.
  // The card moves: to IN PROGRESS when an item starts and the card is in TO DO or Done; to Done when every
  // item is done; back to TO DO when an item of a card in Done is reopened as TO DO.
  function statusPlan(o) {
    var done = o.doneListIds || [], inDone = done.indexOf(o.listId) !== -1;
    var items = (o.items || []).map(function (it) {
      if (it.id === o.itemId) return { id: it.id, state: o.status === 'done' ? 'complete' : 'incomplete', prog: o.status === 'prog' };
      return { id: it.id, state: inDone ? 'complete' : it.state, prog: inDone || it.state === 'complete' ? false : !!it.prog };
    });
    var moveTo = null;
    if (o.status === 'done') {
      if (items.length && items.every(function (it) { return it.state === 'complete'; }) && !inDone) moveTo = done[0] || null;
    } else if (o.status === 'prog') {
      if (inDone || o.listId === o.todoListId) moveTo = o.progListId || null;
    } else if (inDone) {
      moveTo = o.todoListId || null;
    }
    if (moveTo === o.listId) moveTo = null;
    return { items: items, moveTo: moveTo };
  }

  var Core = {
    PRIORITIES: PRIORITIES,
    byLevel: byLevel,
    parsePriority: parsePriority,
    stripPriority: stripPriority,
    withPriority: withPriority,
    parseMentions: parseMentions,
    cleanTitle: cleanTitle,
    resolveAssignees: resolveAssignees,
    allAssignees: allAssignees,
    sortByPriority: sortByPriority,
    sameOrder: sameOrder,
    linkKey: linkKey,
    pruneLinks: pruneLinks,
    isCardDone: isCardDone,
    isCardCancelled: isCardCancelled,
    isLinkAlive: isLinkAlive,
    lastState: lastState,
    lastTicked: lastTicked,
    lastLeftDone: lastLeftDone,
    shouldReopen: shouldReopen,
    todoCardName: todoCardName,
    todoCardDesc: todoCardDesc,
    byPos: byPos,
    itemKey: itemKey,
    kidSuffix: kidSuffix,
    findKidItem: findKidItem,
    groupKey: groupKey,
    kidEntry: kidEntry,
    pruneGroups: pruneGroups,
    kidCardName: kidCardName,
    kidItemName: kidItemName,
    tickDecision: tickDecision,
    withKidCardPriority: withKidCardPriority,
    kidCardPriority: kidCardPriority,
    todoCardItemPriority: todoCardItemPriority,
    withTodoCardItemPriority: withTodoCardItemPriority,
    todoCardChecklistPriority: todoCardChecklistPriority,
    withTodoCardChecklistPriority: withTodoCardChecklistPriority,
    descChecklistPriority: descChecklistPriority,
    withDescChecklistPriority: withDescChecklistPriority,
    progressListId: progressListId,
    itemStatus: itemStatus,
    statusPlan: statusPlan,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.EpicCore = Core;
})(this);

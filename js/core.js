// Pure logic, no Trello/DOM dependencies (unit-tested in test/core.test.js).
(function (root) {
  'use strict';

  var PRIORITIES = [
    { level: 1, emoji: '🔴', short: 'P1', title: 'Urgent' },
    { level: 2, emoji: '🟠', short: 'P2', title: 'Important' },
    { level: 3, emoji: '🟢', short: 'P3', title: 'Can wait' },
  ];
  var PRIO_RE = /^\s*(🔴|🟠|🟢)️?\s*/u;
  // @username: Trello usernames = letters, digits, underscore. Must follow start/space/bracket
  // so e-mails like a@b.com are not treated as mentions.
  var MENTION_RE = /(^|[\s(,;])@([A-Za-z0-9_]{2,})/g;

  function byLevel(level) {
    for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].level === level) return PRIORITIES[i];
    return null;
  }

  function parsePriority(name) {
    var m = String(name || '').match(PRIO_RE);
    if (!m) return 0;
    for (var i = 0; i < PRIORITIES.length; i++) if (PRIORITIES[i].emoji === m[1]) return PRIORITIES[i].level;
    return 0;
  }

  function stripPriority(name) {
    return String(name || '').replace(PRIO_RE, '');
  }

  function withPriority(name, level) {
    var base = stripPriority(name);
    var p = byLevel(Number(level));
    return p ? p.emoji + ' ' + base : base;
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

  // Keeps epic items in step with their TO DO cards. `items`: [{ id, state, people }], where every
  // person (a board-member assignee) has done: true (card in Done), false (live card outside Done)
  // or null (no live card). `tracked`: keys of items seen complete with all their cards in Done.
  // - An open item whose people all have cards in Done is ticked (and tracked).
  // - A tracked item with a card that was moved out of Done again is unticked.
  // - Items ticked by hand while their cards were still open are never tracked, so they are left alone.
  function planItemSync(items, tracked) {
    var was = {};
    (tracked || []).forEach(function (k) { was[k] = 1; });
    var out = { tick: [], untick: [], tracked: [] };
    (items || []).forEach(function (it) {
      var k = String(it.id).slice(-10);
      var people = it.people || [];
      var allDone = people.length > 0 && people.every(function (p) { return p.done === true; });
      var reopened = people.some(function (p) { return p.done === false; });
      if (it.state === 'complete') {
        if (was[k] && reopened) out.untick.push(it.id);
        else if (was[k] || allDone) out.tracked.push(k);
      } else if (allDone) {
        out.tick.push(it.id);
        out.tracked.push(k);
      }
    });
    return out;
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
    planItemSync: planItemSync,
    todoCardName: todoCardName,
    todoCardDesc: todoCardDesc,
    byPos: byPos,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.EpicCore = Core;
})(this);

// Pure logic, no Trello/DOM dependencies (unit-tested in test/core.test.js).
(function (root) {
  'use strict';

  var PRIORITIES = [
    { level: 1, emoji: '🔴', short: 'P1', title: 'Терміново', labelName: 'P1 🔴', color: 'red' },
    { level: 2, emoji: '🟠', short: 'P2', title: 'Важливо', labelName: 'P2 🟠', color: 'orange' },
    { level: 3, emoji: '🟢', short: 'P3', title: 'Може почекати', labelName: 'P3 🟢', color: 'green' },
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

  function isCardDone(card, doneListIds) {
    if (!card) return false;
    return !!(card.closed || card.dueComplete || (doneListIds || []).indexOf(card.idList) !== -1);
  }

  function todoCardName(itemName, checklistName) {
    var level = parsePriority(itemName);
    var title = cleanTitle(itemName);
    var name = checklistName ? title + ' — ' + checklistName : title;
    return level ? withPriority(name, level) : name;
  }

  function todoCardDesc(epic, checklistName, itemName) {
    return [
      '**Епік:** [' + epic.name + '](' + epic.url + ')',
      '**Чек-лист:** ' + checklistName,
      '**Задача:** ' + cleanTitle(itemName),
      '',
      '_Створено Power-Up «Epic Tasks». Пункт лишився в епіку._',
    ].join('\n');
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
    sortByPriority: sortByPriority,
    sameOrder: sameOrder,
    linkKey: linkKey,
    pruneLinks: pruneLinks,
    isCardDone: isCardDone,
    todoCardName: todoCardName,
    todoCardDesc: todoCardDesc,
    byPos: byPos,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.EpicCore = Core;
})(this);

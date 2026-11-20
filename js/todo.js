/* global EpicCore, EpicAuth */
// Shared "TO DO cards" logic: loading the epic, link validity, creating cards.
// Used by the card-back section (section.js) and by the "Add all to TO DO" header button (client.js).
(function (root) {
  'use strict';
  var Core = root.EpicCore;

  function api(t, method, path, params) { return root.EpicAuth.request(t, method, path, params); }
  function P() { return root.EpicPoints; }

  // Teamload data on the epic ("links" and "groups" in card/shared): Trello keeps at most 4096 characters
  // for all of it, so a write that would not fit is refused with a clear message instead of failing half-way.
  var LIMIT = 4096;
  function fullError() {
    return new Error('This epic has no room left for Teamload data (Trello allows 4096 characters per card). ' +
      'Split the epic or remove finished checklists.');
  }
  function setShared(t, key, value) {
    var keys = ['links', 'groups'];
    return Promise.all(keys.map(function (k) { return k === key ? value : t.get('card', 'shared', k, {}); })).then(function (vals) {
      var all = {};
      keys.forEach(function (k, i) { all[k] = vals[i]; });
      if (JSON.stringify(all).length > LIMIT - 100) throw fullError();
      return t.set('card', 'shared', key, value);
    }).catch(function (e) {
      if (e && /PluginData length/i.test(e.message || '')) throw fullError();
      throw e;
    });
  }

  // GET /batch for up to 10 routes per request; commas inside a route must be encoded.
  // Resolves with the responses in the same order (null for failed ones).
  function batch(t, routes) {
    var out = [];
    var chunks = [];
    for (var i = 0; i < routes.length; i += 10) chunks.push(i);
    return Promise.all(chunks.map(function (start) {
      var part = routes.slice(start, start + 10);
      return api(t, 'GET', '/batch', { urls: part.join(',') }).then(function (res) {
        part.forEach(function (r, j) { var x = res && res[j]; out[start + j] = (x && x['200']) || null; });
      });
    })).then(function () { return out; });
  }

  function q(params) {
    return '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  }

  // Linked TO DO cards, only the fields the Power-Up needs (≈10× less data than full cards).
  function fetchCards(t, shortLinks) {
    var routes = shortLinks.map(function (s) { return '/cards/' + s + q({ fields: 'name,idList,closed,idMembers' }); });
    return batch(t, routes).then(function (res) {
      var out = {};
      shortLinks.forEach(function (s, i) { out[s] = res[i]; });
      return out;
    });
  }

  // List moves of several cards in one request: [[actions of card 1], [actions of card 2], …].
  function moveHistory(t, cardIds) {
    return batch(t, cardIds.map(function (id) {
      return '/cards/' + id + '/actions' + q({ filter: 'updateCard:idList', limit: 50, fields: 'date,data' });
    })).then(function (res) { return res.map(function (r) { return r || []; }); });
  }

  // People's checklist cards ("one card per checklist × person"), with their checklists and custom fields.
  function fetchKids(t, shortLinks) {
    var routes = shortLinks.map(function (s) {
      return '/cards/' + s + q({ fields: 'name,idList,closed,idMembers,shortLink', checklists: 'all', checklist_fields: 'name,pos', customFieldItems: 'true' });
    });
    return batch(t, routes).then(function (res) {
      var out = {};
      shortLinks.forEach(function (s, i) {
        var c = res[i];
        if (c) {
          (c.checklists || []).sort(Core.byPos);
          (c.checklists || []).forEach(function (cl) { (cl.checkItems || []).sort(Core.byPos); });
        }
        out[s] = c;
      });
      return out;
    });
  }

  function unique(list) { return list.filter(function (v, i, a) { return v && a.indexOf(v) === i; }); }

  // Everything needed to render the section or add cards: the epic, its checklists,
  // board members and lists, settings, item → card links and the linked cards themselves.
  function load(t) {
    return Promise.all([
      t.card('id', 'name', 'url', 'shortLink'),
      t.board('id', 'members', 'customFields'),
      t.member('id', 'username', 'fullName'),
      t.lists('id', 'name'),
      t.get('board', 'shared', 'cfg', {}),
      t.get('card', 'shared', 'links', {}),
      t.get('card', 'shared', 'groups', {}),
    ]).then(function (r) {
      var cfg = r[4] || {};
      // The TO DO list never counts as done, even if it was ticked under "Done lists" in older settings.
      cfg.doneListIds = (cfg.doneListIds || []).filter(function (id) { return id !== cfg.todoListId; });
      var d = { card: r[0], board: r[1], me: r[2], lists: r[3], cfg: cfg, links: r[5] || {}, groups: r[6] || {} };
      d.field = cfg.sp && cfg.sp.on && P() ? P().findField((r[1] || {}).customFields, cfg) : null;
      d.listName = {};
      d.lists.forEach(function (l) { d.listName[l.id] = l.name; });
      var shortLinks = unique(Object.keys(d.links).map(function (k) { return d.links[k]; }));
      var kidLinks = unique(Object.keys(d.groups).map(function (k) { return d.groups[k] && d.groups[k].s; }));
      // All requests at once: the links are already known from the Power-Up data.
      return Promise.all([
        api(t, 'GET', '/cards/' + d.card.id + '/checklists', {
          checkItems: 'all',
          checkItem_fields: 'name,state,pos,due,idMember',
          fields: 'name,pos',
        }),
        fetchCards(t, shortLinks),
        kidLinks.length ? fetchKids(t, kidLinks) : {},
      ]).then(function (res) {
        var checklists = res[0];
        checklists.sort(Core.byPos);
        checklists.forEach(function (cl) { cl.checkItems.sort(Core.byPos); });
        d.checklists = checklists;
        d.linked = res[1];
        d.kids = res[2];
        d.alive = aliveLinks(d);
        return d;
      });
    });
  }

  // A link counts only while its card exists, isn't cancelled (archived outside Done) and the
  // person is still a member of the card. Otherwise the item is "＋ TO DO" for them again.
  function linkedCard(d, itemId, memberId) {
    var sl = d.links[Core.linkKey(itemId, memberId)];
    var c = sl ? d.linked[sl] || null : null;
    return Core.isLinkAlive(c, memberId, d.cfg.doneListIds) ? c : null;
  }

  // Where an item × person is:
  //   { kind: 'card', card }             a separate TO DO card (Power-Up data "links");
  //   { kind: 'kid', card, item }        an item in their checklist card (Power-Up data "groups");
  //   null                               nowhere yet (or the card is gone, cancelled, or they left it).
  function linkInfo(d, itemId, memberId) {
    var c = linkedCard(d, itemId, memberId);
    if (c) return { kind: 'card', card: c };
    var f = findItem(d, itemId);
    var e = f && Core.kidEntry(d.groups, f.checklist.id, memberId, itemId);
    var k = e && (d.kids || {})[e.shortLink];
    if (!k || !Core.isLinkAlive(k, memberId, d.cfg.doneListIds)) return null;
    var it = Core.findKidItem(k.checklists, e.suffix);
    return it ? { kind: 'kid', card: k, item: it } : null;
  }

  // Links that are still alive, separate cards and checklist cards alike. "Assign to me" takers are
  // derived from these, so someone who removed themselves from the card is no longer shown on the item.
  function aliveLinks(d) {
    var out = {};
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (it) {
        (d.board.members || []).forEach(function (m) {
          var k = Core.linkKey(it.id, m.id);
          if (linkInfo(d, it.id, m.id)) out[k] = d.links[k] || 'checklist card';
        });
      });
    });
    return out;
  }

  // The person's checklist card for this checklist, if new items can still go there:
  // it exists, isn't archived or in a Done list, and the person is still on it.
  function groupCard(d, checklistId, memberId) {
    var g = d.groups[Core.groupKey(checklistId, memberId)];
    var c = g && (d.kids || {})[g.s];
    if (!c || c.closed || Core.isCardDone(c, d.cfg.doneListIds) || (c.idMembers || []).indexOf(memberId) === -1) return null;
    return c;
  }

  function findItem(d, itemId) {
    for (var i = 0; i < d.checklists.length; i++) {
      var cl = d.checklists[i];
      for (var j = 0; j < cl.checkItems.length; j++) {
        if (cl.checkItems[j].id === itemId) return { item: cl.checkItems[j], checklist: cl };
      }
    }
    return null;
  }

  // Open items × board-member assignees of one checklist that have no card yet (neither a separate
  // TO DO card nor an item in their checklist card).
  function pendingInChecklist(d, cl) {
    var out = [];
    cl.checkItems.forEach(function (it) {
      if (it.state === 'complete') return;
      Core.allAssignees(it, d.board.members, d.alive).forEach(function (a) {
        if (!a.unknown && !linkInfo(d, it.id, a.id)) out.push({ item: it, checklist: cl, memberId: a.id });
      });
    });
    return out;
  }

  // "＋ My cards": the open items of this checklist where the person is an assignee and that have no card yet.
  function myPending(d, cl, memberId) {
    return pendingInChecklist(d, cl).filter(function (j) { return j.memberId === memberId; });
  }

  function todoListError(d) {
    return d.cfg.todoListId ? null : new Error('Choose the TO DO list in settings (⚙) first.');
  }

  function itemIds(d) {
    var ids = [];
    d.checklists.forEach(function (cl) { cl.checkItems.forEach(function (it) { ids.push(it.id); }); });
    return ids;
  }

  function saveLinks(t, d, newLinks) {
    if (!Object.keys(newLinks).length) return Promise.resolve();
    // Re-read right before writing to reduce clobbering when two people click at once.
    return t.get('card', 'shared', 'links', {}).then(function (links) {
      Object.keys(newLinks).forEach(function (k) { links[k] = newLinks[k]; });
      links = Core.pruneLinks(links, itemIds(d));
      d.links = links;
      return setShared(t, 'links', links);
    });
  }

  // Records items added to a person's checklist card: groups[checklist × person] = { s: card, i: { item: suffix } }.
  // A new card for the same checklist × person replaces the old one (that one is done, archived or left).
  // filling: true when the card has just been created and its items are about to be added (other sessions
  // then leave it alone), false when they are in.
  function saveGroup(t, d, gk, shortLink, entries, filling) {
    return t.get('card', 'shared', 'groups', {}).then(function (groups) {
      var g = groups[gk];
      if (!g || g.s !== shortLink) g = { s: shortLink, i: {} };
      Object.keys(entries || {}).forEach(function (k) { g.i[k] = entries[k]; });
      if (filling) g.f = Date.now();
      else if (filling === false) delete g.f;
      groups[gk] = g;
      groups = Core.pruneGroups(groups, d.checklists.map(function (cl) { return cl.id; }), itemIds(d));
      d.groups = groups;
      return setShared(t, 'groups', groups);
    });
  }

  // Creates one TO DO card for (item, member); resolves with its shortLink.
  // The link to the epic is attached in the same request (urlSource); a separate call is only a fallback.
  function createTodoCard(t, d, item, checklist, memberId, pos) {
    return api(t, 'POST', '/cards', {
      idList: d.cfg.todoListId,
      name: Core.todoCardName(item.name, checklist.name),
      desc: Core.todoCardDesc(d.card, checklist.name),
      idMembers: memberId,
      due: item.due || undefined,
      pos: pos != null ? pos : (d.cfg.position === 'bottom' ? 'bottom' : 'top'),
      urlSource: d.card.url,
    }).then(function (created) {
      if (created.badges && created.badges.attachments > 0) return created.shortLink;
      return api(t, 'POST', '/cards/' + created.id + '/attachments', { url: d.card.url, name: d.card.name })
        .catch(function () { /* link back is nice-to-have */ })
        .then(function () { return created.shortLink; });
    });
  }

  // Positions for n new cards that keep the checklist order in the TO DO list even when the cards
  // are created in parallel. Resolves with null if the list can't be read (then cards go one by one).
  function positionsFor(t, d, n) {
    return api(t, 'GET', '/lists/' + d.cfg.todoListId + '/cards', { fields: 'pos' }).then(function (cards) {
      var ps = (cards || []).map(function (c) { return Number(c.pos); }).filter(function (p) { return p > 0; });
      var out = [];
      for (var i = 0; i < n; i++) {
        if (d.cfg.position === 'bottom') out.push((ps.length ? Math.max.apply(null, ps) : 0) + 65536 * (i + 1));
        else out.push((ps.length ? Math.min.apply(null, ps) : 65536 * (n + 1)) * (i + 1) / (n + 1));
      }
      return out;
    }, function () { return null; });
  }

  function addToTodo(t, d, itemId, memberId) {
    var f = findItem(d, itemId);
    if (!f) return Promise.reject(new Error('Item not found. Refresh the block (⟳).'));
    var err = todoListError(d);
    if (err) return Promise.reject(err);
    return createTodoCard(t, d, f.item, f.checklist, memberId).then(function (shortLink) {
      var nl = {};
      nl[Core.linkKey(itemId, memberId)] = shortLink;
      return saveLinks(t, d, nl);
    });
  }

  // Menu entries for "Add all to TO DO": one per checklist that has something to add, plus
  // "All tasks" when more than one does. [{ key: 'all' | checklistId, text, jobs }]
  function addAllOptions(d) {
    var groups = d.checklists
      .map(function (cl) { return { key: cl.id, text: cl.name, jobs: pendingInChecklist(d, cl) }; })
      .filter(function (g) { return g.jobs.length; });
    if (groups.length > 1) {
      var all = [];
      groups.forEach(function (g) { all = all.concat(g.jobs); });
      groups.unshift({ key: 'all', text: 'All tasks', jobs: all });
    }
    return groups;
  }

  // Jobs for a menu choice, recomputed from fresh data ("all" also works when only one checklist is left).
  function jobsFor(d, key) {
    var opts = addAllOptions(d);
    var hit = opts.filter(function (o) { return o.key === key; })[0];
    if (!hit && key === 'all' && opts.length === 1) hit = opts[0];
    return hit ? hit.jobs : [];
  }

  // Creates cards for a list of jobs from pendingInChecklist(); resolves with the number created.
  // Up to 3 cards are created at a time; onProgress(done, total) is called after every card.
  function addMany(t, d, jobs, onProgress) {
    var err = todoListError(d);
    if (err) return Promise.reject(err);
    if (!jobs.length) return Promise.resolve(0);
    var unsaved = {};
    var saving = Promise.resolve();
    var n = 0;
    // Link saves run one after another, so parallel cards don't overwrite each other's links.
    function flush() {
      var nl = unsaved;
      unsaved = {};
      saving = saving.then(function () { return saveLinks(t, d, nl); });
      return saving;
    }
    return positionsFor(t, d, jobs.length).then(function (pos) {
      var list = jobs.slice();
      var width = 3;
      if (!pos) {
        // No positions: one by one; with "top" placement in reverse to keep the checklist order.
        width = 1;
        if (d.cfg.position !== 'bottom') list.reverse();
      }
      var next = 0;
      var failed = null;
      function worker() {
        if (failed || next >= list.length) return Promise.resolve();
        var i = next++;
        var j = list[i];
        return createTodoCard(t, d, j.item, j.checklist, j.memberId, pos ? pos[i] : null).then(function (shortLink) {
          unsaved[Core.linkKey(j.item.id, j.memberId)] = shortLink;
          n++;
          if (onProgress) onProgress(n, list.length);
          // Save links in small batches, so nothing is lost if the board is closed half-way.
          if (n % 5 === 0) flush();
          return worker();
        }, function (e) { failed = failed || e; });
      }
      var workers = [];
      for (var w = 0; w < Math.min(width, list.length); w++) workers.push(worker());
      return Promise.all(workers).then(function () {
        return flush().then(function () {
          if (failed) throw failed;
          return n;
        });
      });
    });
  }

  // ---- "One card per checklist × person" (checklist cards) ----

  // Creates the person's checklist card for this checklist: "Epic / Checklist" in the TO DO list, the person
  // as its member, the epic in its description. It is recorded and marked at once, so a second click adds to it.
  function createKidCard(t, d, cl, memberId, pos) {
    return api(t, 'POST', '/cards', {
      idList: d.cfg.todoListId,
      name: Core.kidCardName(d.card.name, cl.name),
      desc: Core.todoCardDesc(d.card, cl.name),
      idMembers: memberId,
      pos: pos != null ? pos : (d.cfg.position === 'bottom' ? 'bottom' : 'top'),
      urlSource: d.card.url,
    }).then(function (created) {
      var c = { id: created.id, shortLink: created.shortLink, name: created.name, idList: d.cfg.todoListId,
        closed: false, idMembers: [memberId], checklists: [], customFieldItems: [] };
      d.kids = d.kids || {};
      d.kids[c.shortLink] = c;
      var attach = created.badges && created.badges.attachments > 0 ? null
        : api(t, 'POST', '/cards/' + created.id + '/attachments', { url: d.card.url, name: d.card.name }).catch(function () {});
      return Promise.all([
        attach,
        // The card knows its epic: its TASKS section is not shown and it is estimated item by item.
        Promise.resolve(t.set(c.id, 'shared', 'kid', d.card.id)).catch(function () {}),
        saveGroup(t, d, Core.groupKey(cl.id, memberId), c.shortLink, {}, true),
      ]).then(function () { return c; });
    });
  }

  // The checklist in a person's card that takes the epic's items: the one named like the epic's checklist,
  // else the first one, else a new one.
  function kidChecklist(t, card, cl) {
    var list = (card.checklists || []).filter(function (x) { return x.name === cl.name; })[0] || (card.checklists || [])[0];
    if (list) return Promise.resolve(list);
    return api(t, 'POST', '/cards/' + card.id + '/checklists', { name: cl.name }).then(function (x) {
      x.checkItems = [];
      card.checklists = (card.checklists || []).concat([x]);
      return x;
    });
  }

  // Sets a card's "Story points" field from its items, when it is estimated item by item.
  function updateCardField(t, d, card) {
    if (!d.field || !P()) return Promise.resolve();
    return Promise.resolve(t.get(card.id, 'shared', 'pts', {})).then(function (pts) {
      var v = P().checklistField(card, pts || {});
      if (v === undefined || v === P().fieldValue(card, d.field.id)) return null;
      return P().setValue(t, card.id, d.field.id, v).then(function () {
        card.customFieldItems = (card.customFieldItems || []).filter(function (x) { return x.idCustomField !== d.field.id; });
        if (v != null) card.customFieldItems.push({ idCustomField: d.field.id, value: { number: String(v) } });
      });
    }).catch(function () { /* the board's connector tries again when the card changes */ });
  }

  // Adds items to the person's checklist card for this checklist, creating the card if they have none
  // (or theirs is done, archived or left). job = { checklist, memberId, items }. Resolves with the card.
  // Items go one by one, so they keep the epic's order; what was added is recorded even if a later step fails.
  // onProgress(done, total): creating the card is one step, every item another.
  function addToKid(t, d, job, pos, onProgress) {
    var cl = job.checklist, gk = Core.groupKey(cl.id, job.memberId);
    var card = groupCard(d, cl.id, job.memberId);
    var entries = {}, points = {}, failed = null, taken = {};
    var done = 0, total = job.items.length + (card ? 0 : 1);
    function step() { done++; if (onProgress) onProgress(done, total); }
    if (onProgress) onProgress(0, total);
    return (card ? Promise.resolve(card) : createKidCard(t, d, cl, job.memberId, pos).then(function (c) { step(); return c; })).then(function (c) {
      card = c;
      // Someone else (or another tab) may have just added some of these items: skip what is already recorded,
      // and read the card's checklists afresh.
      return Promise.all([
        t.get('card', 'shared', 'groups', {}),
        api(t, 'GET', '/cards/' + card.id + '/checklists', { checkItems: 'all', checkItem_fields: 'name,state,pos,due', fields: 'name,pos' })
          .catch(function () { return null; }),
      ]).then(function (r) {
        var g = (r[0] || {})[gk];
        var have = g && g.s === card.shortLink ? g.i || {} : {};
        if (r[1]) card.checklists = r[1];
        job = { checklist: cl, memberId: job.memberId, items: job.items.filter(function (it) { return !have[Core.itemKey(it.id)]; }) };
        total = done + job.items.length;
        if (onProgress) onProgress(done, total);
        taken = {};
        Object.keys(have).forEach(function (k) { taken[have[k]] = true; });
        return kidChecklist(t, card, cl);
      });
    }).then(function (list) {
      return job.items.reduce(function (p, it) {
        return p.then(function () {
          if (failed) return null;
          var strip = P() ? P().strip : null;
          // An item with this name already in the card and not linked to anything (added a moment ago by
          // another session, or by hand): link it instead of adding a second one.
          var name = Core.kidItemName(it.name, strip);
          var same = (list.checkItems || []).filter(function (ci) { return ci.name === name && !taken[Core.kidSuffix(ci.id)]; })[0];
          if (same) {
            taken[Core.kidSuffix(same.id)] = true;
            entries[Core.itemKey(it.id)] = Core.kidSuffix(same.id);
            var pv = P() ? P().parse(it.name) : null;
            if (pv != null) points[P().itemKey(same.id)] = pv;
            step();
            return null;
          }
          return api(t, 'POST', '/checklists/' + list.id + '/checkItems', {
            name: Core.kidItemName(it.name, strip), pos: 'bottom', due: it.due || undefined,
          }).then(function (ci) {
            list.checkItems.push({ id: ci.id, name: ci.name, state: 'incomplete', pos: ci.pos, due: ci.due || null });
            taken[Core.kidSuffix(ci.id)] = true;
            entries[Core.itemKey(it.id)] = Core.kidSuffix(ci.id);
            // "[3]" in the epic item: the person's item starts with these points.
            var v = P() ? P().parse(it.name) : null;
            if (v != null) points[P().itemKey(ci.id)] = v;
            step();
          }, function (e) { failed = e; });
        });
      }, Promise.resolve());
    }).then(function () {
      return saveGroup(t, d, gk, card.shortLink, entries, false);
    }).then(function () {
      if (!Object.keys(points).length) return null;
      return Promise.resolve(t.get(card.id, 'shared', 'pts', {})).then(function (pts) {
        Object.keys(points).forEach(function (k) { pts[k] = points[k]; });
        return t.set(card.id, 'shared', 'pts', pts);
      }).catch(function () {});
    }).then(function () {
      return updateCardField(t, d, card);
    }).then(function () {
      if (failed) throw failed;
      return card;
    });
  }

  // "＋ My cards → One card with a checklist".
  function addMyChecklistCard(t, d, checklistId, onProgress) {
    var err = todoListError(d);
    if (err) return Promise.reject(err);
    var cl = d.checklists.filter(function (x) { return x.id === checklistId; })[0];
    var items = cl ? myPending(d, cl, d.me.id).map(function (j) { return j.item; }) : [];
    if (!items.length) return Promise.resolve(null);
    return addToKid(t, d, { checklist: cl, memberId: d.me.id, items: items }, undefined, onProgress);
  }

  // "＋ My cards → A card for each item".
  function addMySeparateCards(t, d, checklistId, onProgress) {
    var cl = d.checklists.filter(function (x) { return x.id === checklistId; })[0];
    return addMany(t, d, cl ? myPending(d, cl, d.me.id) : [], onProgress);
  }

  // ---- Keeping the epic and the cards in step (runs when someone opens the epic) ----

  // A new item for a person who has a checklist card for its checklist goes into that card.
  function appendNewItems(t, d) {
    var jobs = [], now = Date.now();
    d.checklists.forEach(function (cl) {
      var by = {};
      pendingInChecklist(d, cl).forEach(function (j) {
        if (!groupCard(d, cl.id, j.memberId)) return;
        // Its first items are being added right now (here or in another session): leave it to that job.
        if (Core.isFilling(d.groups[Core.groupKey(cl.id, j.memberId)], now)) return;
        (by[j.memberId] = by[j.memberId] || { checklist: cl, memberId: j.memberId, items: [] }).items.push(j.item);
      });
      Object.keys(by).forEach(function (m) { jobs.push(by[m]); });
    });
    // One person after another: each step rewrites the epic's "groups".
    return jobs.reduce(function (p, job) { return p.then(function () { return addToKid(t, d, job); }); }, Promise.resolve())
      .then(function () { if (jobs.length) d.alive = aliveLinks(d); return jobs.length; });
  }

  // The name, priority and due date of an item in the epic are copied into people's checklist cards.
  // Edits made in the cards are not copied back.
  function syncKidItems(t, d) {
    var jobs = [];
    var strip = P() ? P().strip : null;
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (it) {
        (d.board.members || []).forEach(function (m) {
          var info = linkInfo(d, it.id, m.id);
          if (!info || info.kind !== 'kid') return;
          var params = {}, name = Core.kidItemName(it.name, strip);
          if (name && info.item.name !== name) params.name = name;
          if (it.due && info.item.due !== it.due) params.due = it.due;
          if (!Object.keys(params).length) return;
          Object.keys(params).forEach(function (k) { info.item[k] = params[k]; });
          jobs.push(api(t, 'PUT', '/cards/' + info.card.id + '/checkItem/' + info.item.id, params));
        });
      });
    });
    return Promise.all(jobs);
  }

  function latest(dates) { return dates.filter(Boolean).sort().pop() || null; }

  // Ticks between the epic and the cards. For items with a checklist card: the latest change wins
  // (see Core.tickDecision). For items with separate cards only: as before — an item whose cards are
  // all in Done is ticked; a ticked item reopens when one of its cards left Done after the item was ticked.
  // Resolves with the checklist cards whose items were ticked or unticked here.
  function syncStates(t, d) {
    if (d.cfg.autoComplete === false) return Promise.resolve([]);
    var done = d.cfg.doneListIds;
    var jobs = [], touched = {};
    var plain = [];   // ticked items with separate cards outside Done: [{ item, cards }]
    var mixed = [];   // items with a checklist card whose state differs: [{ item, kids, cards, allDone }]
    function setEpic(it, state) {
      it.state = state;
      jobs.push(api(t, 'PUT', '/cards/' + d.card.id + '/checkItem/' + it.id, { state: state }));
    }
    function setKid(info, state) {
      if (info.item.state === state) return;
      info.item.state = state;
      touched[info.card.shortLink] = info.card;
      jobs.push(api(t, 'PUT', '/cards/' + info.card.id + '/checkItem/' + info.item.id, { state: state }));
    }
    d.checklists.forEach(function (cl) {
      cl.checkItems.forEach(function (it) {
        var infos = Core.allAssignees(it, d.board.members, d.alive)
          .filter(function (a) { return !a.unknown; })
          .map(function (a) { return linkInfo(d, it.id, a.id); });
        var kids = infos.filter(function (i) { return i && i.kind === 'kid'; });
        if (!kids.length) {
          var cards = infos.map(function (i) { return i ? i.card : null; });
          if (it.state !== 'complete') {
            if (cards.length && cards.every(function (c) { return Core.isCardDone(c, done); })) setEpic(it, 'complete');
            return;
          }
          var open = cards.filter(function (c) { return c && !Core.isCardDone(c, done); });
          if (open.length) plain.push({ item: it, cards: open });
          return;
        }
        var allDone = infos.every(function (i) {
          return i && (i.kind === 'kid' ? i.item.state === 'complete' : Core.isCardDone(i.card, done));
        });
        if ((it.state === 'complete') === allDone) return;
        mixed.push({ item: it, kids: kids, allDone: allDone, cards: infos.filter(function (i) {
          return i && i.kind === 'card' && !Core.isCardDone(i.card, done);
        }).map(function (i) { return i.card; }) });
      });
    });
    if (!plain.length && !mixed.length) return Promise.all(jobs).then(function () { return []; });

    // The epic's ticks: one request. With checklist cards involved, the whole recent history is needed.
    var epicActs = null;
    function epicHistory(since) {
      if (!epicActs) {
        var p = { filter: 'updateCheckItemStateOnCard', limit: 1000, fields: 'date,data' };
        if (since && !mixed.length) p.since = since;
        epicActs = api(t, 'GET', '/cards/' + d.card.id + '/actions', p);
      }
      return epicActs;
    }

    // Separate cards: when did they last leave Done? One batched request for all of them.
    var sepCards = [];
    plain.concat(mixed).forEach(function (x) { x.cards.forEach(function (c) { if (sepCards.indexOf(c) === -1) sepCards.push(c); }); });
    var leftAt = {};
    var kidCards = [];
    mixed.forEach(function (x) { x.kids.forEach(function (k) { if (kidCards.indexOf(k.card) === -1) kidCards.push(k.card); }); });
    var kidActs = {};

    return Promise.all([
      sepCards.length ? moveHistory(t, sepCards.map(function (c) { return c.id; })) : [],
      kidCards.length ? batch(t, kidCards.map(function (c) {
        return '/cards/' + c.id + '/actions' + q({ filter: 'updateCheckItemStateOnCard', limit: 200, fields: 'date,data' });
      })) : [],
    ]).then(function (r) {
      sepCards.forEach(function (c, i) { leftAt[c.id] = Core.lastLeftDone(r[0][i], done); });
      kidCards.forEach(function (c, i) { kidActs[c.id] = r[1][i] || []; });
      // Plain items: reopen only if one of their cards left Done after the item was ticked.
      var moved = plain.filter(function (x) { return x.cards.some(function (c) { return leftAt[c.id]; }); });
      if (!moved.length && !mixed.length) return null;  // nothing to reopen, no need for the epic's history
      var since = moved.map(function (x) {
        return x.cards.map(function (c) { return leftAt[c.id]; }).filter(Boolean).sort()[0];
      }).sort()[0];
      return epicHistory(since).then(function (ticks) {
        moved.forEach(function (x) {
          var tickedAt = Core.lastTicked(ticks, x.item.id);
          if (x.cards.some(function (c) { return Core.shouldReopen(tickedAt, leftAt[c.id]); })) setEpic(x.item, 'incomplete');
        });
        mixed.forEach(function (x) {
          var h = {
            epicTick: Core.lastState(ticks, x.item.id, 'complete'),
            epicUntick: Core.lastState(ticks, x.item.id, 'incomplete'),
            kidTick: latest(x.kids.map(function (k) { return Core.lastState(kidActs[k.card.id], k.item.id, 'complete'); })),
            kidUntick: latest(x.kids.map(function (k) { return Core.lastState(kidActs[k.card.id], k.item.id, 'incomplete'); })),
          };
          var epicDone = x.item.state === 'complete';
          var dec = Core.tickDecision(epicDone, x.allDone, h);
          // A separate card that left Done after the tick reopens the item too.
          if (epicDone && !x.allDone && x.cards.some(function (c) { return Core.shouldReopen(h.epicTick, leftAt[c.id]); })) dec = 'untick-epic';
          if (dec === 'tick-epic') setEpic(x.item, 'complete');
          else if (dec === 'untick-epic') setEpic(x.item, 'incomplete');
          else if (dec === 'tick-kids') x.kids.forEach(function (k) { setKid(k, 'complete'); });
          else if (dec === 'untick-kids') x.kids.forEach(function (k) { setKid(k, 'incomplete'); });
        });
      });
    }).then(function () {
      return Promise.all(jobs);
    }).then(function () {
      return Object.keys(touched).map(function (k) { return touched[k]; });
    });
  }

  // Everything that keeps the epic and the cards in step, in order: new items into people's cards,
  // names and dates into the cards, ticks both ways, and the points of cards whose items changed.
  function sync(t, d) {
    return appendNewItems(t, d).then(function () {
      return syncKidItems(t, d);
    }).then(function () {
      return syncStates(t, d);
    }).then(function (changed) {
      return Promise.all((changed || []).map(function (c) { return updateCardField(t, d, c); }));
    });
  }

  root.EpicTodo = {
    api: api,
    batch: batch,
    moveHistory: moveHistory,
    load: load,
    linkedCard: linkedCard,
    linkInfo: linkInfo,
    groupCard: groupCard,
    findItem: findItem,
    pendingInChecklist: pendingInChecklist,
    myPending: myPending,
    addMyChecklistCard: addMyChecklistCard,
    addMySeparateCards: addMySeparateCards,
    updateCardField: updateCardField,
    sync: sync,
    todoListError: todoListError,
    addToTodo: addToTodo,
    addMany: addMany,
    addAllOptions: addAllOptions,
    jobsFor: jobsFor,
  };
})(this);

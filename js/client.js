/* global TrelloPowerUp, EpicAuth, EpicTodo, EpicPoints */
// Iframe connector: tells Trello which capabilities this Power-Up provides.
// It stays loaded while the board is open, so it also finishes work handed over by the TASKS section:
// priority changes and sorting go on even if the epic is closed at once.
(function () {
  'use strict';
  var ICON = new URL('./img/icon-gray.svg', window.location.href).href;
  var me = Math.random().toString(36).slice(2);  // this connector (another board tab has its own)
  var lastT = null;   // any recent context: REST calls only need the member's token
  var queue = Promise.resolve();
  var channel = null;
  // The channel's old name stays: renaming it would break sections still open on the old code.
  try { channel = new BroadcastChannel('epic-tasks-addall'); } catch (e) { channel = null; }

  function post(msg) {
    if (!channel) return;
    msg.from = me;
    channel.postMessage(msg);
  }

  // REST calls handed over by the TASKS section (priority changes, sorting), so they finish even if
  // the epic is closed right away. Run one after another, in the order they were made.
  function runOps(m) {
    var t = lastT;
    post({ type: 'ops-ack', id: m.id });
    queue = queue.then(function () {
      return m.ops.reduce(function (p, op) {
        return p.then(function () { return EpicTodo.api(t, op.method, op.path, op.params); });
      }, Promise.resolve());
    }).then(function () {
      post({ type: 'ops-done', id: m.id });
    }, function (e) {
      var msg = (e && e.message) || String(e);
      post({ type: 'ops-done', id: m.id, error: msg });
      return Promise.resolve(t.alert({ message: 'Teamload: ' + msg, display: 'error', duration: 10 })).catch(function () {});
    });
  }

  if (channel) {
    channel.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === 'ops' && lastT && m.ops && m.ops.length) runOps(m);
    };
  }

  // ---- Story points ----
  var P = window.EpicPoints;
  var SP_ICON = new URL('./img/teamload-icon.svg', window.location.href).href;  // the Teamload icon: a white ⚡ on blue
  var BOLT = new URL('./img/bolt.svg', window.location.href).href;
  var spCache = null, spAt = 0;

  // Settings + the field id, cached for a few seconds: card-badges asks once per card.
  function spCfg(t) {
    if (spCache && Date.now() - spAt < 3000) return spCache;
    spAt = Date.now();
    spCache = Promise.all([t.get('board', 'shared', 'cfg', {}), t.board('customFields'), t.lists('id', 'name')]).then(function (r) {
      var cfg = r[0] || {}, sp = cfg.sp || {};
      var f = P.findField((r[1] || {}).customFields, cfg);
      // Every TO DO list: the one from settings and the sprints' "TO DO SP<n>" columns.
      var todoIds = window.EpicCore.todoColumns(r[2] || [], cfg).map(function (c) { return c.id; });
      if (cfg.todoListId && todoIds.indexOf(cfg.todoListId) === -1) todoIds.push(cfg.todoListId);
      return { on: !!sp.on, migrate: !!sp.migrate && !!f, fieldId: f ? f.id : null, todoListId: cfg.todoListId, todoIds: todoIds,
        lists: r[2] || [], cfg: cfg };
    }).catch(function () { return { on: false }; });
    return spCache;
  }

  // "[3] Banner" typed in a title → field = 3, title = "Banner". Runs in the session of anyone who
  // connected Teamload; one card at a time. Several open sessions doing the same card is harmless.
  var moving = {};
  var moveQueue = Promise.resolve();
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function maybeMove(t, card, c) {
    if (!c.migrate || P.parse(card.name) == null || moving[card.id]) return;
    moving[card.id] = true;
    moveQueue = moveQueue.then(function () {
      return EpicAuth.isAuthorized(t);
    }).then(function (ok) {
      return ok ? P.migrate(t, card, c.fieldId) : false;
    }).catch(function () { /* next render tries again */ }).then(function () {
      setTimeout(function () { delete moving[card.id]; }, 10000);
      return wait(150);
    });
  }

  // The SP button opens the story points panel at the bottom of the board. The panel stays open while you
  // work and reopens by itself next time you open the board, until you close it.
  var autoTried = false;
  function openBar(t) {
    return t.boardBar({
      url: './spbar.html', height: 36, title: 'Story points',
      callback: function () { return Promise.resolve(t.set('member', 'private', 'spBar', false)).catch(function () {}); },
    });
  }
  function spPopup(t) {
    var bar = openBar(t);
    Promise.resolve(t.set('member', 'private', 'spBar', true)).catch(function () {});
    return bar;
  }
  // A card with a checklist that is estimated item by item ("pts" in its Teamload data): its "Story points"
  // field is the sum of its open items. Trello redraws a card's badges when the card changes (an item ticked,
  // added or removed), so the field follows at once while anyone who connected Teamload has the board open.
  var fieldQueue = Promise.resolve();
  var settingField = {};
  // The card's checklists from Trello's REST API (t.card('checklists') returns none on a real board),
  // cached per card and state (number of items and ticks): Trello asks for badges often, and a new item or
  // tick makes a new key. A minute at most, for the rare change that keeps both numbers (one tick, one untick).
  var listCache = {};
  function checklistsOf(t, card) {
    var b = card.badges || {};
    var key = card.id + ':' + b.checkItems + ':' + b.checkItemsChecked;
    var hit = listCache[key];
    if (hit && Date.now() - hit.at < 60000) return hit.p;
    Object.keys(listCache).forEach(function (k) { if (k.indexOf(card.id + ':') === 0) delete listCache[k]; });
    var p = EpicAuth.isAuthorized(t).then(function (ok) {
      if (!ok) return null;
      return EpicAuth.request(t, 'GET', '/cards/' + card.id + '/checklists', {
        checkItems: 'all', checkItem_fields: 'name,state,pos', fields: 'name,pos',
      });
    });
    listCache[key] = { at: Date.now(), p: p };
    // Not connected yet, or the request failed: ask again next time.
    var forget = function () { if (listCache[key] && listCache[key].p === p) delete listCache[key]; };
    p.then(function (v) { if (v == null) forget(); }, forget);
    return p;
  }
  function itemsValue(t, card) {
    if (!(card.badges || {}).checkItems) return Promise.resolve(undefined);
    return Promise.resolve(t.get('card', 'shared', 'pts', {})).then(function (pts) {
      if (!pts || !Object.keys(pts).length) return undefined;
      return checklistsOf(t, card).then(function (lists) {
        return lists ? P.checklistField({ checklists: lists }, pts) : undefined;
      });
    }).catch(function () { return undefined; });
  }
  function maybeSetField(t, card, c, v) {
    if (!c.fieldId || v === undefined || v === P.fieldValue(card, c.fieldId)) return;
    var key = card.id + ':' + v;
    if (settingField[key]) return;
    settingField[key] = true;
    fieldQueue = fieldQueue.then(function () {
      return EpicAuth.isAuthorized(t);
    }).then(function (ok) {
      return ok ? P.setValue(t, card.id, c.fieldId, v) : null;
    }).catch(function () { /* next render tries again */ }).then(function () {
      setTimeout(function () { delete settingField[key]; }, 10000);
      return wait(150);
    });
  }

  function autoOpen(t) {
    if (autoTried) return;
    autoTried = true;
    Promise.resolve(t.get('member', 'private', 'spBar')).then(function (on) { return on ? openBar(t) : null; }).catch(function () {});
  }

  TrelloPowerUp.initialize({
    // Header button "SP" with the Teamload icon (the same on light and dark headers). Short text keeps the header compact.
    // The numbers live in the panel, which updates by itself; Trello would refresh this button only on page reload.
    'board-buttons': function (t) {
      return spCfg(t).then(function (c) {
        if (!c.on) return [];
        autoOpen(t);
        return [{ icon: { dark: SP_ICON, light: SP_ICON }, text: 'SP', callback: spPopup }];
      });
    },

    'card-badges': function (t) {
      return spCfg(t).then(function (c) {
        return t.card('id', 'name', 'idList', 'customFieldItems', 'badges').then(function (card) {
          // Moved out of Done with every item still ticked: "⚠ Statuses" (whether story points are on or not).
          var b = card.badges || {};
          var warn = c.cfg && window.EpicCore.leftDoneTicked({ listId: card.idList, lists: c.lists, cfg: c.cfg, total: b.checkItems, checked: b.checkItemsChecked })
            ? [{ text: '⚠ Statuses', color: 'yellow', title: 'Moved out of Done, but every task is still marked DONE' }] : [];
          if (!c.on) return warn;
          maybeMove(t, card, c);
          return itemsValue(t, card).then(function (items) {
            maybeSetField(t, card, c, items);
            var v = items !== undefined ? items : P.cardPoints(card, c.fieldId);
            if (v != null) return [{ text: P.fmt(v), icon: BOLT, color: 'blue' }].concat(warn);
            return ((c.todoIds || []).indexOf(card.idList) !== -1 ? [{ text: '?', icon: BOLT, color: 'yellow' }] : []).concat(warn);
          });
        });
      });
    },

    'card-detail-badges': function (t) {
      return spCfg(t).then(function (c) {
        if (!c.on) return [];
        return t.card('id', 'name', 'customFieldItems', 'badges').then(function (card) {
          return itemsValue(t, card).then(function (items) {
            // Estimated item by item: the badge shows the sum; the popup says where to set the points.
            var byItems = items !== undefined;
            var v = byItems ? items : P.cardPoints(card, c.fieldId);
            return [{
              title: 'Story points',
              text: v == null ? (byItems ? '?' : 'Add') : P.fmt(v),
              color: v == null ? null : 'blue',
              callback: function (tt) {
                return tt.popup({ title: 'Story points', url: './spedit.html', args: { items: byItems ? 1 : 0 }, height: byItems ? 110 : 170 });
              },
            }];
          });
        });
      });
    },


    // A section on the back of cards that have checklists:
    // - "STORY POINTS" (a scale under every item) on a person's checklist card, on a card in the TO DO list,
    //   and on any card already estimated item by item — when story points are on;
    // - "TASKS" (priorities, ＋ TO DO, ＋ Cards) on every other card, i.e. on epics.
    'card-back-section': function (t) {
      lastT = t;
      return Promise.all([
        t.card('id', 'idList', 'badges', 'desc', 'customFieldItems'),
        t.get('card', 'shared', 'kid'),
        t.get('card', 'shared', 'pts'),
        spCfg(t),
      ]).then(function (r) {
        var card = r[0] || {}, b = card.badges || {}, kid = r[1], pts = r[2], c = r[3] || {};
        if (!b.checkItems) return null;
        // A task card made from an epic links back to it at the start of its description ("[Epic](trello.com/c/…) / Checklist").
        // That also covers a checklist card whose "kid" mark didn't get saved, after it leaves TO DO.
        var fromEpic = /^\[[^\]]*\]\(https:\/\/trello\.com\/c\//.test(card.desc || '');
        var estimated = !!kid || fromEpic || (c.todoIds || []).indexOf(card.idList) !== -1 || !!(pts && Object.keys(pts).length);
        if (estimated && c.on) {
          var sec = { title: 'STORY POINTS', icon: BOLT, content: { type: 'iframe', url: t.signUrl('./cardpoints.html'), height: 160 } };
          // The card's points on the title's line, as Trello's section action on the right: the sum of the open
          // items. Trello gives no checklists here, so they are read from the API (Trello asks again when the
          // points or the card change); without access, the "Story points" field (kept by the section) stands in.
          var label = function (v) { return { text: '⚡ ' + (v == null ? '?' : P.fmt(v)), callback: function () {} }; };
          var fallback = function () {
            var v = c.fieldId ? P.cardPoints(card, c.fieldId) : null;
            if (v != null || (pts && Object.keys(pts).length)) sec.action = label(v);
            return sec;
          };
          return EpicAuth.isAuthorized(t).then(function (ok) {
            if (!ok || !card.id) return fallback();
            return EpicAuth.request(t, 'GET', '/cards/' + card.id + '/checklists', { checkItems: 'all', checkItem_fields: 'name,state', fields: 'name' })
              .then(function (cls) {
                var sum = P.checklistField({ checklists: cls || [] }, pts || {});
                if (sum !== undefined) sec.action = label(sum);
                return sec;
              }, fallback);
          }).catch(fallback);
        }
        if (kid || fromEpic) return null;  // a person's checklist card is not an epic: no TO DO cards from it
        return {
          title: 'TASKS',
          icon: ICON,
          content: { type: 'iframe', url: t.signUrl('./section.html'), height: 200 },
        };
      });
    },

    'show-settings': function (t) {
      return t.popup({ title: 'Teamload — settings', url: './settings.html', height: 560 });
    },

    'authorization-status': function (t) {
      return EpicAuth.isAuthorized(t).then(function (ok) { return { authorized: ok }; });
    },

    'show-authorization': function (t) {
      return t.popup({ title: 'Connect Teamload', url: './auth.html', height: 150 });
    },
  }, EpicAuth.iframeOptions());
})();

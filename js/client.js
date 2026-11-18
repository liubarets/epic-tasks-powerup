/* global TrelloPowerUp, EpicAuth, EpicTodo, EpicPoints */
// Iframe connector: tells Trello which capabilities this Power-Up provides.
// It stays loaded while the board is open, so it also runs work in the background:
// - "Add all to TO DO": the popup only picks what to add and shows progress; closing it doesn't stop the job;
// - priority changes and sorting from the TASKS section: they finish even if the epic is closed at once.
(function () {
  'use strict';
  var ICON = new URL('./img/icon-gray.svg', window.location.href).href;
  var me = Math.random().toString(36).slice(2);  // this connector (another board tab has its own)
  var contexts = {};  // popup token -> { t, ready: Promise<cardId> }
  var tokens = [];
  var jobs = {};      // cardId -> { total, done, finished, error }
  var lastT = null;   // any recent context: REST calls only need the member's token
  var queue = Promise.resolve();
  var channel = null;
  try { channel = new BroadcastChannel('epic-tasks-addall'); } catch (e) { channel = null; }

  function post(msg) {
    if (!channel) return;
    msg.from = me;
    channel.postMessage(msg);
  }

  function plural(n) { return n + ' TO DO card' + (n === 1 ? '' : 's'); }

  function publish(cardId) { post({ type: 'progress', cardId: cardId, job: jobs[cardId] }); }

  function running(job) { return !!job && !job.finished && !job.error; }

  function startJob(t, cardId, key) {
    if (running(jobs[cardId])) return Promise.resolve();
    var job = jobs[cardId] = { total: 0, done: 0, finished: false, error: null };
    publish(cardId);
    return EpicTodo.load(t).then(function (d) {
      var err = EpicTodo.todoListError(d);
      if (err) throw err;
      var list = EpicTodo.jobsFor(d, key);
      job.total = list.length;
      publish(cardId);
      return EpicTodo.addMany(t, d, list, function (n) { job.done = n; publish(cardId); });
    }).then(function (n) {
      job.finished = true;
      publish(cardId);
      return t.alert(n ? { message: '✓ Created ' + plural(n), display: 'success', duration: 5 }
                       : { message: 'Nothing to add.', display: 'info', duration: 5 });
    }, function (e) {
      job.error = (e && e.message) || String(e);
      publish(cardId);
      return t.alert({ message: job.error, display: 'error', duration: 10 });
    }).catch(function () {});
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
      if (m.type === 'ops') { if (lastT && m.ops && m.ops.length) runOps(m); return; }
      var ctx = m.token && contexts[m.token];
      if (!ctx) return;  // that popup belongs to another board tab
      ctx.ready.then(function (cardId) {
        if (m.type === 'hello') {
          post({ type: 'hello-ack', token: m.token, cardId: cardId, job: jobs[cardId] || null });
        } else if (m.type === 'start') {
          post({ type: 'started', token: m.token, cardId: cardId });
          startJob(ctx.t, cardId, m.key);
        }
      });
    };
  }

  // "＋ Add all to TO DO" in the TASKS header. Trello only allows opening a popup right in the click
  // handler (no waiting for data first), so the menu loads its data inside the popup (addall.html).
  function addAllMenu(t) {
    var token = me + '.' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var popup = t.popup({ title: 'Add to TO DO', url: './addall.html', args: { token: token }, height: 120 });
    contexts[token] = { t: t, ready: Promise.resolve(t.card('id')).then(function (c) { return c.id; }) };
    tokens.push(token);
    if (tokens.length > 20) delete contexts[tokens.shift()];
    return popup;
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
    spCache = Promise.all([t.get('board', 'shared', 'cfg', {}), t.board('customFields')]).then(function (r) {
      var cfg = r[0] || {}, sp = cfg.sp || {};
      var f = P.findField((r[1] || {}).customFields, cfg);
      return { on: !!sp.on, migrate: !!sp.migrate && !!f, fieldId: f ? f.id : null, todoListId: cfg.todoListId };
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
      url: './spbar.html', height: 32, title: 'Story points',
      callback: function () { return Promise.resolve(t.set('member', 'private', 'spBar', false)).catch(function () {}); },
    });
  }
  function spPopup(t) {
    var bar = openBar(t);
    Promise.resolve(t.set('member', 'private', 'spBar', true)).catch(function () {});
    return bar;
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
        if (!c.on) return [];
        return t.card('id', 'name', 'idList', 'customFieldItems').then(function (card) {
          maybeMove(t, card, c);
          var v = P.cardPoints(card, c.fieldId);
          if (v != null) return [{ text: P.fmt(v), icon: BOLT, color: 'blue' }];
          return card.idList === c.todoListId ? [{ text: '?', icon: BOLT, color: 'yellow' }] : [];
        });
      });
    },

    'card-detail-badges': function (t) {
      return spCfg(t).then(function (c) {
        if (!c.on) return [];
        return t.card('name', 'customFieldItems').then(function (card) {
          var v = P.cardPoints(card, c.fieldId);
          return [{
            title: 'Story points',
            text: v == null ? 'Add' : P.fmt(v),
            color: v == null ? null : 'blue',
            callback: function (tt) { return tt.popup({ title: 'Story points', url: './spedit.html', height: 170 }); },
          }];
        });
      });
    },


    // "TASKS" section on the card back — only on cards that have checklists.
    'card-back-section': function (t) {
      lastT = t;
      return t.card('badges').then(function (card) {
        var b = (card && card.badges) || {};
        if (!b.checkItems) return null;
        return {
          title: 'TASKS',
          icon: ICON,
          content: { type: 'iframe', url: t.signUrl('./section.html'), height: 200 },
          action: { text: '＋ Add all to TO DO', callback: addAllMenu },
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

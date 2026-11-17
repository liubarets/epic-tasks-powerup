/* global TrelloPowerUp, EpicAuth, EpicTodo */
// Iframe connector: tells Trello which capabilities this Power-Up provides.
// It stays loaded while the board is open, so it also runs "Add all to TO DO" in the background:
// the "Add to TO DO" popup only picks what to add and shows progress, and closing it doesn't stop the job.
(function () {
  'use strict';
  var ICON = new URL('./img/icon-gray.svg', window.location.href).href;
  var me = Math.random().toString(36).slice(2);  // this connector (another board tab has its own)
  var contexts = {};  // popup token -> { t, ready: Promise<cardId> }
  var tokens = [];
  var jobs = {};      // cardId -> { total, done, finished, error }
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

  if (channel) {
    channel.onmessage = function (ev) {
      var m = ev.data || {};
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

  TrelloPowerUp.initialize({
    // "TASKS" section on the card back — only on cards that have checklists.
    'card-back-section': function (t) {
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
      return t.popup({ title: 'Epic Tasks — settings', url: './settings.html', height: 420 });
    },

    'authorization-status': function (t) {
      return EpicAuth.isAuthorized(t).then(function (ok) { return { authorized: ok }; });
    },

    'show-authorization': function (t) {
      return t.popup({ title: 'Connect Epic Tasks', url: './auth.html', height: 150 });
    },
  }, EpicAuth.iframeOptions());
})();

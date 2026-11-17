/* global TrelloPowerUp, EpicAuth, EpicTodo */
// "Add to TO DO" popup, opened by the "＋ Add all to TO DO" button in the TASKS header.
// The connector (client.js) creates the cards in the background, so closing this popup doesn't stop it;
// the popup shows the menu and the progress ("Adding TO DO cards… 2/5").
// If the connector doesn't answer (e.g. an old cached version), the popup creates the cards itself.
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var root = document.getElementById('root');
  var token = t.arg('token');
  var state = { d: null, options: [], busy: false, finished: false, connector: null };
  var channel = null;
  try { channel = token ? new BroadcastChannel('epic-tasks-addall') : null; } catch (e) { channel = null; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function plural(n) { return n + ' TO DO card' + (n === 1 ? '' : 's'); }

  function show(html) {
    root.innerHTML = html;
    return Promise.resolve(t.sizeTo('#root')).catch(function () {});
  }

  function message(text, cls) { return show('<p class="msg' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</p>'); }

  function showMenu() {
    if (!state.options.length) return message('Nothing to add: every open item with an assignee already has a TO DO card.');
    return show('<ul class="menu">' + state.options.map(function (o, i) {
      return '<li><button data-i="' + i + '">' + esc(o.text + ' (' + o.jobs.length + ')') + '</button></li>';
    }).join('') + '</ul>');
  }

  function showProgress(done, total, background) {
    var pct = total ? Math.round(done / total * 100) : 0;
    return show('<div class="progress"><p class="msg">Adding TO DO cards… <b class="progress-count">' +
      (total ? done + '/' + total : '…') + '</b></p>' +
      '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
      '<p class="muted" style="font-size:12px;padding:6px 0 0;margin:0">' +
      (background ? 'You can close this window: the cards keep being added.' : 'Keep this window open until it finishes.') +
      '</p></div>');
  }

  function finish(n) {
    state.finished = true;
    state.busy = false;
    message(n ? '✓ Created ' + plural(n) : 'Nothing to add.');
    setTimeout(function () { Promise.resolve(t.closePopup()).catch(function () {}); }, 1200);
  }

  // Progress of the background job, as reported by the connector.
  function onJob(job) {
    if (!job || state.finished) return;
    if (job.error) { state.busy = false; message(job.error, 'error'); return; }
    if (job.finished) { finish(job.done); return; }
    state.busy = true;
    showProgress(job.done, job.total, true);
  }

  // Finds the connector that opened this popup (it holds our token). Resolves with it or null.
  function hello() {
    if (!channel) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var tries = 0;
      var timer = setInterval(function () {
        if (state.connector || ++tries > 6) { clearInterval(timer); resolve(state.connector); return; }
        channel.postMessage({ type: 'hello', token: token });
      }, 250);
      channel.postMessage({ type: 'hello', token: token });
    });
  }

  if (channel) {
    channel.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === 'hello-ack' && m.token === token && !state.connector) {
        state.connector = { from: m.from, cardId: m.cardId };
        if (m.job && !m.job.finished && !m.job.error) onJob(m.job);
      } else if (m.type === 'progress' && state.connector && m.from === state.connector.from &&
                 m.cardId === state.connector.cardId && (state.busy || (m.job && !m.job.finished))) {
        onJob(m.job);
      }
    };
  }

  function load() {
    return EpicAuth.isAuthorized(t).then(function (ok) {
      if (!ok) {
        return show('<p class="msg">Connect Epic Tasks to your Trello account first.</p>' +
          '<button class="mod-primary" data-action="auth">Connect</button>');
      }
      return EpicTodo.load(t).then(function (d) {
        if (state.busy || state.finished) return;  // a background job is already being shown
        var err = EpicTodo.todoListError(d);
        if (err) return message(err.message);
        state.d = d;
        state.options = EpicTodo.addAllOptions(d);
        return showMenu();
      });
    }).catch(function (e) {
      return message((e && e.message) || String(e), 'error');
    });
  }

  // No connector to hand the job to: create the cards here (closing the popup would stop this).
  function addHere(option) {
    state.busy = true;
    showProgress(0, option.jobs.length, false);
    return EpicTodo.addMany(t, state.d, option.jobs, function (n, total) { showProgress(n, total, false); })
      .then(function (n) {
        return Promise.resolve(t.alert({ message: '✓ Created ' + plural(n), display: 'success', duration: 5 }))
          .catch(function () {}).then(function () { finish(n); });
      }, function (e) {
        state.busy = false;
        return message((e && e.message) || String(e), 'error');
      });
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || state.busy) return;
    if (b.getAttribute('data-action') === 'auth') {
      EpicAuth.authorize(t).then(load).catch(function (err) { message((err && err.message) || String(err), 'error'); });
      return;
    }
    var option = state.options[Number(b.getAttribute('data-i'))];
    if (!option) return;
    if (state.connector) {
      state.busy = true;
      showProgress(0, option.jobs.length, true);
      channel.postMessage({ type: 'start', token: token, key: option.key });
    } else {
      addHere(option);
    }
  });

  hello();
  // Trello also calls this when pluginData changes (e.g. while cards are being created): don't redraw then.
  t.render(function () {
    if (state.busy || state.finished) return;
    return load();
  });
})();

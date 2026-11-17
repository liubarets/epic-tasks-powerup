/* global TrelloPowerUp, EpicAuth, EpicPoints */
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var P = EpicPoints;
  var form = document.getElementById('f');
  var current = {};      // settings as stored (kept for keys this form doesn't edit)
  var board = {};
  var field = null;
  var withN = [];        // open cards that still have [n] in the title
  var moving = false;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  t.render(function () {
    return Promise.all([
      t.lists('id', 'name'),
      t.get('board', 'shared', 'cfg', {}),
      t.board('id', 'customFields'),
      t.cards('id', 'name', 'closed'),
    ]).then(function (r) {
      var lists = r[0], cfg = r[1] || {};
      current = cfg;
      board = r[2] || {};
      field = P.findField(board.customFields, cfg);
      withN = (r[3] || []).filter(function (c) { return !c.closed && P.parse(c.name) != null; });
      var guess = lists.filter(function (l) { return /to\s*-?\s*do/i.test(l.name); })[0];
      var todoId = cfg.todoListId || (guess && guess.id) || '';
      document.getElementById('todo').innerHTML = '<option value="">— choose —</option>' + lists.map(function (l) {
        return '<option value="' + esc(l.id) + '"' + (l.id === todoId ? ' selected' : '') + '>' + esc(l.name) + '</option>';
      }).join('');
      var doneIds = (cfg.doneListIds || lists.filter(function (l) { return /done|готов|викон/i.test(l.name); }).map(function (l) { return l.id; }))
        .filter(function (id) { return id !== todoId; });
      document.getElementById('done').innerHTML = lists.map(function (l) {
        return '<label><input type="checkbox" name="done" value="' + esc(l.id) + '"' +
          (doneIds.indexOf(l.id) !== -1 ? ' checked' : '') + '> ' + esc(l.name) + '</label>';
      }).join('');
      var pos = cfg.position === 'bottom' ? 'bottom' : 'top';
      form.querySelector('input[name=pos][value=' + pos + ']').checked = true;
      document.getElementById('auto').checked = cfg.autoComplete !== false;
      var sp = cfg.sp || {};
      document.getElementById('sp-on').checked = !!sp.on;
      document.getElementById('sp-migrate').checked = !!sp.migrate;
      syncDoneWithTodo();
      renderStoryPoints();
      return t.sizeTo(document.body);
    });
  });

  // The TO DO list can't also be a "Done" list: new cards land there, so they would count as done at once.
  function syncDoneWithTodo() {
    var todo = document.getElementById('todo').value;
    Array.prototype.forEach.call(form.querySelectorAll('input[name=done]'), function (cb) {
      var isTodo = !!todo && cb.value === todo;
      cb.disabled = isTodo;
      if (isTodo) cb.checked = false;
      cb.parentNode.style.opacity = isTodo ? '0.5' : '';
      cb.parentNode.title = isTodo ? 'This is the TO DO list, so it can\'t count as done' : '';
    });
  }
  document.getElementById('todo').addEventListener('change', syncDoneWithTodo);

  // ---- Story points ----
  function renderStoryPoints() {
    var box = document.getElementById('sp-field');
    box.innerHTML = field
      ? '<span class="sp-ok">✓ Field “' + esc(field.name) + '” is on this board</span>'
      : '<button type="button" class="link" id="sp-create">Create field “' + esc(P.FIELD_NAME) + '”</button>' +
        ' <span class="muted">— the points are stored there</span>';
    var mig = document.getElementById('sp-migrate');
    mig.disabled = !field;
    mig.parentNode.style.opacity = field ? '' : '0.5';
    var move = document.getElementById('sp-move');
    move.textContent = withN.length ? 'Move now: ' + P.cardsWord(withN.length) + ' with [n] in the title' : 'No cards with [n] in the title';
    move.disabled = moving || !field || !withN.length;
  }

  function ensureAuth() {
    return EpicAuth.isAuthorized(t).then(function (ok) { return ok ? null : EpicAuth.authorize(t); });
  }

  function saveSp(patch) {
    return t.get('board', 'shared', 'cfg', {}).then(function (cfg) {
      cfg = cfg || {};
      cfg.sp = Object.assign({}, cfg.sp || {}, patch);
      current = cfg;
      return t.set('board', 'shared', 'cfg', cfg);
    });
  }

  document.getElementById('sp-field').addEventListener('click', function (e) {
    var b = e.target.closest('#sp-create');
    if (!b) return;
    b.disabled = true;
    b.textContent = 'Creating…';
    ensureAuth().then(function () {
      return P.createField(t, board.id);
    }).then(function (f) {
      field = f;
      renderStoryPoints();
      return saveSp({ fieldId: f.id });
    }).catch(function (err) {
      b.disabled = false;
      b.textContent = 'Create field “' + P.FIELD_NAME + '”';
      document.getElementById('sp-move-msg').textContent = 'Could not create the field: ' + ((err && err.message) || err);
      return t.sizeTo(document.body);
    });
  });

  document.getElementById('sp-move').addEventListener('click', function () {
    if (!field || !withN.length || moving) return;
    var cards = withN.slice(), done = 0, msg = document.getElementById('sp-move-msg');
    moving = true;
    renderStoryPoints();
    msg.textContent = 'Moving 0 / ' + cards.length + '… keep this window open';
    ensureAuth().then(function () {
      // One card at a time, gently: Trello allows ~100 requests per 10 s per token.
      return cards.reduce(function (p, c) {
        return p.then(function () { return P.migrate(t, c, field.id); }).then(function () {
          done++;
          msg.textContent = 'Moving ' + done + ' / ' + cards.length + '… keep this window open';
          return new Promise(function (res) { setTimeout(res, 120); });
        });
      }, Promise.resolve());
    }).then(function () {
      msg.textContent = '✓ Moved ' + P.cardsWord(done);
    }, function (err) {
      msg.textContent = 'Stopped after ' + done + ': ' + ((err && err.message) || err);
    }).then(function () {
      moving = false;
      withN = withN.slice(done);
      renderStoryPoints();
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    var todo = document.getElementById('todo').value;
    var cfg = Object.assign({}, current, {
      todoListId: todo,
      doneListIds: Array.prototype.map.call(form.querySelectorAll('input[name=done]:checked'), function (i) { return i.value; })
        .filter(function (id) { return id !== todo; }),
      position: form.querySelector('input[name=pos]:checked').value,
      autoComplete: document.getElementById('auto').checked,
      sp: Object.assign({}, current.sp || {}, {
        on: document.getElementById('sp-on').checked,
        migrate: !!field && document.getElementById('sp-migrate').checked,
        fieldId: field ? field.id : ((current.sp || {}).fieldId || undefined),
      }),
    });
    t.set('board', 'shared', 'cfg', cfg).then(function () {
      btn.textContent = '✓ Saved';
      // From the board-header Power-Ups menu Trello can't close this popup
      // ("No popover in context"), so the confirmation above is what the user sees.
      Promise.resolve().then(function () { return t.closePopup(); }).catch(function () {});
    }, function (err) {
      btn.textContent = 'Could not save: ' + ((err && err.message) || err);
    }).then(function () {
      setTimeout(function () { btn.disabled = false; btn.textContent = 'Save'; }, 2000);
    });
  });
})();

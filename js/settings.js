/* global TrelloPowerUp, EpicAuth */
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var form = document.getElementById('f');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  t.render(function () {
    return Promise.all([t.lists('id', 'name'), t.get('board', 'shared', 'cfg', {})]).then(function (r) {
      var lists = r[0], cfg = r[1] || {};
      var guess = lists.filter(function (l) { return /to\s*-?\s*do/i.test(l.name); })[0];
      var todoId = cfg.todoListId || (guess && guess.id) || '';
      document.getElementById('todo').innerHTML = '<option value="">— оберіть —</option>' + lists.map(function (l) {
        return '<option value="' + esc(l.id) + '"' + (l.id === todoId ? ' selected' : '') + '>' + esc(l.name) + '</option>';
      }).join('');
      var doneIds = cfg.doneListIds || lists.filter(function (l) { return /done|готов|викон/i.test(l.name); }).map(function (l) { return l.id; });
      document.getElementById('done').innerHTML = lists.map(function (l) {
        return '<label><input type="checkbox" name="done" value="' + esc(l.id) + '"' +
          (doneIds.indexOf(l.id) !== -1 ? ' checked' : '') + '> ' + esc(l.name) + '</label>';
      }).join('');
      var pos = cfg.position === 'bottom' ? 'bottom' : 'top';
      form.querySelector('input[name=pos][value=' + pos + ']').checked = true;
      document.getElementById('labels').checked = cfg.priorityLabels !== false;
      document.getElementById('auto').checked = cfg.autoComplete !== false;
      return t.sizeTo(document.body);
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    var cfg = {
      todoListId: document.getElementById('todo').value,
      doneListIds: Array.prototype.map.call(form.querySelectorAll('input[name=done]:checked'), function (i) { return i.value; }),
      position: form.querySelector('input[name=pos]:checked').value,
      priorityLabels: document.getElementById('labels').checked,
      autoComplete: document.getElementById('auto').checked,
    };
    t.set('board', 'shared', 'cfg', cfg).then(function () {
      btn.textContent = '✓ Збережено';
      // From the board-header Power-Ups menu Trello can't close this popup
      // ("No popover in context"), so the confirmation above is what the user sees.
      Promise.resolve().then(function () { return t.closePopup(); }).catch(function () {});
    }, function (err) {
      btn.textContent = 'Не вдалося зберегти: ' + ((err && err.message) || err);
    }).then(function () {
      setTimeout(function () { btn.disabled = false; btn.textContent = 'Зберегти'; }, 2000);
    });
  });
})();

/* global TrelloPowerUp, EpicAuth, EpicPoints */
// Card back → "Story points" badge → this popup: quick values written to the "Story points" field.
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var P = EpicPoints;
  var root = document.getElementById('root');
  var VALUES = [0.5, 1, 2, 3, 5, 8, 13, 21];
  var d = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load() {
    return Promise.all([
      t.card('id', 'name', 'customFieldItems'),
      t.board('customFields'),
      t.get('board', 'shared', 'cfg', {}),
    ]).then(function (r) {
      var cfg = r[2] || {};
      var field = P.findField((r[1] || {}).customFields, cfg);
      d = { card: r[0], cfg: cfg, field: field, value: P.cardPoints(r[0], field && field.id) };
      render();
    });
  }

  function render(msg) {
    if (t.arg('items')) {
      root.innerHTML = '<p class="msg">This card is estimated item by item: set points under each item in the ' +
        '<b>STORY POINTS</b> section of the card. The card’s points are the sum of its open items.</p>';
      return t.sizeTo('#root');
    }
    if (!d.field) {
      root.innerHTML = '<p class="msg">The “' + esc(P.FIELD_NAME) + '” field isn’t on this board yet. Create it in Teamload settings.</p>';
      return t.sizeTo('#root');
    }
    root.innerHTML =
      '<div class="sp-chips">' + VALUES.map(function (v) {
        return '<button type="button" class="sp-chip' + (d.value === v ? ' on' : '') + '" data-v="' + v + '">' + P.fmt(v) + '</button>';
      }).join('') + '</div>' +
      '<button type="button" class="sp-clear" data-v="">No estimate</button>' +
      '<p class="sp-hint">Or type [n] or (n) in the card title.</p>' +
      (msg ? '<p class="msg error">' + esc(msg) + '</p>' : '');
    return t.sizeTo('#root');
  }

  function save(v) {
    return EpicAuth.isAuthorized(t).then(function (ok) {
      return ok ? null : EpicAuth.authorize(t);
    }).then(function () {
      return P.setValue(t, d.card.id, d.field.id, v);
    }).then(function () {
      // With "move [n] from titles" on, a leftover [n] / (n) would overwrite the value picked here, so it goes too.
      var name = P.strip(d.card.name);
      if (d.cfg.sp && d.cfg.sp.migrate && name && name !== d.card.name) {
        return EpicAuth.request(t, 'PUT', '/cards/' + d.card.id, { name: name });
      }
    }).then(function () {
      return t.closePopup();
    });
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]');
    if (!b || !d) return;
    var raw = b.getAttribute('data-v');
    var v = raw === '' ? null : parseFloat(raw);
    Array.prototype.forEach.call(root.querySelectorAll('button'), function (x) { x.disabled = true; });
    save(v).catch(function (err) { render((err && err.message) || String(err)); });
  });

  t.render(load);
})();

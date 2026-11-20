/* global TrelloPowerUp, EpicAuth, EpicPoints */
// "STORY POINTS" section on the back of a card with a checklist (a TO DO card, or a person's checklist card):
// a small scale under every open item. The card's "Story points" field is the sum of its open items, kept up to
// date here (on every change Trello reports for the card) and by the connector's card badges (client.js).
// The points live in Teamload data "pts" on the card: { last 8 characters of the item id: n }.
(function () {
  'use strict';
  var t = TrelloPowerUp.iframe(EpicAuth.iframeOptions());
  var P = EpicPoints;
  var root = document.getElementById('root');
  var VALUES = [0.5, 1, 2, 3, 5, 8, 13, 21];
  var data = null;
  var ui = { authed: true, error: null };
  var queue = Promise.resolve();
  var tried = {};  // items whose "[n]" was already moved in this session: never retried in a loop

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function byPos(a, b) { return (a.pos || 0) - (b.pos || 0); }

  function resize() { return Promise.resolve(t.sizeTo(document.body)).catch(function () {}); }

  function load() {
    return Promise.all([
      t.card('id', 'name', 'checklists', 'customFieldItems'),
      t.get('board', 'shared', 'cfg', {}),
      t.board('customFields'),
      t.get('card', 'shared', 'pts', {}),
      EpicAuth.isAuthorized(t),
    ]).then(function (r) {
      var card = r[0] || {}, cfg = r[1] || {};
      (card.checklists || []).sort(byPos);
      (card.checklists || []).forEach(function (cl) { (cl.checkItems || []).sort(byPos); });
      data = { card: card, cfg: cfg, field: P.findField((r[2] || {}).customFields, cfg), pts: r[3] || {} };
      ui.authed = !!r[4];
      render();
      return ui.authed ? tidy() : null;
    }).catch(function (e) {
      ui.error = (e && e.message) || String(e);
      render();
    });
  }

  // With "move [n] from titles" on, "[3]" typed into an item moves into the data. Then the card's field
  // gets the sum of its open items, if it differs (an item was ticked, added or removed).
  function tidy() {
    var d = data;
    var moves = [], changes = {};
    if (d.cfg.sp && d.cfg.sp.migrate) {
      P.allItems(d.card).forEach(function (it) {
        var v = P.parse(it.name), name = P.strip(it.name), k = P.itemKey(it.id);
        if (v == null || !name || tried[it.id]) return;
        tried[it.id] = true;
        if (d.pts[k] !== v) changes[k] = d.pts[k] = v;
        it.name = name;
        moves.push(it);
      });
    }
    return enqueue(function () {
      // The value goes into the data first, so nothing is lost if renaming the item fails.
      var first = Object.keys(changes).length ? savePts(changes) : Promise.resolve();
      return first.then(function () {
        return Promise.all(moves.map(function (it) {
          return EpicAuth.request(t, 'PUT', '/cards/' + d.card.id + '/checkItem/' + it.id, { name: it.name });
        }));
      }).then(function () { return syncField(); });
    });
  }

  function enqueue(fn) {
    queue = queue.then(fn).catch(function (e) {
      if (e && e.isAuthError) ui.authed = false;
      ui.error = (e && e.message) || String(e);
      render();
    });
    return queue;
  }

  // changes = { itemKey: n, or null to clear }. Re-read right before writing: someone else may be
  // estimating another item of this card at the same time.
  function savePts(changes) {
    return Promise.resolve(t.get('card', 'shared', 'pts', {})).then(function (pts) {
      pts = pts || {};
      Object.keys(changes).forEach(function (k) { if (changes[k] == null) delete pts[k]; else pts[k] = changes[k]; });
      data.pts = P.prunePoints(pts, data.card);
      return t.set('card', 'shared', 'pts', data.pts);
    });
  }

  function syncField() {
    var d = data;
    if (!d.field) return Promise.resolve();
    var v = P.checklistField(d.card, d.pts);
    if (v === undefined || v === P.fieldValue(d.card, d.field.id)) return Promise.resolve();
    return P.setValue(t, d.card.id, d.field.id, v).then(function () {
      d.card.customFieldItems = (d.card.customFieldItems || []).filter(function (x) { return x.idCustomField !== d.field.id; });
      if (v != null) d.card.customFieldItems.push({ idCustomField: d.field.id, value: { number: String(v) } });
    });
  }

  // A click on a value sets it; a click on the value already set clears it.
  function setPoints(itemId, v) {
    var k = P.itemKey(itemId);
    var cur = P.itemPoints({ id: itemId, name: '' }, data.pts);
    var change = {};
    change[k] = cur === v ? null : v;
    if (cur === v) delete data.pts[k]; else data.pts[k] = v;
    var it = P.allItems(data.card).filter(function (x) { return x.id === itemId; })[0];
    var clean = it ? P.strip(it.name) : '';
    var rename = it && clean && clean !== it.name;  // "[3]" left in the text would count instead of the data
    if (rename) it.name = clean;
    ui.error = null;
    render();
    return enqueue(function () {
      return savePts(change).then(function () {
        return rename ? EpicAuth.request(t, 'PUT', '/cards/' + data.card.id + '/checkItem/' + itemId, { name: clean }) : null;
      }).then(syncField).then(render);
    });
  }

  function render() {
    if (!data) {
      root.innerHTML = ui.error ? '<div class="error">' + esc(ui.error) + '</div>' : '<div class="muted">Loading…</div>';
      return resize();
    }
    var d = data;
    if (!d.field) {
      root.innerHTML = '<p class="msg">The “' + esc(P.FIELD_NAME) + '” field isn’t on this board yet. Create it in Teamload settings.</p>';
      return resize();
    }
    var sum = P.checklistField(d.card, d.pts);
    var own = P.fieldValue(d.card, d.field.id);
    var head = sum === undefined
      ? (own != null
        ? '<span class="cp-note">This card has <b>' + P.fmt(own) + '</b> points as a whole. Estimate its items and their sum replaces it.</span>'
        : '<span class="cp-note">Estimate each item: the card’s points are the sum of its open items.</span>')
      : '<span class="cp-sum" title="Sum of open items">⚡ ' + (sum == null ? '?' : P.fmt(sum)) + '</span>' +
        '<span class="cp-note">Card points = sum of open items</span>';
    var lists = d.card.checklists || [];
    var body = lists.map(function (cl) {
      var items = (cl.checkItems || []).map(function (it) {
        var v = P.itemPoints(it, d.pts);
        var done = it.state === 'complete';
        if (done) {
          return '<li class="cp-item done"><span class="cp-name">' + esc(it.name) + '</span>' +
            '<span class="cp-done">✓ done' + (v != null ? ' · ' + P.fmt(v) : '') + '</span></li>';
        }
        return '<li class="cp-item"><span class="cp-name">' + esc(it.name) + '</span>' +
          '<span class="cp-scale" role="group" aria-label="' + esc('Story points for ' + it.name) + '">' +
          VALUES.map(function (x) {
            var on = v === x;
            return '<button type="button" class="cp-v' + (on ? ' on' : '') + '" data-item="' + esc(it.id) + '" data-v="' + x + '" aria-pressed="' + on + '"' +
              (ui.authed ? '' : ' disabled') + '>' + P.fmt(x) + '</button>';
          }).join('') + '</span></li>';
      }).join('');
      return (lists.length > 1 ? '<div class="cp-cl">' + esc(cl.name) + '</div>' : '') + '<ul class="cp-list">' + items + '</ul>';
    }).join('');
    root.innerHTML =
      (ui.authed ? '' : '<div class="notice">Connect Teamload to set points. <button class="link" data-action="auth">Connect</button></div>') +
      (ui.error ? '<div class="error">' + esc(ui.error) + '</div>' : '') +
      '<div class="cp-head">' + head + '</div>' + body;
    return resize();
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !data) return;
    if (b.getAttribute('data-action') === 'auth') {
      Promise.resolve(EpicAuth.authorize(t)).then(load).catch(function () {});
      return;
    }
    if (b.hasAttribute('data-item')) setPoints(b.getAttribute('data-item'), parseFloat(b.getAttribute('data-v')));
  });

  // Trello calls this on load and whenever the card or its Power-Up data changes (an item ticked, for example).
  t.render(load);
})();

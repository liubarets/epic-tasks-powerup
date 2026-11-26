// Test double for https://p.trellocdn.com/power-up.min.js + a fake Trello REST backend.
// Served instead of the real library by test/run_ui.py. Not part of the deployed Power-Up.
(function () {
  var ME = { id: 'mem00000000000000000000me', username: 'oleh_l', fullName: 'Oleh' };
  function mem(n, u) { return { id: 'mem' + String(n).padStart(21, '0'), username: u, fullName: u }; }
  var members = [ME, mem(1, 'maria_petrenko'), mem(2, 'olenashevchenko0711'), mem(3, 'tarasbondar'),
    mem(4, 'sofia_melnyk'), mem(5, 'v_kim'), mem(6, 'ninanina')];
  var lists = [{ id: 'L_todo', name: 'TO DO' }, { id: 'L_prog', name: 'In progress' }, { id: 'L_done', name: 'Done' }];
  var seq = 100;
  function id(p) { seq++; return (p + String(seq)).padStart(24, '0'); }
  function item(name, extra) { var o = { id: id('ci'), name: name, state: 'incomplete', pos: (seq) * 1024, due: null, idMember: null }; return Object.assign(o, extra || {}); }

  var spring = [
    item('Approve with legal @maria_petrenko'),
    item('Tranfser to IT @maria_petrenko'),
    item('🟢 Check WEB&B2C @maria_petrenko', { state: 'complete' }),
    item('🔴 Video for educational zones in BR - finalization @olenashevchenko0711 @tarasbondar', { due: '2026-11-20T10:00:00.000Z' }),
    item('🟠 Video for big entry screens in BR @olenashevchenko0711 @tarasbondar @sofia_melnyk'),
    item('Spring merch - speeches for frontliners @v_kim', { due: '2026-11-14T10:00:00.000Z' }),
  ];
  var retail = [
    item('Tranfser to IT @maria_petrenko'),
    item('🔴 Approve with legal @maria_petrenko'),
    item('Check WEB&B2C @maria_petrenko'),
    item('Retail SDK - speeches for frontliners @ninanina @former_employee'),
  ];
  var S = window.__state = {
    card: { id: 'card00000000000000000epic', name: 'PRODUCT LAUNCHES & UPDATES', url: 'https://trello.com/c/EPIC0001/1-product-launches', shortLink: 'EPIC0001', badges: { checkItems: 10 } },
    board: { id: 'board000000000000000000b1', labels: [{ id: 'lab_green', name: 'Marketing', color: 'green' }], customFields: [] },
    checklists: [
      { id: 'cl1', name: 'Spring merch 24.11', pos: 1, checkItems: spring },
      { id: 'cl2', name: 'Retail SDK - 26.11', pos: 2, checkItems: retail },
    ],
    cards: {},
    plugin: {
      board: { cfg: { todoListId: 'L_todo', doneListIds: ['L_done'], position: 'top', autoComplete: true } },
      card: { links: {} },
    },
    requests: [],
    popups: [], shown: [], alerts: [], epicActions: [],
  };
  // pre-existing TODO cards: taras already took the BR educational video and is working on it; v_kim finished his
  function addCard(name, idList, idMembers, extra) {
    var c = Object.assign({ id: id('card'), shortLink: 'SL' + seq, name: name, idList: idList, idMembers: idMembers, idLabels: [], closed: false, dueComplete: false, pos: (seq + 1) * 65536, badges: { attachments: 0 } }, extra || {});
    S.cards[c.shortLink] = c; return c;
  }
  var key = function (i, m) { return String(i).slice(-10) + ':' + String(m).slice(-8); };
  var c1 = addCard('🔴 Video for educational zones in BR - finalization — Spring merch 24.11', 'L_prog', [members[3].id]);
  S.plugin.card.links[key(spring[3].id, members[3].id)] = c1.shortLink;
  var c2 = addCard('Spring merch - speeches for frontliners — Spring merch 24.11', 'L_done', [members[5].id]);
  S.plugin.card.links[key(spring[5].id, members[5].id)] = c2.shortLink;

  var clock = Date.parse('2026-11-17T00:00:00.000Z');
  function now() { clock += 1000; return new Date(clock).toISOString(); }
  function logTick(it) { S.epicActions.unshift({ date: now(), data: { checkItem: { id: it.id, state: it.state } } }); }
  // test helpers: a person moves a card / ticks an item in Trello itself
  window.__move = function (prefix, idList) {
    var c = Object.values(S.cards).filter(function (x) { return x.name.indexOf(prefix) === 0; })[0];
    (c.actions = c.actions || []).unshift({ date: now(), data: { listBefore: { id: c.idList }, listAfter: { id: idList } } });
    c.idList = idList;
  };
  window.__tick = function (cl, i, state) { var it = S.checklists[cl].checkItems[i]; it.state = state; logTick(it); };
  // a person ticks an item in their own card (a checklist card): Trello logs it on that card
  window.__tickIn = function (cardId, itemId, state) {
    var c = Object.values(S.cards).filter(function (x) { return x.id === cardId; })[0];
    var it = allKidItems(c).filter(function (x) { return x.id === itemId; })[0];
    it.state = state;
    (c.checkActions = c.checkActions || []).unshift({ date: now(), data: { checkItem: { id: it.id, state: state } } });
  };
  function allKidItems(c) { var o = []; (c && c.checklists || []).forEach(function (cl) { cl.checkItems.forEach(function (i) { o.push(i); }); }); return o; }
  function cardById(cid) { return Object.values(S.cards).filter(function (c) { return c.id === cid; })[0] || null; }
  function cardBadges(c) {
    var items = allKidItems(c);
    return { checkItems: items.length, checkItemsChecked: items.filter(function (i) { return i.state === 'complete'; }).length, attachments: (c.badges || {}).attachments || 0 };
  }
  window.__cardById = cardById;

  function findItem(iid) {
    for (var i = 0; i < S.checklists.length; i++) {
      var cl = S.checklists[i];
      for (var j = 0; j < cl.checkItems.length; j++) if (cl.checkItems[j].id === iid) return { cl: cl, it: cl.checkItems[j] };
    }
  }
  function json(o, status) { return Promise.resolve(new Response(o == null ? null : JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } })); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var realFetch = window.fetch;
  window.fetch = function (url, init) {
    var u = new URL(url);
    if (!/trello\.com$/.test(u.hostname)) return realFetch.apply(this, arguments);
    var method = (init && init.method) || 'GET';
    var path = u.pathname.replace(/^\/1/, '');
    var q = Object.fromEntries(u.searchParams.entries());
    var body = init && init.body ? JSON.parse(init.body) : null;
    S.requests.push({ method: method, path: path, q: q, body: body });
    var m;
    if (method === 'GET' && (m = path.match(/^\/cards\/([^/]+)\/checklists$/))) {
      if (m[1] !== 'card00000000000000000epic') { var oc = cardById(m[1]) || (S.card.id === m[1] ? S.card : null); return json(clone((oc && oc.checklists) || [])); }
      return json(clone(S.checklists));
    }
    if (method === 'POST' && (m = path.match(/^\/cards\/([^/]+)\/checklists$/))) {
      var kc = cardById(m[1]);
      var ncl = { id: id('kl'), name: q.name, pos: ++seq, idCard: kc.id, checkItems: [] };
      (kc.checklists = kc.checklists || []).push(ncl);
      return json(clone(ncl));
    }
    if (method === 'POST' && (m = path.match(/^\/checklists\/([^/]+)\/checkItems$/))) {
      var hit = null;
      Object.values(S.cards).forEach(function (c) { (c.checklists || []).forEach(function (cl) { if (cl.id === m[1]) hit = cl; }); });
      if (!hit) return json({ message: 'no checklist' }, 404);
      var nci = { id: id('ki'), name: q.name, state: 'incomplete', pos: ++seq * 1024, due: q.due || null, idMember: null };
      hit.checkItems.push(nci);
      return json(clone(nci));
    }
    if (method === 'PUT' && (m = path.match(/^\/cards\/([^/]+)\/checkItem\/([^/]+)$/)) && m[1] !== 'card00000000000000000epic') {
      var owner = cardById(m[1]);
      var ki = allKidItems(owner).filter(function (x) { return x.id === m[2]; })[0];
      if (!ki) return json({ message: 'not found' }, 404);
      if (q.name !== undefined) ki.name = q.name;
      if (q.due !== undefined) ki.due = q.due;
      if (q.state) { ki.state = q.state; (owner.checkActions = owner.checkActions || []).unshift({ date: now(), data: { checkItem: { id: ki.id, state: q.state } } }); }
      return json(clone(ki));
    }
    if (method === 'PUT' && (m = path.match(/^\/cards\/([^/]+)\/checkItem\/([^/]+)$/))) {
      var f = findItem(m[2]);
      if (!f) return json({ message: 'not found' }, 404);
      if (q.name !== undefined) f.it.name = q.name;
      if (q.state) { f.it.state = q.state; logTick(f.it); }
      if (q.pos === 'bottom') { f.it.pos = ++seq * 100000; f.cl.checkItems.sort(function (a, b) { return a.pos - b.pos; }); }
      return json(clone(f.it));
    }
    if (method === 'GET' && (m = path.match(/^\/cards\/([^/]+)\/actions$/))) {
      if (m[1] === S.card.id) {
        S.epicHistoryCalls = (S.epicHistoryCalls || 0) + 1;
        return json(q.filter === 'updateCheckItemStateOnCard'
          ? clone(S.epicActions.filter(function (a) { return !q.since || a.date > q.since; })) : []);
      }
      var ac = Object.values(S.cards).filter(function (c) { return c.id === m[1]; })[0];
      if (ac && q.filter === 'updateCheckItemStateOnCard') return json(clone(ac.checkActions || []));
      return json(ac && q.filter === 'updateCard:idList' ? clone(ac.actions || []) : []);
    }
    if (method === 'GET' && path === '/batch') {
      S.batchRoutes = (S.batchRoutes || []).concat(q.urls.split(','));
      return json(q.urls.split(',').map(function (route) {
        var u = new URL('https://x' + route);
        var rq = Object.fromEntries(u.searchParams.entries());
        var mm = u.pathname.match(/^\/cards\/([^/]+)(\/actions|\/checklists)?$/);
        if (!mm) return { 400: 'bad route' };
        var c = S.cards[mm[1]] || Object.values(S.cards).filter(function (x) { return x.id === mm[1]; })[0];
        if (!c) return { 404: 'not found' };
        if (mm[2] === '/checklists') return { 200: clone(c.checklists || []) };
        if (mm[2]) return { 200: rq.filter === 'updateCard:idList' ? clone(c.actions || []) : rq.filter === 'updateCheckItemStateOnCard' ? clone(c.checkActions || []) : [] };
        var full = clone(c);
        if (rq.fields) {
          var only = { id: c.id }; rq.fields.split(',').forEach(function (f) { only[f] = full[f]; });
          if (rq.checklists === 'all') only.checklists = full.checklists || [];
          if (rq.customFieldItems === 'true') only.customFieldItems = full.customFieldItems || [];
          return { 200: only };
        }
        return { 200: full };
      }));
    }
    if (method === 'GET' && (m = path.match(/^\/lists\/([^/]+)\/cards$/))) {
      return json(Object.values(S.cards).filter(function (c) { return c.idList === m[1] && !c.closed; })
        .sort(function (a, b) { return a.pos - b.pos; }).map(function (c) { return { id: c.id, pos: c.pos }; }));
    }
    if (method === 'POST' && path === '/cards' && window.__postDelay && !(init && init.__noDelay)) {
      return new Promise(function (res) { setTimeout(res, window.__postDelay); }).then(function () {
        return window.fetch(url, Object.assign({}, init, { __noDelay: true }));
      });
    }
    if (method === 'POST' && path === '/cards') {
      var inList = Object.values(S.cards).filter(function (x) { return x.idList === q.idList; }).map(function (x) { return x.pos; });
      var pos = q.pos === 'top' ? (inList.length ? Math.min.apply(null, inList) / 2 : 65536)
        : q.pos === 'bottom' ? (inList.length ? Math.max.apply(null, inList) : 0) + 65536 : parseFloat(q.pos);
      var c = addCard(q.name, q.idList, (q.idMembers || '').split(',').filter(Boolean),
        { idLabels: (q.idLabels || '').split(',').filter(Boolean), desc: q.desc, due: q.due || null, pos: pos,
          urlSource: q.urlSource, badges: { attachments: q.urlSource ? 1 : 0 } });
      return json(clone(c));
    }
    if (method === 'POST' && (m = path.match(/^\/cards\/([^/]+)\/attachments$/))) {
      return json({ id: id('att'), url: q.url });
    }
    if (method === 'POST' && (m = path.match(/^\/boards\/([^/]+)\/labels$/))) {
      var l = { id: id('lab'), name: q.name, color: q.color };
      S.board.labels.push(l); return json(l);
    }
    if (method === 'PUT' && (m = path.match(/^\/cards\/([^/]+)$/))) {
      var card = Object.values(S.cards).filter(function (c) { return c.id === m[1]; })[0] || (S.card.id === m[1] ? S.card : null);
      if (q.name !== undefined) card.name = q.name;
      if (q.idLabels !== undefined) card.idLabels = q.idLabels.split(',').filter(Boolean);
      if (q.idList !== undefined && q.idList !== card.idList) { (card.actions = card.actions || []).unshift({ date: now(), data: { listBefore: { id: card.idList }, listAfter: { id: q.idList } } }); card.idList = q.idList; }
      if (S.renderOnRest && renderFn) setTimeout(renderFn, 0);
      return json(clone(card));
    }
    if (method === 'PUT' && (m = path.match(/^\/cards\/([^/]+)\/customField\/([^/]+)\/item$/))) {
      var cc = Object.values(S.cards).filter(function (c) { return c.id === m[1]; })[0] || (S.card.id === m[1] ? S.card : null);
      if (!cc) return json({ message: 'not found' }, 404);
      if (S.failField) return json({ message: 'Trello is not available' }, 500);
      cc.customFieldItems = (cc.customFieldItems || []).filter(function (i) { return i.idCustomField !== m[2]; });
      if (body && body.value && body.value.number !== undefined) cc.customFieldItems.push({ idCustomField: m[2], value: { number: body.value.number } });
      if (S.renderOnRest && renderFn) setTimeout(renderFn, 0); // Trello reports the changed card
      return json({ idCustomField: m[2], value: body && body.value });
    }
    if (method === 'GET' && (m = path.match(/^\/boards\/([^/]+)\/customFields$/))) {
      return json(clone(S.restFields || S.board.customFields));
    }
    if (method === 'POST' && path === '/customFields') {
      var cf = { id: id('cf'), name: body.name, type: body.type, idModel: body.idModel, display: { cardFront: body.display_cardFront } };
      if (S.staleBoard) { S.restFields = (S.restFields || clone(S.board.customFields)).concat([cf]); } else { S.board.customFields.push(cf); }
      return json(cf);
    }
    return json({ message: 'unmocked ' + method + ' ' + path }, 500);
  };

  if (window.__mockPatch) window.__mockPatch(S);
  var renderFn = null;
  window.__rerender = function () { if (renderFn) renderFn(); };
  function scopeOf(scope) { return scope === 'card' && S.card.id !== 'card00000000000000000epic' ? S.card.id : scope; }
  function pick(obj) { return Promise.resolve(clone(obj)); }
  var t = {
    // like the real board: t.card('checklists') gives no checklists, they come from the REST API
    card: function () { var c = clone(S.card); if (S.card.checklists) c.badges = cardBadges(S.card); delete c.checklists; return Promise.resolve(c); },
    board: function () { return pick({ id: S.board.id, members: S.members || members, labels: S.board.labels, customFields: S.board.customFields }); },
    cards: function () {
      var ms = S.members || members;
      return pick(Object.values(S.cards).map(function (c) {
        return { id: c.id, name: c.name, idList: c.idList, closed: !!c.closed, pos: c.pos, customFieldItems: c.customFieldItems || [], badges: cardBadges(c),
          members: (c.idMembers || []).map(function (mid) { return ms.filter(function (x) { return x.id === mid; })[0] || { id: mid }; }) };
      }));
    },
    member: function () { return pick(S.me || ME); },
    lists: function () { return pick(lists); },
    // "card" is the card in context: the epic's data lives under S.plugin.card (as before), any other card's under its id
    get: function (scope, vis, k, def) { scope = scopeOf(scope); var v = (S.plugin[scope] || {})[k]; return Promise.resolve(v === undefined ? def : clone(v)); },
    set: function (scope, vis, k, v) {
      scope = scopeOf(scope);
      S.plugin[scope] = S.plugin[scope] || {}; S.plugin[scope][k] = clone(v);
      if (renderFn) setTimeout(renderFn, 0); // Trello reloads the section on pluginData change
      return Promise.resolve();
    },
    render: function (fn) { renderFn = fn; setTimeout(fn, 0); },
    sizeTo: function () { return Promise.resolve(); },
    popup: function (o) { S.popups.push(o.url || o.title); window.__lastPopup = o; return Promise.resolve(); },
    boardBar: function (o) { S.bars = (S.bars || []).concat([o.url]); window.__lastBar = o; return Promise.resolve(); },
    modal: function (o) { S.modals = (S.modals || []).concat([o.url]); window.__lastModal = o; return Promise.resolve(); },
    closeModal: function () { S.modalClosed = (S.modalClosed || 0) + 1; return Promise.resolve(); },
    closeBoardBar: function () { S.barClosed = (S.barClosed || 0) + 1; return Promise.resolve(); },
    alert: function (o) { S.alerts.push(o.message); return Promise.resolve(); },
    closePopup: function () { S.closed = (S.closed || 0) + 1; return Promise.resolve(); },
    showCard: function (cid) { S.shown.push(cid); return Promise.resolve(); },
    signUrl: function (u) { return u; },
    arg: function (n) { return (window.__args || {})[n]; },
    getRestApi: function () {
      return { getToken: function () { return Promise.resolve(S.noToken ? null : 'tok'); }, isAuthorized: function () { return Promise.resolve(!S.noToken); },
        authorize: function () { S.noToken = false; S.authCount = (S.authCount || 0) + 1; return Promise.resolve(); } };
    },
  };
  window.TrelloPowerUp = { iframe: function () { return t; }, initialize: function (caps) { window.__caps = caps; } };
})();

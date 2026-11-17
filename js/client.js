/* global TrelloPowerUp, EpicAuth, EpicTodo */
// Iframe connector: tells Trello which capabilities this Power-Up provides.
(function () {
  'use strict';
  var ICON = new URL('./img/icon-gray.svg', window.location.href).href;
  var busy = false;

  function alert(t, message, display, duration) {
    return t.alert({ message: message, display: display || 'info', duration: duration || 6 });
  }

  function plural(n) { return n + ' TO DO card' + (n === 1 ? '' : 's'); }

  function addJobs(t, d, jobs) {
    if (busy) return Promise.resolve();
    busy = true;
    return Promise.resolve(t.closePopup()).catch(function () {}).then(function () {
      alert(t, 'Creating ' + plural(jobs.length) + '…', 'info', 30);
      return EpicTodo.addMany(t, d, jobs);
    }).then(function (n) {
      // The section reloads by itself: Trello re-renders it when the links in pluginData change.
      return alert(t, '✓ Created ' + plural(n), 'success', 5);
    }, function (e) {
      return alert(t, (e && e.message) || String(e), 'error', 10);
    }).then(function () { busy = false; });
  }

  // "＋ Add all to TO DO" in the TASKS header: a menu with the checklists that have something to add.
  function addAllMenu(t) {
    if (busy) return alert(t, 'Still creating cards…');
    return EpicAuth.isAuthorized(t).then(function (ok) {
      if (!ok) return t.popup({ title: 'Connect Epic Tasks', url: './auth.html', height: 150 });
      return EpicTodo.load(t).then(function (d) {
        var err = EpicTodo.todoListError(d);
        if (err) return alert(t, err.message, 'warning');
        var groups = d.checklists
          .map(function (cl) { return { cl: cl, jobs: EpicTodo.pendingInChecklist(d, cl) }; })
          .filter(function (g) { return g.jobs.length; });
        if (!groups.length) {
          return alert(t, 'Nothing to add: every open item with an assignee already has a TO DO card.');
        }
        var items = groups.map(function (g) {
          return { text: g.cl.name + ' (' + g.jobs.length + ')', callback: function () { return addJobs(t, d, g.jobs); } };
        });
        if (groups.length > 1) {
          var all = [];
          groups.forEach(function (g) { all = all.concat(g.jobs); });
          items.unshift({ text: 'All tasks (' + all.length + ')', callback: function () { return addJobs(t, d, all); } });
        }
        return t.popup({ title: 'Add to TO DO', items: items });
      });
    }).catch(function (e) {
      if (e && e.isAuthError) return t.popup({ title: 'Connect Epic Tasks', url: './auth.html', height: 150 });
      return alert(t, (e && e.message) || String(e), 'error', 10);
    });
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

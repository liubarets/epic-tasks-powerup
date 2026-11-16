/* global TrelloPowerUp, EpicAuth */
// Iframe connector: tells Trello which capabilities this Power-Up provides.
(function () {
  'use strict';
  var ICON = new URL('./img/icon-gray.svg', window.location.href).href;

  TrelloPowerUp.initialize({
    // "Epic tasks" section on the card back — only on cards that have checklists.
    'card-back-section': function (t) {
      return t.card('badges').then(function (card) {
        var b = (card && card.badges) || {};
        if (!b.checkItems) return null;
        return {
          title: 'Epic tasks',
          icon: ICON,
          content: { type: 'iframe', url: t.signUrl('./section.html'), height: 200 },
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

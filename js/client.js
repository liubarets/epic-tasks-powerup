/* global TrelloPowerUp, EpicAuth */
// Iframe connector: tells Trello which capabilities this Power-Up provides.
(function () {
  'use strict';
  var ICON = new URL('./img/icon-gray.svg', window.location.href).href;

  TrelloPowerUp.initialize({
    // Блок "Задачі епіка" на звороті картки — лише на картках, де є чек-листи.
    'card-back-section': function (t) {
      return t.card('badges').then(function (card) {
        var b = (card && card.badges) || {};
        if (!b.checkItems) return null;
        return {
          title: 'Задачі епіка',
          icon: ICON,
          content: { type: 'iframe', url: t.signUrl('./section.html'), height: 200 },
        };
      });
    },

    'show-settings': function (t) {
      return t.popup({ title: 'Epic Tasks — налаштування', url: './settings.html', height: 470 });
    },

    'authorization-status': function (t) {
      return EpicAuth.isAuthorized(t).then(function (ok) { return { authorized: ok }; });
    },

    'show-authorization': function (t) {
      return t.popup({ title: 'Підключення Epic Tasks', url: './auth.html', height: 150 });
    },
  }, EpicAuth.iframeOptions());
})();

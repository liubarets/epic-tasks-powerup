/* global window, document */
// A drop-down list styled like Trello's own popover (title, ×, items, ✓ on the current one).
// It is drawn inside the Power-Up's iframe and always opens DOWN from its button: the iframe grows
// for the time the list is open (Trello's t.popup places itself and often opens upwards).
// EpicDropdown.open(button, { title, items: [{ text, checked, onPick }], resize: fn }) / EpicDropdown.close()
(function (root) {
  'use strict';
  var cur = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function close() {
    if (!cur) return;
    var c = cur;
    cur = null;
    if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
    document.body.style.paddingBottom = c.pad;
    if (c.anchor) c.anchor.setAttribute('aria-expanded', 'false');
    if (c.resize) c.resize();
  }

  function open(anchor, o) {
    // A second click on the same button closes its list.
    if (cur && cur.anchor === anchor) { close(); return null; }
    close();
    var el = document.createElement('div');
    el.className = 'dd';
    el.setAttribute('role', 'menu');
    el.innerHTML = '<div class="dd-head"><span class="dd-title">' + esc(o.title) + '</span>' +
      '<button type="button" class="dd-x" aria-label="Close" title="Close">×</button></div>' +
      '<ul class="dd-list">' + (o.items || []).map(function (it, i) {
        return '<li><button type="button" class="dd-item' + (it.checked ? ' on' : '') + '" role="menuitemradio" aria-checked="' + !!it.checked +
          '" data-i="' + i + '"><span class="dd-check">' + (it.checked ? '✓' : '') + '</span>' + esc(it.text) + '</button></li>';
      }).join('') + '</ul>';
    document.body.appendChild(el);
    var r = anchor.getBoundingClientRect();
    var sx = window.scrollX || 0, sy = window.scrollY || 0;
    var top = r.bottom + sy + 4;
    var left = r.left + sx;
    var maxLeft = document.documentElement.clientWidth - el.offsetWidth - 4 + sx;
    if (left > maxLeft) left = Math.max(4, maxLeft);
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    var pad = document.body.style.paddingBottom;
    // Make the page tall enough for the list below the button, then let Trello resize the iframe.
    var bodyBottom = document.body.getBoundingClientRect().bottom + sy;
    var extra = Math.ceil(top + el.offsetHeight + 8 - bodyBottom);
    if (extra > 0) {
      var base = parseFloat(window.getComputedStyle(document.body).paddingBottom) || 0;
      document.body.style.paddingBottom = (base + extra) + 'px';
    }
    cur = { el: el, anchor: anchor, pad: pad, resize: o.resize, items: o.items || [] };
    anchor.setAttribute('aria-expanded', 'true');
    if (o.resize) o.resize();
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.target.closest('.dd-x')) { close(); return; }
      var b = e.target.closest('.dd-item');
      if (!b) return;
      var it = cur && cur.items[Number(b.getAttribute('data-i'))];
      close();
      if (it && it.onPick) it.onPick();
    });
    var first = el.querySelector('.dd-item.on') || el.querySelector('.dd-item');
    if (first) try { first.focus({ preventScroll: true }); } catch (e) { /* old browsers */ }
    return el;
  }

  // A click anywhere else, Esc, or a click outside the iframe (it loses focus) closes the list.
  document.addEventListener('mousedown', function (e) {
    if (cur && !cur.el.contains(e.target) && !(cur.anchor && cur.anchor.contains(e.target))) close();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('blur', function () { close(); });

  root.EpicDropdown = { open: open, close: close, isOpen: function () { return !!cur; } };
})(this);

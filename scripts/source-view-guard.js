(function () {
  'use strict';
  if (window.__tqtSourceViewGuard) return;
  window.__tqtSourceViewGuard = true;

  // Ported from EX's shortcut/context-menu guard. Browser menus and already
  // downloaded resources remain outside a website's control.
  const legacyKeys = {67: 'c', 73: 'i', 74: 'j', 75: 'k', 83: 's', 85: 'u', 123: 'f12'};
  document.addEventListener('keydown', event => {
    const key = String(event.key || legacyKeys[event.keyCode] || '').toLowerCase();
    const sourceOrSave = (event.ctrlKey || event.metaKey) && ['u', 's'].includes(key);
    const inspector = ['i', 'j', 'c', 'k'].includes(key)
      && ((event.ctrlKey && event.shiftKey) || (event.metaKey && (event.altKey || event.shiftKey)));
    if (key !== 'f12' && !sourceOrSave && !inspector) return;
    event.preventDefault();
    event.stopPropagation();
  }, {capture: true, passive: false});
  document.addEventListener('contextmenu', event => event.preventDefault(), {capture: true, passive: false});
}());

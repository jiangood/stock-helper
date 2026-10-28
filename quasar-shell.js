/* Shared Quasar shell for the static GitHub Pages app. */
(function () {
  'use strict';
  if (!window.Vue || !window.Quasar || !document.getElementById('q-app')) return;

  var storedTheme = 'light';
  try {
    storedTheme = localStorage.getItem('stock-theme') === 'dark' ? 'dark' : 'light';
  } catch (_) {}
  document.documentElement.setAttribute('data-bs-theme', storedTheme);

  var path = window.location.pathname;
  var isAssets = /(?:^|\/)global-assets\.html$/.test(path);
  var hashTab = window.location.hash.slice(1);
  var initialTab = isAssets ? 'assets' :
    (hashTab === 'opportunity' || hashTab === 'business' ? hashTab : 'stocks');

  var app = Vue.createApp({
    data: function () {
      return {
        tab: initialTab,
        dark: storedTheme === 'dark'
      };
    }
  });
  app.use(Quasar, { config: { dark: storedTheme === 'dark' } });
  app.mount('#q-app');

  window.__stockQuasarSetDark = function (enabled) {
    try {
      var q = app.config.globalProperties.$q;
      if (q && q.dark) q.dark.set(!!enabled);
    } catch (_) {}
  };
})();

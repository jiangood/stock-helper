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
        dark: storedTheme === 'dark',
        search: '',
        group: '',
        status: '',
        groupOptions: [{ label: '全部分组', value: '' }],
        statusOptions: [
          { label: '全部状态', value: '' },
          { label: '重仓区', value: 'heavy' },
          { label: '接近重仓', value: 'near' },
          { label: '入场区', value: 'entry' },
          { label: '破净', value: 'pb' },
          { label: '八折', value: 'pb80' },
          { label: '小市值', value: 'small' },
          { label: '纪律全过', value: 'screen' },
          { label: '全过 + 买点', value: 'screenbuy' },
          { label: '风险', value: 'risk' }
        ]
      };
    },
    mounted: function () {
      var self = this;
      var nativeGroup = document.getElementById('group-filter');
      if (nativeGroup) {
        var syncOptions = function () {
          self.groupOptions = Array.prototype.map.call(nativeGroup.options, function (option) {
            return { label: option.textContent.trim(), value: option.value };
          });
          if (!self.groupOptions.length || self.groupOptions[0].value !== '') {
            self.groupOptions.unshift({ label: '全部分组', value: '' });
          }
        };
        syncOptions();
        if (window.MutationObserver) {
          var observer = new MutationObserver(syncOptions);
          observer.observe(nativeGroup, { childList: true });
        }
      }
    },
    methods: {
      syncSearch: function (value) {
        var input = document.getElementById('search-input');
        if (input) input.value = value || '';
        if (typeof window.applyFilter === 'function') window.applyFilter();
      },
      syncGroup: function (value) {
        var select = document.getElementById('group-filter');
        if (select) select.value = value == null ? '' : value;
        if (typeof window.applyFilter === 'function') window.applyFilter();
      },
      syncStatus: function (value) {
        var select = document.getElementById('status-filter');
        if (select) select.value = value == null ? '' : value;
        if (typeof window.applyFilter === 'function') window.applyFilter();
      }
    }
  });
  app.use(Quasar, { config: { dark: storedTheme === 'dark' } });
  var vm = app.mount('#q-app');

  window.__stockQuasarSetDark = function (enabled) {
    try {
      vm.dark = !!enabled;
      if (vm.$q && vm.$q.dark) vm.$q.dark.set(!!enabled);
    } catch (_) {}
  };
})();

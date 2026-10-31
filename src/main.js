import { createApp } from './app.js';
import { createNavigation } from './components/navigation.component.js';
import { createThemeSwitcher } from './components/theme-switcher.component.js';

const root = document.getElementById('app-view');
const navigationHost = document.getElementById('app-navigation');
const themeButton = document.getElementById('theme-btn');

if (!root || !navigationHost || !themeButton) {
  throw new Error('SPA 页面缺少必要的挂载节点');
}

const pages = {
  stocks: () => import('./pages/stocks.page.js'),
  market: () => import('./pages/market.page.js'),
  products: () => import('./pages/products.page.js'),
  'stock-detail': () => import('./pages/stock-detail.page.js'),
  health: () => import('./pages/health.page.js')
};

function renderNavigation() {
  const hash = window.location.hash.replace(/^#/, '');
  const active = hash.startsWith('/market') ? 'market'
    : hash.startsWith('/products') ? 'products'
      : hash.startsWith('/health') ? 'health'
        : 'stocks';
  navigationHost.replaceChildren(createNavigation({ activeRoute: active }));
}

const theme = createThemeSwitcher({ button: themeButton });
const app = createApp({ root, pages });
window.addEventListener('hashchange', renderNavigation);
renderNavigation();
app.start();

window.addEventListener('pagehide', () => {
  window.removeEventListener('hashchange', renderNavigation);
  theme.destroy();
  app.stop();
}, { once: true });

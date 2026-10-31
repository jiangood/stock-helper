import { createRouter } from './router.js';

export function createApp({ root, window: windowLike = window, pages = {}, renderNotFound } = {}) {
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new TypeError('createApp 需要有效的 root 容器');
  }

  let activePage = null;
  let activeCleanup = null;

  async function render(route, previousRoute) {
    if (typeof activeCleanup === 'function') {
      activeCleanup();
      activeCleanup = null;
    }
    if (activePage && typeof activePage.unmount === 'function') {
      await activePage.unmount({ root, route: previousRoute });
    }
    activePage = null;

    const loader = pages[route.name];
    if (!loader) {
      root.replaceChildren();
      if (typeof renderNotFound === 'function') renderNotFound(root, route);
      else {
        const message = document.createElement('p');
        message.textContent = '页面不存在';
        root.append(message);
      }
      return;
    }

    const page = await loader();
    if (!page || typeof page.mount !== 'function') {
      throw new TypeError(`页面模块 ${route.name} 必须导出 mount()`);
    }
    activePage = page;
    const cleanup = await page.mount({ root, route, previousRoute, navigate: path => router.navigate(path) });
    if (typeof cleanup === 'function') activeCleanup = cleanup;
  }

  const router = createRouter({
    window: windowLike,
    onRouteChange: (route, previousRoute) => {
      render(route, previousRoute).catch(error => {
        root.replaceChildren();
        const message = document.createElement('p');
        message.setAttribute('role', 'alert');
        message.textContent = '页面加载失败，请刷新后重试。';
        root.append(message);
        if (typeof windowLike.reportError === 'function') windowLike.reportError(error);
      });
    }
  });

  return {
    start() { router.start(); },
    stop() {
      router.stop();
      if (typeof activeCleanup === 'function') activeCleanup();
      activeCleanup = null;
      if (activePage && typeof activePage.unmount === 'function') {
        activePage.unmount({ root, route: router.current });
      }
      activePage = null;
    },
    navigate(path) { router.navigate(path); },
    get currentRoute() { return router.current; }
  };
}

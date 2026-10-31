import { createRouter } from './router.js';

export function createApp({ root, window: windowLike = window, pages = {}, renderNotFound } = {}) {
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new TypeError('createApp 需要有效的 root 容器');
  }

  const documentLike = root.ownerDocument || windowLike.document;
  if (!documentLike || typeof documentLike.createElement !== 'function') {
    throw new TypeError('SPA root 必须关联有效的 document');
  }

  let activePage = null;
  let activeCleanup = null;
  let renderQueue = Promise.resolve();
  let stopped = false;

  async function render(route, previousRoute) {
    if (stopped) return;
    if (typeof activeCleanup === 'function') {
      activeCleanup();
      activeCleanup = null;
    }
    if (activePage && typeof activePage.unmount === 'function') {
      await activePage.unmount({ root, route: previousRoute });
    }
    activePage = null;
    if (stopped) return;

    const loader = pages[route.name];
    if (!loader) {
      root.replaceChildren();
      if (typeof renderNotFound === 'function') renderNotFound(root, route);
      else {
        const message = documentLike.createElement('p');
        message.textContent = '页面不存在';
        root.append(message);
      }
      return;
    }

    const page = await loader();
    if (stopped) return;
    if (!page || typeof page.mount !== 'function') {
      throw new TypeError('页面模块 ' + route.name + ' 必须导出 mount()');
    }
    activePage = page;
    const cleanup = await page.mount({
      root,
      route,
      previousRoute,
      navigate: path => router.navigate(path)
    });
    if (typeof cleanup === 'function') activeCleanup = cleanup;
    if (stopped) {
      if (typeof activeCleanup === 'function') activeCleanup();
      activeCleanup = null;
      if (activePage && typeof activePage.unmount === 'function') {
        await activePage.unmount({ root, route });
      }
      activePage = null;
    }
  }

  const router = createRouter({
    window: windowLike,
    onRouteChange: (route, previousRoute) => {
      renderQueue = renderQueue
        .then(() => render(route, previousRoute))
        .catch(error => {
          root.replaceChildren();
          const message = documentLike.createElement('p');
          message.setAttribute('role', 'alert');
          message.textContent = '页面加载失败，请刷新后重试。';
          root.append(message);
          if (typeof windowLike.reportError === 'function') windowLike.reportError(error);
        });
    }
  });

  return {
    start() {
      stopped = false;
      router.start();
    },
    stop() {
      stopped = true;
      router.stop();
      renderQueue = renderQueue.then(async () => {
        if (typeof activeCleanup === 'function') activeCleanup();
        activeCleanup = null;
        if (activePage && typeof activePage.unmount === 'function') {
          await activePage.unmount({ root, route: router.current });
        }
        activePage = null;
      });
      return renderQueue;
    },
    navigate(path) { router.navigate(path); },
    get currentRoute() { return router.current; }
  };
}

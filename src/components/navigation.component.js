const DEFAULT_LINKS = [
  { label: '自选', path: '/stocks', name: 'stocks' },
  { label: '行情', path: '/market', name: 'market' },
  { label: '商品', path: '/products', name: 'products' },
  { label: '系统健康', path: '/health', name: 'health' }
];

export function createNavigation({ document: documentLike = document, activeRoute = 'stocks', links = DEFAULT_LINKS, className = '' } = {}) {
  const nav = documentLike.createElement('nav');
  nav.setAttribute('aria-label', '主导航');
  if (className) nav.className = className;
  for (const item of links) {
    const link = documentLike.createElement('a');
    link.href = '#' + item.path;
    link.textContent = item.label;
    link.dataset.route = item.name;
    link.className = 'main-nav-link';
    if (item.name === activeRoute) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}

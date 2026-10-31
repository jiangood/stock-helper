const STOCK_CODE_PATTERN = /^(?:sh|sz)?\d{6}$/i;

export function normalizeStockCode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!STOCK_CODE_PATTERN.test(raw)) return null;
  if (raw.startsWith('sh') || raw.startsWith('sz')) return raw;
  return /^[569]/.test(raw) ? 'sh' + raw : 'sz' + raw;
}

function route(name, path, params = {}) {
  return { name, path, params };
}

export function resolveRoute(locationLike = {}) {
  const hash = String(locationLike.hash || '').replace(/^#/, '');
  if (hash.startsWith('/')) {
    const parts = hash.split('/').filter(Boolean);
    if (parts.length === 1 && ['stocks', 'market', 'products', 'health'].includes(parts[0])) {
      return route(parts[0], '/' + parts[0]);
    }
    if (parts.length === 2 && parts[0] === 'stock') {
      let requestedCode = parts[1];
      try { requestedCode = decodeURIComponent(requestedCode); } catch (error) {
        return route('not-found', hash);
      }
      const code = normalizeStockCode(requestedCode);
      return code ? route('stock-detail', '/stock/' + code, { code }) : route('not-found', hash);
    }
    return route('not-found', hash || '/');
  }

  const pathname = String(locationLike.pathname || '/').replace(/\\/g, '/');
  const filename = pathname.split('/').filter(Boolean).pop() || '';
  if (filename === 'market.html') return route('market', '/market');
  if (filename === 'products.html') return route('products', '/products');
  if (filename === 'health.html') return route('health', '/health');
  if (filename === 'stock.html') {
    const params = new URLSearchParams(locationLike.search || '');
    const code = normalizeStockCode(params.get('code'));
    return code ? route('stock-detail', '/stock/' + code, { code }) : route('not-found', '/stock');
  }
  return route('stocks', '/stocks');
}

export function createRouter({ window: windowLike, onRouteChange } = {}) {
  if (!windowLike || !windowLike.location || typeof onRouteChange !== 'function') {
    throw new TypeError('createRouter 需要 window 和 onRouteChange');
  }

  let started = false;
  let current = null;

  const dispatch = () => {
    const next = resolveRoute(windowLike.location);
    if (current && current.name === next.name && current.path === next.path) return;
    const previous = current;
    current = next;
    onRouteChange(next, previous);
  };

  return {
    get current() { return current; },
    start() {
      if (started) return;
      started = true;
      windowLike.addEventListener('hashchange', dispatch);
      dispatch();
    },
    stop() {
      if (!started) return;
      windowLike.removeEventListener('hashchange', dispatch);
      started = false;
    },
    navigate(path) {
      const normalized = String(path || '').startsWith('/') ? String(path) : '/' + path;
      if (windowLike.location.hash !== '#' + normalized) windowLike.location.hash = normalized;
      else dispatch();
    }
  };
}

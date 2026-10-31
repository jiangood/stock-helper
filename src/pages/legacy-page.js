function legacyRouteFromUrl(url) {
  const file = url.pathname.split('/').pop() || '';
  if (file === 'market.html' || file === 'legacy-market.html') return '/market';
  if (file === 'products.html' || file === 'legacy-products.html') return '/products';
  if (file === 'health.html') return '/health';
  if (file === 'stock.html' || file === 'legacy-stock.html') {
    const code = url.searchParams.get('code');
    return code ? '/stock/' + encodeURIComponent(code) : '/stocks';
  }
  if (file === 'index.html' || file === 'legacy-stocks.html' || file === '') return '/stocks';
  return null;
}

export function mountLegacyPage({ root, src, title, window: windowLike = window } = {}) {
  if (!root || !src) throw new TypeError('旧页面桥接需要 root 和 src');
  const documentLike = root.ownerDocument;
  const frame = documentLike.createElement('iframe');
  frame.className = 'legacy-page-frame';
  frame.title = title || '旧版页面内容';
  frame.loading = 'eager';
  frame.referrerPolicy = 'same-origin';
  frame.setAttribute('allow', 'clipboard-read; clipboard-write');
  frame.src = new URL(src, documentLike.baseURI).href;

  function onFrameLoad() {
    let frameDocument;
    try { frameDocument = frame.contentDocument; } catch (error) { return; }
    if (!frameDocument) return;

    const legacyNavigation = frameDocument.querySelector('.sticky-top');
    if (legacyNavigation) legacyNavigation.style.display = 'none';
    const skipLink = frameDocument.querySelector('.skip-link');
    if (skipLink) skipLink.style.display = 'none';

    frameDocument.addEventListener('click', onFrameClick);
  }

  function onFrameClick(event) {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor || anchor.target === '_blank' || event.defaultPrevented ||
        (event.button !== 0) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let url;
    try { url = new URL(anchor.href, frame.contentWindow.location.href); } catch (error) { return; }
    if (url.origin !== windowLike.location.origin) return;
    const route = legacyRouteFromUrl(url);
    if (!route) return;
    event.preventDefault();
    windowLike.location.hash = route;
  }

  frame.addEventListener('load', onFrameLoad);
  root.replaceChildren(frame);
  return () => {
    try { frame.contentDocument && frame.contentDocument.removeEventListener('click', onFrameClick); } catch (error) {}
    frame.removeEventListener('load', onFrameLoad);
    frame.src = 'about:blank';
    root.replaceChildren();
  };
}

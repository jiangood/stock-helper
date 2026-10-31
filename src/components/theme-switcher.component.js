export function createThemeSwitcher({ button, document: documentLike = document, window: windowLike = window, storage = windowLike.localStorage } = {}) {
  if (!button) throw new TypeError('主题切换器需要 button');
  const root = documentLike.documentElement;
  const media = typeof windowLike.matchMedia === 'function'
    ? windowLike.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function apply(theme, persist = false) {
    root.setAttribute('data-bs-theme', theme);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
    if (persist) {
      try { storage.setItem('stock-theme', theme); } catch (error) {}
    }
  }

  function onClick() {
    const current = root.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light';
    apply(current === 'dark' ? 'light' : 'dark', true);
  }

  function onSystemChange(event) {
    let saved = null;
    try { saved = storage.getItem('stock-theme'); } catch (error) {}
    if (!saved) apply(event.matches ? 'dark' : 'light');
  }

  button.addEventListener('click', onClick);
  if (media && typeof media.addEventListener === 'function') media.addEventListener('change', onSystemChange);
  else if (media && typeof media.addListener === 'function') media.addListener(onSystemChange);

  let saved = null;
  try { saved = storage.getItem('stock-theme'); } catch (error) {}
  apply(saved || (media && media.matches ? 'dark' : 'light'));

  return {
    setTheme(theme) { if (theme === 'dark' || theme === 'light') apply(theme, true); },
    destroy() {
      button.removeEventListener('click', onClick);
      if (media && typeof media.removeEventListener === 'function') media.removeEventListener('change', onSystemChange);
      else if (media && typeof media.removeListener === 'function') media.removeListener(onSystemChange);
    }
  };
}

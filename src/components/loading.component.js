export function setLoading(element, loading, text) {
  if (!element) return;
  element.setAttribute('aria-busy', String(Boolean(loading)));
  element.hidden = !loading;
  const label = element.querySelector('[data-loading-text]');
  if (label && typeof text === 'string') label.textContent = text;
}

export function showToast(element, message, type = 'error') {
  if (!element) return;
  const variant = type === 'success' ? 'alert-success' : type === 'info' ? 'alert-info' : 'alert-danger';
  element.className = 'alert position-fixed bottom-0 start-50 translate-middle-x mb-3 py-2 px-3 small shadow ' + variant;
  element.textContent = String(message ?? '');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = false;
}

export function hideToast(element) {
  if (!element) return;
  element.hidden = true;
  element.textContent = '';
}

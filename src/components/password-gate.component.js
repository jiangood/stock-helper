export function mountPasswordGate({
  gate,
  form,
  input,
  remember,
  error,
  verifyPassword,
  document: documentLike = document,
  storage,
  session
} = {}) {
  if (!gate || !form || !input || typeof verifyPassword !== 'function') {
    throw new TypeError('密码门禁需要 gate、form、input 和 verifyPassword');
  }

  const windowLike = documentLike.defaultView;
  let localStore = storage || null;
  let sessionStore = session || null;
  try { if (!localStore && windowLike) localStore = windowLike.localStorage; } catch (error) {}
  try { if (!sessionStore && windowLike) sessionStore = windowLike.sessionStorage; } catch (error) {}
  const body = documentLike.body;
  const inertSnapshot = [];

  function safeGet(store) {
    try { return store && store.getItem('stock-helper-unlocked') === '1'; } catch (error) { return false; }
  }

  function safeSet(store, value) {
    try {
      if (value) store.setItem('stock-helper-unlocked', '1');
      else store.removeItem('stock-helper-unlocked');
    } catch (error) {}
  }

  function setBackgroundInert(enabled) {
    for (const element of Array.from(body.children)) {
      if (element === gate || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) continue;
      if (enabled) {
        inertSnapshot.push({ element, wasInert: element.hasAttribute('inert') });
        element.setAttribute('inert', '');
      } else {
        for (const item of inertSnapshot) {
          if (!item.wasInert) item.element.removeAttribute('inert');
        }
        inertSnapshot.length = 0;
      }
    }
  }

  function unlock() {
    gate.style.display = 'none';
    gate.setAttribute('aria-hidden', 'true');
    setBackgroundInert(false);
    body.style.overflow = '';
  }

  if (safeGet(localStore) || safeGet(sessionStore)) {
    unlock();
    return () => {};
  }

  setBackgroundInert(true);
  body.style.overflow = 'hidden';
  if (typeof input.focus === 'function') input.focus();

  function onKeydown(event) {
    if (event.key !== 'Tab') return;
    const focusables = gate.querySelectorAll('input, button, a[href]');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && documentLike.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentLike.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    if (verifyPassword(input.value)) {
      const persistent = Boolean(remember && remember.checked);
      safeSet(localStore, persistent);
      safeSet(sessionStore, !persistent);
      if (error) error.style.display = 'none';
      unlock();
    } else {
      if (error) error.style.display = 'block';
      input.setAttribute('aria-invalid', 'true');
      if (typeof input.select === 'function') input.select();
    }
  }

  function onInput() {
    if (error && error.style.display === 'block') {
      error.style.display = 'none';
      input.removeAttribute('aria-invalid');
    }
  }

  gate.addEventListener('keydown', onKeydown);
  form.addEventListener('submit', onSubmit);
  input.addEventListener('input', onInput);

  return function cleanup() {
    gate.removeEventListener('keydown', onKeydown);
    form.removeEventListener('submit', onSubmit);
    input.removeEventListener('input', onInput);
    setBackgroundInert(false);
    body.style.overflow = '';
  };
}

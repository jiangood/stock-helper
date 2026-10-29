(function () {
  const gate = document.getElementById('password-gate');
  if (!gate) return;
  const form = document.getElementById('password-gate-form');
  const input = document.getElementById('gate-password');
  const remember = document.getElementById('gate-remember');
  const error = document.getElementById('gate-error');

  // 门禁显示时，把页面其余部分设为 inert：焦点、点击和读屏都无法进入背景内容。
  function setBackgroundInert(on) {
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el === gate || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  function unlock() {
    gate.style.display = 'none';
    gate.setAttribute('aria-hidden', 'true');
    setBackgroundInert(false);
    document.body.style.overflow = '';
  }

  // Keep only the unlocked flag, never the password itself.
  if (localStorage.getItem('stock-helper-unlocked') === '1' ||
      sessionStorage.getItem('stock-helper-unlocked') === '1') {
    unlock();
    return;
  }

  setBackgroundInert(true);
  document.body.style.overflow = 'hidden';
  input.focus();

  // 焦点循环：背景已 inert，这里再兜住首尾，避免 Tab 落到 body。
  gate.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    const focusables = gate.querySelectorAll('input, button, a[href]');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (input.value === 'dayuchi0315') {
      if (remember.checked) {
        localStorage.setItem('stock-helper-unlocked', '1');
        sessionStorage.removeItem('stock-helper-unlocked');
      } else {
        sessionStorage.setItem('stock-helper-unlocked', '1');
        localStorage.removeItem('stock-helper-unlocked');
      }
      error.style.display = 'none';
      unlock();
    } else {
      error.style.display = 'block';
      input.setAttribute('aria-invalid', 'true');
      input.select();
    }
  });

  input.addEventListener('input', function () {
    if (error.style.display === 'block') {
      error.style.display = 'none';
      input.removeAttribute('aria-invalid');
    }
  });
})();

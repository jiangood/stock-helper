(function () {
  'use strict';
  let gate = document.getElementById('password-gate');

  // 所有页面共用门禁；没有静态门禁标记的页面在 DOM 就绪后自动挂载。
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'password-gate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'gate-title');
    gate.innerHTML = '<div class="gate-card" id="password-gate-form-wrap"><h1 id="gate-title">股票助手</h1><p id="gate-desc">请输入访问密码以继续</p><form id="password-gate-form"><label class="visually-hidden" for="gate-password">访问密码</label><input id="gate-password" type="password" placeholder="输入密码" autocomplete="current-password" required aria-describedby="gate-error"><label class="gate-remember"><input id="gate-remember" type="checkbox" checked> 在此设备记住登录状态</label><button type="submit">进入</button><div id="gate-error" class="gate-error" role="alert">密码不正确，请重试。</div></form></div>';
    document.body.appendChild(gate);
  }

  const form = document.getElementById('password-gate-form');
  const input = document.getElementById('gate-password');
  const remember = document.getElementById('gate-remember');
  const error = document.getElementById('gate-error');
  if (!form || !input || !remember || !error) return;

  gate.dataset.authState = 'checking';

  function setBackgroundInert(on) {
    Array.prototype.forEach.call(document.body.children, function (el) {
      if (el === gate || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  function unlock() {
    gate.style.display = 'none';
    gate.dataset.authState = 'unlocked';
    gate.setAttribute('aria-hidden', 'true');
    setBackgroundInert(false);
    document.body.style.overflow = '';
  }

  function showLogin() {
    gate.dataset.authState = 'required';
    gate.removeAttribute('aria-hidden');
    setBackgroundInert(true);
    document.body.style.overflow = 'hidden';
    input.focus();
  }

  // 先完成本地登录态检查，再决定显示页面还是登录框。
  let authenticated = false;
  try {
    authenticated = localStorage.getItem('stock-helper-unlocked') === '1' ||
      sessionStorage.getItem('stock-helper-unlocked') === '1';
  } catch (e) {
    console.warn('[PasswordGate] 无法读取本地登录状态:', e);
  }
  if (authenticated) {
    unlock();
    return;
  }
  showLogin();

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
    if (input.value !== 'dayuchi0315') {
      error.style.display = 'block';
      input.setAttribute('aria-invalid', 'true');
      input.select();
      return;
    }
    try {
      if (remember.checked) {
        localStorage.setItem('stock-helper-unlocked', '1');
        sessionStorage.removeItem('stock-helper-unlocked');
      } else {
        sessionStorage.setItem('stock-helper-unlocked', '1');
        localStorage.removeItem('stock-helper-unlocked');
      }
    } catch (e) {
      error.textContent = '无法保存登录状态，请检查浏览器存储权限后重试。';
      error.style.display = 'block';
      return;
    }
    error.style.display = 'none';
    unlock();
  });

  input.addEventListener('input', function () {
    if (error.style.display === 'block') {
      error.style.display = 'none';
      input.removeAttribute('aria-invalid');
    }
  });
})();
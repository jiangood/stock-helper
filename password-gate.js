(function () {
  'use strict';
  const gateStyle = document.createElement('style');
  gateStyle.textContent = '#password-gate{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:#f3f6fb;color:#172033;font-family:system-ui,sans-serif}#password-gate[data-auth-state="checking"]::before{content:"正在检查登录状态…";display:inline-flex;padding:18px 22px;border-radius:12px;background:#fff;color:#475569;font-size:14px;box-shadow:0 8px 30px rgba(15,23,42,.1)}#password-gate[data-auth-state="checking"]::after{content:"";position:absolute;width:16px;height:16px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:gate-spin .75s linear infinite;margin-left:-188px}@keyframes gate-spin{to{transform:rotate(360deg)}}#password-gate[data-auth-state="checking"] .gate-card{display:none}#password-gate[data-auth-state="unlocked"]{display:none}#password-gate .gate-card{width:100%;max-width:360px;padding:28px;border-radius:16px;background:#fff;box-shadow:0 12px 40px rgba(15,23,42,.12)}#password-gate h1{font-size:21px;margin:0 0 8px;font-weight:700}#password-gate p{color:#64748b;font-size:13px;margin:0 0 20px}#password-gate input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px;font-size:16px}#password-gate button{width:100%;padding:12px;border:0;border-radius:8px;background:#2563eb;color:white;font-weight:600;cursor:pointer}#password-gate .gate-remember{display:flex;align-items:center;gap:8px;margin:0 0 14px;color:#475569;font-size:13px}#password-gate .gate-remember input{width:16px;height:16px;margin:0}#password-gate .gate-error{display:none;margin-top:12px;color:#dc2626;font-size:13px}';
  document.head.appendChild(gateStyle);

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
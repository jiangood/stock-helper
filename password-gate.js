(function () {
  const gate = document.getElementById('password-gate');
  const form = document.getElementById('password-gate-form');
  const input = document.getElementById('gate-password');
  const remember = document.getElementById('gate-remember');
  const error = document.getElementById('gate-error');
  // Keep only the unlocked flag, never the password itself.
  if (localStorage.getItem('stock-helper-unlocked') === '1' ||
      sessionStorage.getItem('stock-helper-unlocked') === '1') {
    gate.style.display = 'none';
  }
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
      gate.style.display = 'none';
    } else {
      error.style.display = 'block';
      input.select();
    }
  });
})();

(function () {
  const status = document.getElementById('network-status');
  // The status indicator was removed from the page; skip UI updates when absent.
  if (!status) return;

  function updateStatus() {
    const online = navigator.onLine;
    status.textContent = online ? '联网' : '离线';
    status.classList.toggle('text-warning', !online);
    status.classList.toggle('text-secondary', online);}
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
})();

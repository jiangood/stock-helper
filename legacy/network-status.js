(function () {
  const status = document.getElementById('network-status');
  // The status indicator was removed from the page; skip UI updates when absent.
  if (!status) return;

  function updateStatus() {
    const online = navigator.onLine;
    status.textContent = online ? '联网' : '离线';
    status.classList.toggle('text-warning', !online);
    status.classList.toggle('text-secondary', online);
    status.title = online
      ? '网络可用；行情请求仍可能因数据源不可用而失败'
      : '当前网络不可用';
  }
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
})();

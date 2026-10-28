(function () {
  const status = document.getElementById('network-status');
  function updateStatus() {
    const online = navigator.onLine;
    status.textContent = online ? '联网' : '离线缓存';
    status.classList.toggle('text-warning', !online);
    status.classList.toggle('text-secondary', online);
    status.title = online
      ? '网络可用；行情请求仍可能因数据源不可用而失败'
      : '当前离线，页面和数据可能是缓存内容，请检查更新时间后再作判断';
  }
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function (error) {
        console.warn('Service worker registration failed:', error);
      });
    });
  }
})();

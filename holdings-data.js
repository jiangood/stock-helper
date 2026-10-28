/* Public, read-only holdings.json loader. No holdings or risk-plan writes to browser storage. */
(function (root) {
  'use strict';

  function positiveNumber(value, label) {
    if (value === null || value === undefined || value === '') throw new Error(label + ' must be a positive number');
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(label + ' must be a positive number');
    return n;
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('holdings.json must contain a JSON object');
    if (!Array.isArray(payload.holdings)) throw new Error('holdings.json holdings must be an array');
    var seenCodes = {};
    var holdings = payload.holdings.map(function (holding, index) {
      if (!holding || typeof holding !== 'object' || Array.isArray(holding)) throw new Error('holding #' + (index + 1) + ' must be an object');
      var code = String(holding.code || '').trim().toLowerCase();
      if (!/^(sh|sz)\d{6}$/.test(code)) throw new Error('holding #' + (index + 1) + ' has an invalid code');
      if (seenCodes[code]) throw new Error('duplicate holding code: ' + code);
      seenCodes[code] = true;
      return {
        code: code,
        quantity: positiveNumber(holding.quantity, code + ' quantity'),
        cost: positiveNumber(holding.cost, code + ' cost')
      };
    });
    return { schemaVersion: Number(payload.schemaVersion) || 1, holdings: holdings };
  }

  var cached = null;
  var pending = null;
  function load(force) {
    if (!root || typeof root.fetch !== 'function') return Promise.reject(new Error('Fetch is unavailable; serve the site over HTTP.'));
    if (force) { cached = null; pending = null; }
    if (cached && !force) return Promise.resolve(cached);
    if (pending && !force) return pending;
    var url = './data/holdings.json?ts=' + Date.now();
    pending = root.fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('holdings.json request failed (' + response.status + ')');
      return response.json();
    }).then(function (payload) {
      cached = validatePayload(payload);
      return cached;
    }).catch(function (error) {
      pending = null;
      throw error;
    }).then(function (value) {
      pending = null;
      return value;
    });
    return pending;
  }

  var api = { load: load, validatePayload: validatePayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) root.StockHoldings = api;
})(typeof window !== 'undefined' ? window : null);

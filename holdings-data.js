/* Public, read-only holdings.json loader. No holdings or risk-plan writes to browser storage. */
(function (root) {
  'use strict';

  function positiveOrNull(value, label, allowNull) {
    if (value === null || value === undefined || value === '') {
      if (allowNull) return null;
      throw new Error(label + ' must be a positive number');
    }
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(label + ' must be a positive number');
    return n;
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('holdings.json must contain a JSON object');
    }
    if (!Array.isArray(payload.holdings)) throw new Error('holdings.json holdings must be an array');
    var portfolio = payload.portfolio && typeof payload.portfolio === 'object' && !Array.isArray(payload.portfolio)
      ? payload.portfolio : {};
    var seenCodes = {};
    var holdings = payload.holdings.map(function (holding, index) {
      if (!holding || typeof holding !== 'object' || Array.isArray(holding)) {
        throw new Error('holding #' + (index + 1) + ' must be an object');
      }
      var code = String(holding.code || '').trim().toLowerCase();
      if (!/^(sh|sz)\d{6}$/.test(code)) throw new Error('holding #' + (index + 1) + ' has an invalid code');
      if (seenCodes[code]) throw new Error('duplicate holding code: ' + code);
      seenCodes[code] = true;
      var quantity = positiveOrNull(holding.quantity, code + ' quantity', false);
      var cost = positiveOrNull(holding.cost, code + ' cost', false);
      var riskExitPrice = positiveOrNull(holding.riskExitPrice, code + ' riskExitPrice', true);
      return {
        code: code,
        quantity: quantity,
        cost: cost,
        riskExitPrice: riskExitPrice
      };
    });
    return {
      schemaVersion: Number(payload.schemaVersion) || 1,
      updatedAt: String(payload.updatedAt || ''),
      portfolio: {
        totalAssets: positiveOrNull(portfolio.totalAssets, 'portfolio.totalAssets', true),
        riskBudget: positiveOrNull(portfolio.riskBudget, 'portfolio.riskBudget', true)
      },
      holdings: holdings
    };
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

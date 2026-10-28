/* Opportunity radar and business-cycle watchlist for stock-helper. */
(function (global) {
  'use strict';
  var stocks = [];
  var quotes = {};
  var KEY = 'stock-helper-business-history-v1';
  var items = [
    { id:'soda-ash', name:'纯碱', metric:'纯碱现货价', unit:'元/吨', stocks:['双环科技','中盐化工','三友化工'], chain:'玻璃、光伏玻璃、日用玻璃、硅酸钠', drivers:'重点看厂家库存、开工率、检修与新增产能；同时跟踪煤炭、合成氨等成本。', query:'纯碱 现货价格 厂家库存 周度' },
    { id:'urea', name:'尿素', metric:'尿素现货价', unit:'元/吨', stocks:['四川美丰'], chain:'煤头/气头生产 → 农业与工业需求', drivers:'看农业需求季节性、出口政策、日产量、企业库存和煤气成本。', query:'尿素 现货价格 企业库存 日产量' },
    { id:'methanol', name:'甲醇', metric:'甲醇现货价', unit:'元/吨', stocks:['双环科技'], chain:'煤/天然气 → 甲醇 → 烯烃、甲醛等', drivers:'看煤价、天然气、港口库存、装置检修和下游利润；公司实际业务暴露需核实。', query:'甲醇 现货价格 港口库存 生产利润' },
    { id:'tio2', name:'钛白粉', metric:'钛白粉价格', unit:'元/吨', stocks:['安纳达'], chain:'钛矿/硫酸 → 钛白粉 → 涂料、塑料、造纸', drivers:'看钛矿和硫酸成本、行业开工率、出口、库存及企业调价。', query:'钛白粉 价格 行业库存 成本' },
    { id:'aluminium', name:'电解铝', metric:'铝价', unit:'元/吨', stocks:['中国铝业'], chain:'氧化铝/电力 → 电解铝 → 加工材', drivers:'看铝价与氧化铝、电力成本价差，关注产能约束、库存和下游需求。', query:'沪铝价格 氧化铝价格 社会库存' },
    { id:'coal', name:'煤炭', metric:'煤价参考值', unit:'元/吨', stocks:['华阳股份'], chain:'矿山供给 → 电力、钢铁、化工', drivers:'动力煤与焦煤用途不同，记录时需固定煤种、产地和交货口径。', query:'动力煤 现货价格 库存 焦煤 价格' },
    { id:'rubber', name:'天然橡胶', metric:'天然橡胶现货价', unit:'元/吨', stocks:['海南橡胶'], chain:'天然橡胶 → 轮胎、汽车、工业制品', drivers:'看主产区天气、割胶季、库存、轮胎开工和合成胶价差。', query:'天然橡胶 现货价格 青岛库存' },
    { id:'rare-earth', name:'稀土', metric:'氧化镨钕参考价', unit:'元/吨', stocks:['北方稀土','盛和资源'], chain:'稀土矿/分离 → 磁材 → 新能源车、风电、电机', drivers:'关注配额、分离产量、磁材需求、出口政策和上下游库存。', query:'氧化镨钕 价格 稀土 库存' }
  ];
  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>\"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]; }); }
  function read() { try { var v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { if (global.showToast) global.showToast('保存失败：浏览器存储不可用'); return false; } }
  function showToast(msg) { var t = el('toast'); if (!t) return; t.className = 'position-fixed bottom-0 start-50 translate-middle-x mb-5 alert alert-secondary py-2 px-3'; t.textContent = msg; clearTimeout(t._hide); t._hide = setTimeout(function(){ t.className += ' d-none'; }, 2200); }
  function initForm() {
    var select = el('business-product');
    if (!select || select.options.length) return;
    select.innerHTML = items.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name + ' · ' + x.metric) + '</option>'; }).join('');
    el('business-date').value = new Date().toISOString().slice(0, 10);
    el('business-observation-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var item = items.find(function (x) { return x.id === el('business-product').value; });
      var date = el('business-date').value;
      var price = Number(el('business-price').value);
      if (!item || !date || !Number.isFinite(price) || price < 0) return;
      var history = read();
      var points = Array.isArray(history[item.id]) ? history[item.id].filter(function(p){ return p && Number.isFinite(Number(p.price)) && /^\d{4}-\d{2}-\d{2}$/.test(p.date); }) : [];
      points = points.filter(function (p) { return p.date !== date; });
      points.push({ date:date, price:price, note:el('business-note').value.trim().slice(0, 120) });
      points.sort(function (a,b) { return a.date.localeCompare(b.date); });
      history[item.id] = points.slice(-180);
      if (write(history)) { el('business-price').value = ''; el('business-note').value = ''; renderBusiness(); showToast('已保存观察点'); }
    });
    el('clear-business-history').addEventListener('click', function () {
      if (!global.confirm('确定清空本浏览器保存的全部商品观察记录？')) return;
      try { localStorage.removeItem(KEY); } catch (e) {}
      renderBusiness(); showToast('商品观察记录已清空');
    });
  }
  function renderOpportunity() {
    var summary = el('opportunity-summary'), list = el('opportunity-list');
    if (!summary || !list) return;
    var ready = stocks.map(function(s){ return {stock:s, quote:quotes[s.code], eval:Croc.evaluate(s, quotes[s.code])}; }).filter(function(x){ return x.quote && x.quote.price > 0; });
    var zone = ready.filter(function(x){ return x.eval.zone === 'heavy' || x.eval.zone === 'entry'; });
    var eligible = zone.filter(function(x){ return Croc.buyEligibility(x.stock, x.quote).eligible; });
    var screenbuy = ready.filter(function(x){ return Croc.matchStatus(x.stock, x.quote, 'screenbuy'); });
    summary.innerHTML = [['进入计划区',zone.length],['通过硬门槛',eligible.length],['纪律全过+买点',screenbuy.length]].map(function(x){return '<div class="col-4"><div class="insight-card h-100 p-2"><div class="mini-label">'+x[0]+'</div><div class="fs-4 fw-bold">'+x[1]+'</div></div></div>';}).join('');
    if (!ready.length) { list.innerHTML = '<div class="empty-state">行情尚未加载，请返回股票池刷新行情。</div>'; return; }
    var cards = zone.slice().sort(function(a,b){ var ea=Croc.buyEligibility(a.stock,a.quote).eligible?0:1; var eb=Croc.buyEligibility(b.stock,b.quote).eligible?0:1; return ea-eb || (a.eval.zone === 'heavy' ? 0 : 1) - (b.eval.zone === 'heavy' ? 0 : 1); });
    if (!cards.length) {
      list.innerHTML = '<div class="empty-state">当前没有进入计划区且通过硬门槛的标的。可以继续观察价格，或查看量化纪律名单。</div>' + (screenbuy.length ? '<div class="insight-card"><div class="fw-semibold mb-2">量化纪律全过 + 计划买点</div><div class="d-flex flex-wrap gap-2">' + screenbuy.map(function(x){return '<a class="btn btn-sm btn-outline-secondary" href="stock.html?code='+encodeURIComponent(x.stock.code)+'">'+esc(x.stock.name)+'</a>';}).join('') + '</div></div>' : '');
      return;
    }
    list.innerHTML = cards.map(function(x){
      var s=x.stock, q=x.quote, e=x.eval, gate=Croc.buyEligibility(s,q);
      var change = typeof q.todayChange === 'number' ? ((q.todayChange > 0 ? '+' : '') + q.todayChange.toFixed(2) + '%') : '—';
      var changeClass = q.todayChange > 0 ? 'text-up' : q.todayChange < 0 ? 'text-down' : 'text-body-secondary';
      return '<article class="insight-card"><div class="d-flex justify-content-between align-items-start gap-2"><div><a class="fw-bold text-body text-decoration-none" href="stock.html?code='+encodeURIComponent(s.code)+'">'+esc(s.name)+'</a><div class="mini-label">'+esc(s.group || '')+' · '+esc(s.code)+'</div></div><span class="flag '+(e.zone === 'heavy' ? 'flag-buy' : 'flag-warn')+'">'+(e.zone === 'heavy' ? '重仓价区间' : '入场价区间')+'</span></div><div class="d-flex align-items-baseline gap-2 mt-2"><span class="business-price">'+q.price.toFixed(2)+'</span><span class="'+changeClass+'">'+change+'</span></div><div class="d-flex flex-wrap gap-2 mt-2 mini-label"><span>入场 '+(s.entry == null ? '—' : Number(s.entry).toFixed(2))+'</span><span>重仓 '+(s.heavy == null ? '—' : Number(s.heavy).toFixed(2))+'</span><span>PE '+(q.pe == null ? '—' : q.pe.toFixed(2))+'</span><span>PB '+(q.pb == null ? '—' : q.pb.toFixed(2))+'</span></div><div class="mt-2 small '+(gate.eligible ? 'text-success' : 'text-warning-emphasis')+'">'+esc(gate.reason || '通过硬门槛；仍需核对基本面与周期')+'</div><a class="btn btn-sm btn-outline-primary mt-2" href="stock.html?code='+encodeURIComponent(s.code)+'">查看个股详情</a></article>';
    }).join('');
  }
  function renderBusiness() {
    var container = el('business-cards'); if (!container) return;
    var history = read();
    container.innerHTML = items.map(function(item){
      var points = (Array.isArray(history[item.id]) ? history[item.id] : []).filter(function(p){return p && Number.isFinite(Number(p.price));}).slice().sort(function(a,b){return a.date.localeCompare(b.date);});
      var first=points[0], last=points[points.length-1], delta=first && last && Number(first.price)!==0 ? (Number(last.price)-Number(first.price))/Number(first.price)*100 : null;
      var trend = delta == null ? '尚无记录' : ((delta > 0 ? '+' : '') + delta.toFixed(2) + '%');
      var tone = delta == null ? 'text-body-secondary' : delta > 0 ? 'text-up' : delta < 0 ? 'text-down' : 'text-body-secondary';
      var chart = '<div class="empty-state py-2 small">录入两个以上日期的观察点后显示趋势线</div>';
      if (points.length >= 2) {
        var sample=points.slice(-12), vals=sample.map(function(p){return Number(p.price);}), min=Math.min.apply(null,vals), max=Math.max.apply(null,vals), range=max-min || 1;
        var coords=vals.map(function(v,i){return (8+i*(284/Math.max(1,vals.length-1)))+','+(48-((v-min)/range)*36);});
        chart='<svg class="trend-svg" viewBox="0 0 300 58" role="img" aria-label="'+esc(item.name)+'手工记录趋势"><polyline points="'+coords.join(' ')+'"></polyline>'+coords.map(function(c){var xy=c.split(',');return '<circle cx="'+xy[0]+'" cy="'+xy[1]+'" r="2.5"></circle>';}).join('')+'</svg>';
      }
      var links=item.stocks.map(function(name){var s=stocks.find(function(x){return x.name===name;});return s?'<a class="btn btn-sm btn-outline-secondary me-1 mb-1" href="stock.html?code='+encodeURIComponent(s.code)+'">'+esc(name)+'</a>':'<span class="tag me-1">'+esc(name)+'</span>';}).join('');
      var recent=points.slice(-3).reverse().map(function(p){return '<div class="d-flex justify-content-between mini-label py-1 border-top"><span>'+esc(p.date)+(p.note?' · '+esc(p.note):'')+'</span><span class="fw-semibold">'+Number(p.price).toLocaleString('zh-CN')+' '+esc(item.unit)+'</span></div>';}).join('');
      var search='https://www.baidu.com/s?wd='+encodeURIComponent(item.query);
      return '<article class="insight-card"><div class="d-flex justify-content-between align-items-start gap-2"><div><div class="fw-bold">'+esc(item.name)+'</div><div class="mini-label">'+esc(item.metric)+' · '+esc(item.unit)+'</div></div><span class="flag" style="margin:0">手工记录</span></div><div class="d-flex align-items-baseline justify-content-between mt-2 gap-2"><div class="business-price">'+(last?Number(last.price).toLocaleString('zh-CN'):'—')+'</div><div class="'+tone+' fw-semibold">'+trend+'</div></div><div class="mini-label">'+(last?'最新记录：'+esc(last.date):'尚无价格记录；可先查询外部报价')+'</div><div class="mt-2">'+chart+'</div><div class="mini-label mt-1">产业链：'+esc(item.chain)+'</div><div class="small mt-2">'+esc(item.drivers)+'</div><div class="mt-2"><div class="mini-label mb-1">关联股票池</div>'+links+'</div>'+(recent?'<div class="mt-2">'+recent+'</div>':'')+'<div class="mt-2"><a href="'+search+'" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary">查询价格 / 库存</a></div></article>';
    }).join('');
  }
  function init(stocksArg, quoteArg) {
    stocks=Array.isArray(stocksArg)?stocksArg:[]; quotes=quoteArg || {};
    var select=el('business-product');
    if (select && !select.options.length) { select.innerHTML=items.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name+' · '+x.metric)+'</option>';}).join(''); el('business-date').value=new Date().toISOString().slice(0,10);
      el('business-observation-form').addEventListener('submit', function(event){event.preventDefault();var item=items.find(function(x){return x.id===select.value;}),date=el('business-date').value,price=Number(el('business-price').value);if(!item||!date||!Number.isFinite(price)||price<0)return;var h=read(),p=Array.isArray(h[item.id])?h[item.id]:[];p=p.filter(function(x){return x.date!==date;});p.push({date:date,price:price,note:el('business-note').value.trim().slice(0,120)});p.sort(function(a,b){return a.date.localeCompare(b.date);});h[item.id]=p.slice(-180);if(write(h)){el('business-price').value='';el('business-note').value='';renderBusiness();showToast('已保存观察点');}});
      el('clear-business-history').addEventListener('click',function(){if(!global.confirm('确定清空本浏览器保存的全部商品观察记录？'))return;try{localStorage.removeItem(KEY);}catch(e){}renderBusiness();showToast('商品观察记录已清空');});
    }
    renderBusiness(); renderOpportunity();
  }
  function onTab(target) { if(target==='business')renderBusiness(); if(target==='opportunity')renderOpportunity(); }
  global.StockBusiness={init:init,onTab:onTab,renderOpportunity:renderOpportunity,renderBusiness:renderBusiness};
})(window);

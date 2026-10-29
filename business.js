/* Opportunity radar and business-cycle watchlist for stock-helper. */
(function (global) {
  'use strict';
  var stocks = [];
  var quotes = {};
  var businessData = null;
  var businessFetchPromise = null;
  var businessCharts = {};
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
  var quoteClient = null, marketIndices = {}, marketIndexKlines = {}, marketIndexKlineStatus = {};
  function fmtPct(v){return v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':((Number(v)>0?'+':'')+Number(v).toFixed(2)+'%');}
  function fmtMoney(v){return Number.isFinite(Number(v))?Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';}
  function tone(v){return Number(v)>0?'text-up':Number(v)<0?'text-down':'text-body-secondary';}
  function stockForCode(code){var c=String(code||'').trim().toLowerCase();if(/^\d{6}$/.test(c))c=(/^[5689]/.test(c)?'sh':'sz')+c;return stocks.find(function(s){return String(s.code||'').toLowerCase()===c;})||null;}
  function renderBriefMarketTime(){
    var node=el('brief-market-time');if(!node)return;
    var available=Object.keys(marketIndices).some(function(code){var q=marketIndices[code];return q&&Number(q.price)>0;});
    node.textContent=available?'A股行情基准：指数最新有效报价 · 行情源未提供可核实的报价时间':'A股行情基准：暂无有效指数报价';
  }
  function renderIndexMonthlyCurve(code){
    var bars=marketIndexKlines[code]||[];
    var status=marketIndexKlineStatus[code];
    if(!bars.length)return '<div class="index-monthly-empty mini-label">'+(status==='loading'?'月线加载中…':status==='error'?'月线暂不可用':'等待月线数据')+'</div>';
    var visible=bars.slice(-12), values=visible.map(function(bar){return Number(bar.close);});
    var min=Math.min.apply(null,values),max=Math.max.apply(null,values),range=max-min||Math.max(Math.abs(max)*0.01,0.01);
    var left=8,right=292,top=8,bottom=60,step=(right-left)/Math.max(1,visible.length-1);
    var points=visible.map(function(bar,i){
      var x=visible.length===1?(left+right)/2:left+step*i;
      var y=top+(max-Number(bar.close))/range*(bottom-top);
      return x.toFixed(2)+','+y.toFixed(2);
    }).join(' ');
    var first=String(visible[0].time||'').slice(0,7),last=String(visible[visible.length-1].time||'').slice(0,7);
    return '<div class="index-monthly-wrap"><div class="d-flex justify-content-between align-items-center"><span class="mini-label">月线 · 最近'+visible.length+'个月</span><span class="mini-label">'+esc(first)+' — '+esc(last)+'</span></div><svg class="index-monthly-curve" viewBox="0 0 300 76" role="img" aria-label="'+esc(code)+'最近'+visible.length+'个月收盘价曲线"><line x1="8" y1="68" x2="292" y2="68" stroke="var(--bs-border-color)" stroke-width="1"/><polyline points="'+points+'"/></svg><div class="mini-label">按月收盘价连线 · 本月数据可能尚未收盘</div></div>';
  }
  function renderMarketIndices(){
    var node=el('market-index-summary');if(!node)return;
    var specs=[{code:'sh000001',name:'上证指数'},{code:'sz399001',name:'深证成指'},{code:'sz399006',name:'创业板指'}];
    node.innerHTML=specs.map(function(x){var q=marketIndices[x.code];return '<article class="insight-card index-market-card"><div class="mini-label">'+x.name+'</div><div class="business-price">'+(q&&q.price>0?Number(q.price).toFixed(2):'—')+'</div><div class="'+(q?tone(q.todayChange):'text-body-secondary')+' fw-semibold">'+(q?fmtPct(q.todayChange):'指数行情暂不可用')+'</div>'+renderIndexMonthlyCurve(x.code)+'</article>';}).join('');
    renderBriefMarketTime();
  }
  function fetchMarketIndexKlines(){
    if(!quoteClient||typeof quoteClient.fetchKline!=='function')return;
    ['sh000001','sz399001','sz399006'].forEach(function(code){
      if(marketIndexKlineStatus[code]==='loading'||marketIndexKlineStatus[code]==='loaded')return;
      marketIndexKlineStatus[code]='loading';
      quoteClient.fetchKline(code,{period:'month',count:12,adjust:'none'}).then(function(result){
        var bars=result&&Array.isArray(result.bars)?result.bars:[];
        marketIndexKlines[code]=bars.filter(function(bar){return bar&&Number(bar.open)>0&&Number(bar.close)>0&&Number(bar.high)>0&&Number(bar.low)>0;});
        marketIndexKlineStatus[code]=marketIndexKlines[code].length?'loaded':'error';
        renderMarketIndices();
      }).catch(function(){marketIndexKlineStatus[code]='error';renderMarketIndices();});
    });
  }
  function renderMarketPulse(){
    var node=el('market-pulse-summary');if(!node)return;
    var live=stocks.map(function(s){return {s:s,q:quotes[s.code]};}).filter(function(x){return x.q&&Number(x.q.price)>0;});
    var up=live.filter(function(x){return Number(x.q.todayChange)>0;}).length,down=live.filter(function(x){return Number(x.q.todayChange)<0;}).length,flat=live.length-up-down;
    var avg=live.length?live.reduce(function(a,x){return a+(Number.isFinite(Number(x.q.todayChange))?Number(x.q.todayChange):0);},0)/live.length:null;
    var zone=live.filter(function(x){var z=Croc.evaluate(x.s,x.q).zone;return z==='heavy'||z==='entry';}).length;
    var cards=[['涨 / 跌 / 平',up+' / '+down+' / '+flat,'仅统计本股票池，不代表全市场'],['股票池平均涨跌',fmtPct(avg),'等权平均温度参考'],['到计划价区',zone+' 只','按股票池入场 / 重仓计划价统计']];
    node.innerHTML=cards.map(function(x){return '<div class="col-6 col-xl-4"><div class="insight-card h-100"><div class="mini-label">'+x[0]+'</div><div class="fs-4 fw-bold">'+x[1]+'</div><div class="mini-label">'+x[2]+'</div></div></div>';}).join('');
  }
  function renderSectors(){
    var node=el('sector-hotspots');if(!node)return;var groups={};
    stocks.forEach(function(s){var q=quotes[s.code],key=s.group||'未分类';if(!groups[key])groups[key]={name:key,count:0,live:0,up:0,down:0,sum:0,zone:0,leaders:[]};var g=groups[key];g.count++;
      if(q&&Number(q.price)>0){g.live++;var ch=Number(q.todayChange);if(Number.isFinite(ch)){g.sum+=ch;if(ch>0)g.up++;if(ch<0)g.down++;g.leaders.push({name:s.name,code:s.code,change:ch});}
        var z=Croc.evaluate(s,q).zone;if(z==='heavy'||z==='entry')g.zone++;}});
    var rows=Object.keys(groups).map(function(k){var g=groups[k];g.avg=g.live?g.sum/g.live:null;g.leaders.sort(function(a,b){return b.change-a.change;});return g;}).sort(function(a,b){return (b.avg==null?-999:b.avg)-(a.avg==null?-999:a.avg);});
    node.innerHTML=rows.map(function(g){var leaders=g.leaders.slice(0,3).map(function(s){return '<a class="text-body text-decoration-none me-2" href="stock.html?code='+encodeURIComponent(s.code)+'">'+esc(s.name)+' <span class="'+tone(s.change)+'">'+fmtPct(s.change)+'</span></a>';}).join('')||'<span class="mini-label">暂无有效涨跌数据</span>';
      return '<article class="insight-card"><div class="d-flex justify-content-between align-items-start gap-2"><div class="fw-bold">'+esc(g.name)+'</div><span class="flag" style="margin:0">'+g.live+'/'+g.count+' 只有行情</span></div><div class="d-flex flex-wrap align-items-baseline gap-2 mt-2"><span class="business-price '+tone(g.avg)+'">'+fmtPct(g.avg)+'</span><span class="mini-label">平均涨跌</span><span class="mini-label">涨 '+g.up+' · 跌 '+g.down+' · 到计划区 '+g.zone+'</span></div><div class="mini-label mt-2 mb-1">板块内涨幅靠前</div><div>'+leaders+'</div></article>';}).join('')||'<div class="empty-state">暂无分组数据。</div>';
  }
  function renderOpportunity(){
    var summary=el('opportunity-summary'),list=el('opportunity-list');if(!summary||!list)return;
    var ready=stocks.map(function(s){return {stock:s,quote:quotes[s.code],eval:Croc.evaluate(s,quotes[s.code])};}).filter(function(x){return x.quote&&x.quote.price>0;});
    var zone=ready.filter(function(x){return x.eval.zone==='heavy'||x.eval.zone==='entry';}),eligible=zone.filter(function(x){return Croc.buyEligibility(x.stock,x.quote).eligible;}),screenbuy=ready.filter(function(x){return Croc.matchStatus(x.stock,x.quote,'screenbuy');});
    summary.innerHTML=[['进入计划区',zone.length],['通过硬门槛',eligible.length],['纪律全过+买点',screenbuy.length]].map(function(x){return '<div class="col-4"><div class="insight-card h-100 p-2"><div class="mini-label">'+x[0]+'</div><div class="fs-4 fw-bold">'+x[1]+'</div></div></div>';}).join('');
    if(!ready.length)list.innerHTML='<div class="empty-state">行情尚未加载，请返回股票池刷新行情。</div>';
    else {var cards=zone.slice().sort(function(a,b){var ea=Croc.buyEligibility(a.stock,a.quote).eligible?0:1,eb=Croc.buyEligibility(b.stock,b.quote).eligible?0:1;return ea-eb||(a.eval.zone==='heavy'?0:1)-(b.eval.zone==='heavy'?0:1);});
      if(!cards.length)list.innerHTML='<div class="empty-state">当前没有进入计划区的标的。可继续观察价格，或查看量化纪律名单。</div>'+(screenbuy.length?'<div class="insight-card"><div class="fw-semibold mb-2">量化纪律全过 + 计划买点</div><div class="d-flex flex-wrap gap-2">'+screenbuy.map(function(x){return '<a class="text-body text-decoration-none me-2" href="stock.html?code='+encodeURIComponent(x.stock.code)+'">'+esc(x.stock.name)+'</a>';}).join('')+'</div></div>':'');
      else list.innerHTML=cards.map(function(x){var s=x.stock,q=x.quote,e=x.eval,gate=Croc.buyEligibility(s,q);return '<article class="insight-card"><div class="d-flex justify-content-between align-items-start gap-2"><div><a class="fw-bold text-body text-decoration-none" href="stock.html?code='+encodeURIComponent(s.code)+'">'+esc(s.name)+'</a><div class="mini-label">'+esc(s.group||'')+' · '+esc(s.code)+'</div></div><span class="flag '+(e.zone==='heavy'?'flag-buy':'flag-warn')+'">'+(e.zone==='heavy'?'重仓价区间':'入场价区间')+'</span></div><div class="d-flex align-items-baseline gap-2 mt-2"><span class="business-price">'+Number(q.price).toFixed(2)+'</span><span class="'+tone(q.todayChange)+'">'+fmtPct(q.todayChange)+'</span></div><div class="d-flex flex-wrap gap-2 mt-2 mini-label"><span>入场 '+(s.entry==null?'—':Number(s.entry).toFixed(2))+'</span><span>重仓 '+(s.heavy==null?'—':Number(s.heavy).toFixed(2))+'</span><span>PE '+(q.pe==null?'—':Number(q.pe).toFixed(2))+'</span><span>PB '+(q.pb==null?'—':Number(q.pb).toFixed(2))+'</span></div><div class="mt-2 small '+(gate.eligible?'text-success':'text-warning-emphasis')+'">'+esc(gate.reason||'通过硬门槛；仍需核对基本面与周期')+'</div></article>';}).join('');
    }
    renderMarketIndices();renderMarketPulse();renderSectors();
    var updated=el('brief-updated');
    if(updated){
      updated.textContent='正在读取行情缓存日期…';
      if(window.StockQuotes&&typeof window.StockQuotes.snapshotInfo==='function'){
        window.StockQuotes.snapshotInfo().then(function(info){
          var marketDate=info&&info.marketDate?info.marketDate:'未知';
          var cacheTime=info&&info.updatedAt?new Date(info.updatedAt).toLocaleString('zh-CN',{hour12:false}):'未知';
          updated.textContent='行情日期：'+marketDate+' · 缓存生成：'+cacheTime+(info&&info.status==='stale'?' · 数据可能滞后':'');
        }).catch(function(){updated.textContent='行情缓存状态暂不可用';});
      }else updated.textContent='行情缓存日期暂不可用';
    }
  }
  function fetchMarketIndices(){if(!quoteClient||typeof quoteClient.fetch!=='function')return;quoteClient.fetch(['sh000001','sz399001','sz399006']).then(function(data){marketIndices=data||{};renderMarketIndices();fetchMarketIndexKlines();}).catch(function(){renderMarketIndices();fetchMarketIndexKlines();});}
  function formatNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
  }
  function renderBusiness() {
    var container = el('business-cards');
    if (!container) return;
    Object.keys(businessCharts).forEach(function(key) {
      try { businessCharts[key].remove(); } catch (error) { /* ignore detached charts */ }
    });
    businessCharts = {};
    var businessChartSpecs = [];
    var payloadItems = businessData && businessData.items ? businessData.items : {};
    var products = items.map(function (meta) {
      var data = payloadItems[meta.id] || {};
      return { meta: meta, data: data };
    });
    container.innerHTML = products.map(function (entry) {
      var meta = entry.meta, data = entry.data;
      var series = Array.isArray(data.series) ? data.series.filter(function (p) {
        return p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && (Number(p.spot) > 0 || Number(p.futures) > 0);
      }).slice().sort(function (a,b) { return a.date.localeCompare(b.date); }) : [];
      var metricKey = series.some(function(p){ return Number(p.spot)>0; }) ? 'spot' : 'futures';
      var points = series.filter(function(p){ return Number(p[metricKey])>0; }).slice(-60);
      var last = data.latest != null && Number(data.latest)>0 ? Number(data.latest) : (points.length ? Number(points[points.length-1][metricKey]) : null);
      var latestDate = data.latestDate || (points.length ? points[points.length-1].date : null);
      var delta = null;
      if (points.length > 1 && Number(points[0][metricKey]) > 0) {
        delta = (Number(points[points.length-1][metricKey]) / Number(points[0][metricKey]) - 1) * 100;
      } else if (Number.isFinite(Number(data.changePct))) {
        delta = Number(data.changePct);
      }
      var trend = delta == null ? '趋势数据不足' : ((delta > 0 ? '+' : '') + delta.toFixed(2) + '%');
      var tone = delta == null ? 'text-body-secondary' : delta > 0 ? 'text-up' : delta < 0 ? 'text-down' : 'text-body-secondary';
      var chart = '<div class="empty-state py-2 small">' + (last ? '该来源暂未提供可绘制的历史序列' : '等待自动数据源返回有效报价') + '</div>';
      if (points.length >= 2) {
        var chartId = 'business-price-chart-' + meta.id;
        businessChartSpecs.push({
          id: chartId,
          name: meta.name,
          unit: data.unit || meta.unit || '',
          data: points.map(function(p){ return { time: p.date, value: Number(p[metricKey]) }; })
        });
        chart = '<div class="business-chart-wrap"><div class="business-chart-caption"><span>'+esc(meta.name)+'价格走势</span><span>近'+points.length+'个数据点</span></div><div class="business-price-chart" id="'+chartId+'" role="img" aria-label="'+esc(meta.name)+'历史价格曲线"></div></div>';
      }
      var related = (data.stocks || meta.stocks || []).map(function(name){
        var stock = stocks.find(function(s){ return s.name === name; });
        return stock ? '<a class="text-body text-decoration-none me-1 mb-1" href="stock.html?code='+encodeURIComponent(stock.code)+'">'+esc(name)+'</a>' : '<span class="tag me-1">'+esc(name)+'</span>';
      }).join('');
      var source = data.source || '暂未匹配到可靠的自动报价源';
      var sourceLink = data.sourceUrl ? '<a href="'+esc(data.sourceUrl)+'" target="_blank" rel="noopener noreferrer">查看来源</a>' : '';
      var status = data.status === 'ok' ? '现货 / 期货历史' : data.status === 'latest-only' ? '自动最新报价' : '等待可靠数据源';
      var monthlyPrices = data.monthlyPrices && Array.isArray(data.monthlyPrices.series)
        ? data.monthlyPrices.series.filter(function(p){ return p && Number(p.value)>0; }).slice(-6)
        : [];
      var monthlyPriceHtml = '';
      if (monthlyPrices.length >= 2) {
        var monthlyValues = monthlyPrices.map(function(p){ return Number(p.value); });
        var monthlyMin = Math.min.apply(null, monthlyValues), monthlyMax = Math.max.apply(null, monthlyValues);
        var monthlyRange = monthlyMax - monthlyMin || 1;
        var monthlyCoords = monthlyValues.map(function(v,i){ return (5+i*(270/Math.max(1,monthlyValues.length-1)))+','+(32-((v-monthlyMin)/monthlyRange)*23); });
        monthlyPriceHtml = '<div class="mt-2 p-2 rounded border"><div class="mini-label">近月价格快照（来源提供的月份口径）</div><svg class="trend-svg mt-1" viewBox="0 0 280 38" role="img" aria-label="'+esc(meta.name)+'近月价格快照"><polyline points="'+monthlyCoords.join(' ')+'"></polyline></svg><div class="d-flex justify-content-between flex-wrap gap-1">'+monthlyPrices.map(function(p){return '<span class="mini-label">'+esc(p.label)+' '+formatNumber(p.value)+'</span>';}).join('')+'</div><div class="mini-label mt-1"><a href="'+esc(data.monthlyPrices.sourceUrl || 'https://data.eastmoney.com/ifdata/xhgp.html')+'" target="_blank" rel="noopener noreferrer">快照来源</a> · 非日频行情</div></div>';
      }
      var basisPoint = series.slice().reverse().find(function(p){return Number(p.spot)>0 && Number(p.futures)>0;});
      var basisHtml = '';
      if (basisPoint) {
        var basisValue = Number(basisPoint.spot)-Number(basisPoint.futures);
        var basisRate = basisValue/Number(basisPoint.futures)*100;
        var basisLabel = basisValue>0 ? '现货升水' : basisValue<0 ? '现货贴水' : '现货期货平水';
        basisHtml = '<div class="mini-label mt-2">历史同日基差：'+(basisValue>0?'+':'')+formatNumber(basisValue)+' '+esc(data.unit || meta.unit || '')+'（'+basisLabel+'，'+(basisRate>0?'+':'')+basisRate.toFixed(2)+'%） · 日期：'+esc(basisPoint.date)+'</div>';
      }
      var inventory = data.inventory && Number(data.inventory.latest) > 0 ? data.inventory : null;
      var inventoryChange = inventory && Number.isFinite(Number(inventory.change))
        ? ((Number(inventory.change) > 0 ? '+' : '') + formatNumber(inventory.change))
        : '—';
      var inventoryPoints = inventory && Array.isArray(inventory.series)
        ? inventory.series.filter(function(p){ return p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number(p.value)>0; }).slice(-30)
        : [];
      var inventoryChart = '';
      if (inventoryPoints.length >= 2) {
        var inventoryValues = inventoryPoints.map(function(p){ return Number(p.value); });
        var inventoryMin = Math.min.apply(null, inventoryValues), inventoryMax = Math.max.apply(null, inventoryValues);
        var inventoryRange = inventoryMax - inventoryMin || 1;
        var inventoryCoords = inventoryValues.map(function(v,i){ return (4+i*(272/Math.max(1,inventoryValues.length-1)))+','+(34-((v-inventoryMin)/inventoryRange)*26); });
        inventoryChart = '<svg class="trend-svg mt-1" viewBox="0 0 280 40" role="img" aria-label="'+esc(meta.name)+'期货仓单库存趋势"><polyline points="'+inventoryCoords.join(' ')+'"></polyline></svg><div class="mini-label">仓单趋势：近'+inventoryPoints.length+'个数据点</div>';
      }
      var inventoryHtml = inventory
        ? '<div class="mt-2 p-2 rounded border"><div class="mini-label">'+esc(inventory.label || '期货仓单库存')+'</div><div class="d-flex justify-content-between align-items-baseline gap-2"><strong>'+formatNumber(inventory.latest)+'</strong><span class="mini-label">较上期 '+inventoryChange+'</span></div><div class="mini-label">日期：'+esc(inventory.latestDate || '—')+' · <a href="'+esc(inventory.sourceUrl || 'https://data.eastmoney.com/ifdata/kcsj.html')+'" target="_blank" rel="noopener noreferrer">数据来源</a></div>'+inventoryChart+'</div>'
        : '<div class="mini-label mt-2">供需指标：该品种暂未取得可靠的自动仓单数据</div>';
      var marketSignalHtml = '';
      if (points.length >= 4 && inventoryPoints.length >= 4) {
        var priceBase = Number(points[Math.max(0, points.length-5)][metricKey]);
        var priceEnd = Number(points[points.length-1][metricKey]);
        var invBase = Number(inventoryPoints[Math.max(0, inventoryPoints.length-5)].value);
        var invEnd = Number(inventoryPoints[inventoryPoints.length-1].value);
        if (priceBase>0 && invBase>0 && priceEnd>0 && invEnd>0) {
          var shortPriceChange = (priceEnd/priceBase-1)*100;
          var shortInvChange = (invEnd/invBase-1)*100;
          var signalText = '价格与仓单变化不一致，暂不形成明确方向';
          if (shortPriceChange>0.5 && shortInvChange<-1) signalText='价格上行、仓单下降：存在供需偏紧迹象';
          else if (shortPriceChange<-0.5 && shortInvChange>1) signalText='价格下行、仓单上升：存在库存压力迹象';
          else if (shortPriceChange>0.5 && shortInvChange>1) signalText='价格与仓单同步上升：需辨别补库与供给增加';
          else if (shortPriceChange<-0.5 && shortInvChange<-1) signalText='价格与仓单同步下降：需留意需求走弱或库存转移';
          marketSignalHtml = '<div class="mini-label mt-2">短期供需观察（近'+Math.min(points.length,inventoryPoints.length,5)+'个数据点）：'+esc(signalText)+'</div>';
        }
      }
      var links = data.industryLinks && typeof data.industryLinks === 'object' ? data.industryLinks : null;
      function companyTags(values) {
        return (Array.isArray(values) ? values : []).slice(0, 5).map(function(name){
          return '<span class="tag me-1 mb-1">'+esc(name)+'</span>';
        }).join('') || '<span class="mini-label">数据源未列示</span>';
      }
      var industryLinksHtml = links
        ? '<div class="mt-2 p-2 rounded border"><div class="mini-label mb-1">产业链企业（数据源列示，不代表持股或确定供销关系）</div>'
          + '<div class="mini-label">生产商</div><div class="mb-1">'+companyTags(links.producers)+'</div>'
          + '<div class="mini-label">下游用户</div><div>'+companyTags(links.downstreamUsers)+'</div>'
          + '<div class="mini-label mt-1"><a href="'+esc(links.sourceUrl || 'https://data.eastmoney.com/ifdata/xhgp.html')+'" target="_blank" rel="noopener noreferrer">企业名单来源</a></div></div>'
        : '<div class="mini-label mt-2">产业链企业名单：该品种暂未获取到可靠的自动数据</div>';
      return '<article class="insight-card">'
        + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="fw-bold">'+esc(data.name || meta.name)+'</div><div class="mini-label">'+esc(data.unit || meta.unit || '价格')+'</div></div><span class="flag" style="margin:0">'+status+'</span></div>'
        + '<div class="d-flex align-items-baseline justify-content-between mt-2 gap-2"><div class="business-price tabular">'+(last == null ? '—' : formatNumber(last))+'</div><div class="'+tone+' fw-semibold">'+trend+'</div></div>'
        + '<div class="mini-label">'+(latestDate ? '数据日期：'+esc(latestDate) : '当前没有有效报价')+' · '+(data.latestSpot != null && Number(data.latestSpot)>0 ? '现货价格' : '期货价格')+'</div>'
        + (data.latestFutures != null && Number(data.latestFutures)>0 ? '<div class="mini-label">期货参考价：'+formatNumber(data.latestFutures)+' '+esc(data.unit || meta.unit || '')+' · '+esc(data.futuresDate || latestDate || '')+(data.futuresTime ? ' '+esc(data.futuresTime) : '')+' · '+esc(data.futuresSource || '主力合约参考价')+'</div>' : '')
        + '<div class="mt-2">'+chart+'</div>'
        + monthlyPriceHtml
        + basisHtml
        + inventoryHtml
        + marketSignalHtml
        + industryLinksHtml
        + '<div class="mini-label mt-1">产业链：'+esc(data.chain || meta.chain)+'</div>'
        + '<div class="small mt-2">'+esc(data.drivers || meta.drivers)+'</div>'
        + '<div class="mt-2"><div class="mini-label mb-1">关联股票池</div>'+related+'</div>'
        + '<div class="mini-label mt-2">数据源：'+esc(source)+' '+sourceLink+'</div>'
        + '</article>';
    }).join('');
    var costContainer = el('business-cost-inputs');
    if (costContainer) {
      var costInputs = businessData && businessData.costInputs && typeof businessData.costInputs === 'object'
        ? Object.values(businessData.costInputs) : [];
      costContainer.innerHTML = costInputs.map(function(input) {
        var datedSeries = Array.isArray(input.series) ? input.series.filter(function(p) {
          return p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && (Number(p.spot)>0 || Number(p.futures)>0);
        }).slice(-60) : [];
        var monthlySeries = Array.isArray(input.monthlyPrices) ? input.monthlyPrices.filter(function(p) {
          return p && Number(p.value)>0;
        }).slice(-6) : [];
        var series = datedSeries.length ? datedSeries : monthlySeries;
        function pointValue(p) { return Number(p.spot || p.futures || p.value); }
        var latest = input.latest != null && Number(input.latest)>0 ? Number(input.latest) :
          (series.length ? pointValue(series[series.length-1]) : null);
        var first = series.length ? pointValue(series[0]) : null;
        var lastValue = series.length ? pointValue(series[series.length-1]) : null;
        var change = first>0 && lastValue>0 ? (lastValue/first-1)*100 : null;
        var tone = change == null ? 'text-body-secondary' : change>0 ? 'text-up' : change<0 ? 'text-down' : 'text-body-secondary';
        var trend = change == null ? '趋势数据不足' : ((change>0?'+':'')+change.toFixed(2)+'%');
        var chart = '<div class="empty-state py-2 small">暂未获取到可绘制的原料历史价格</div>';
        if (datedSeries.length>=2) {
          var chartId = 'business-cost-chart-' + input.id;
          businessChartSpecs.push({
            id: chartId,
            name: input.name,
            unit: input.unit || '元/吨',
            data: datedSeries.map(function(p){ return { time: p.date, value: pointValue(p) }; })
          });
          chart = '<div class="business-chart-wrap"><div class="business-chart-caption"><span>'+esc(input.name)+'价格走势</span><span>近'+datedSeries.length+'个数据点</span></div><div class="business-price-chart business-cost-chart" id="'+chartId+'" role="img" aria-label="'+esc(input.name)+'历史价格曲线"></div></div>';
        }
        var related=Array.isArray(input.relatedProducts)?input.relatedProducts:[];
        return '<article class="insight-card">'
          + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="fw-bold">'+esc(input.name)+'</div><div class="mini-label">'+esc(input.role || '原料价格参考')+'</div></div><span class="flag" style="margin:0">'+(latest!=null?'自动行情':'等待数据')+'</span></div>'
          + '<div class="d-flex align-items-baseline justify-content-between mt-2 gap-2"><div class="business-price tabular">'+(latest==null?'—':formatNumber(latest))+'</div><div class="'+tone+' fw-semibold">'+trend+'</div></div>'
          + '<div class="mini-label">'+(input.latestDate?'数据日期：'+esc(input.latestDate):'当前没有有效报价')+' · '+esc(input.unit || '元/吨')+'</div>'
          + '<div class="mt-2">'+chart+'</div>'
          + '<div class="mini-label mt-1">关联观察：'+(related.length?related.map(esc).join('、'):'—')+'</div>'
          + (monthlySeries.length ? '<div class="d-flex justify-content-between flex-wrap gap-1">'+monthlySeries.map(function(p){return '<span class="mini-label">'+esc(p.label || p.date || '')+' '+formatNumber(p.value)+'</span>';}).join('')+'</div>' : '')
          + '<div class="mini-label mt-1">来源：'+(input.source?esc(input.source):'尚未获取到可靠数据')+' · <a href="'+esc(input.sourceUrl || 'https://data.eastmoney.com/ifdata/xhgp.html')+'" target="_blank" rel="noopener noreferrer">查看来源</a></div>'
          + '</article>';
      }).join('') || '<div class="empty-state">成本原料数据尚未初始化，等待自动抓取任务。</div>';
    }
    renderBusinessCharts(businessChartSpecs);
    var statusEl = el('business-data-status');
    if (statusEl) {
      if (!businessData) statusEl.textContent = '自动行情文件暂不可用；请稍后重新读取。';
      else {
        var updated = businessData.updatedAt ? new Date(businessData.updatedAt).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false }) : '时间未知';
        var count = Object.keys(payloadItems).filter(function(k){return payloadItems[k] && Number(payloadItems[k].latest)>0;}).length;
        statusEl.textContent = '数据抓取：'+updated+'（北京时间） · '+count+'/'+items.length+' 个品种有有效报价；数据非逐笔实时。';
      }
    }
  }
  function renderBusinessCharts(specs) {
    if (!Array.isArray(specs) || !specs.length) return;
    if (!global.LightweightCharts || typeof global.LightweightCharts.createChart !== 'function') {
      specs.forEach(function(spec) {
        var node = el(spec.id);
        if (node) node.innerHTML = '<div class="empty-state py-2 small">图表组件暂不可用</div>';
      });
      return;
    }
    var textColor = getComputedStyle(document.documentElement).getPropertyValue('--bs-body-color').trim() || '#212529';
    var borderColor = getComputedStyle(document.documentElement).getPropertyValue('--bs-border-color').trim() || '#dee2e6';
    var primary = getComputedStyle(document.documentElement).getPropertyValue('--bs-primary').trim() || '#0d6efd';
    function withAlpha(color, alpha) {
      var value = String(color || '').trim();
      var hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (hex) {
        var digits = hex[1];
        if (digits.length === 3) digits = digits.split('').map(function(ch){ return ch + ch; }).join('');
        return 'rgba(' + parseInt(digits.slice(0,2),16) + ',' + parseInt(digits.slice(2,4),16) + ',' + parseInt(digits.slice(4,6),16) + ',' + alpha + ')';
      }
      var rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (rgb) return 'rgba(' + rgb[1] + ',' + rgb[2] + ',' + rgb[3] + ',' + alpha + ')';
      return value || 'rgba(13,110,253,' + alpha + ')';
    }
    specs.forEach(function(spec) {
      var node = el(spec.id);
      if (!node || node.dataset.chartReady === '1') return;
      var data = (spec.data || []).filter(function(p) {
        return p && /^\d{4}-\d{2}-\d{2}$/.test(p.time) && Number.isFinite(Number(p.value)) && Number(p.value) > 0;
      });
      if (data.length < 2) return;
      try {
        var chart = global.LightweightCharts.createChart(node, {
          autoSize: true,
          height: node.classList.contains('business-cost-chart') ? 112 : 148,
          layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: textColor,
            fontSize: 10,
            fontFamily: 'inherit'
          },
          grid: {
            vertLines: { color: borderColor },
            horzLines: { color: borderColor }
          },
          rightPriceScale: { borderColor: borderColor, scaleMargins: { top: 0.12, bottom: 0.08 } },
          timeScale: { borderColor: borderColor, rightOffset: 2, barSpacing: 7, timeVisible: false },
          crosshair: {
            mode: global.LightweightCharts.CrosshairMode.Normal,
            vertLine: { labelBackgroundColor: primary },
            horzLine: { labelBackgroundColor: primary }
          },
          localization: {
            priceFormatter: function(value) {
              return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
            }
          },
          handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
          handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true }
        });
        var area = chart.addAreaSeries({
          lineColor: primary,
          topColor: withAlpha(primary, 0.22),
          bottomColor: withAlpha(primary, 0.01),
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
        });
        area.setData(data);
        chart.timeScale().fitContent();
        node.dataset.chartReady = '1';
        businessCharts[spec.id] = chart;
      } catch (error) {
        node.innerHTML = '<div class="empty-state py-2 small">历史曲线暂时无法绘制</div>';
      }
    });
  }

  function fetchBusinessData() {
    if (businessFetchPromise) return businessFetchPromise;
    var statusEl = el('business-data-status');
    if (statusEl) statusEl.textContent = '正在读取自动抓取的商品数据…';
    businessFetchPromise = fetch('data/business-data.json?t='+Date.now(), { cache:'no-store' })
      .then(function(response){ if (!response.ok) throw new Error('HTTP '+response.status); return response.json(); })
      .then(function(payload){
        if (!payload || !payload.items || typeof payload.items !== 'object') throw new Error('数据格式不正确');
        businessData = payload;
        renderBusiness();
        return payload;
      })
      .catch(function(error){
        businessData = null;
        renderBusiness();
        if (statusEl) statusEl.textContent = '读取失败：'+String(error && error.message || error)+'。自动任务完成后再试。';
        return null;
      })
      .then(function(value){ businessFetchPromise = null; return value; });
    return businessFetchPromise;
  }
  function init(stocksArg, quoteArg, quoteClientArg) {
    stocks = Array.isArray(stocksArg) ? stocksArg : [];
    quotes = quoteArg || {};
    quoteClient = quoteClientArg || null;
    renderOpportunity();
  }
  // 只有进入行情页才拉取指数与商品数据，避免自选/作战页的无效请求。
  function onTab(target) {
    if (target !== 'market') return;
    renderOpportunity();
    fetchMarketIndices();
    fetchBusinessData();
  }
  global.StockBusiness={init:init,onTab:onTab,renderOpportunity:renderOpportunity,renderBusiness:renderBusiness};
})(window);

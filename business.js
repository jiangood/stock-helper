/* Opportunity radar and business-cycle watchlist for stock-helper. */
(function (global) {
  'use strict';
  var stocks = [];
  var quotes = {};
  var sectorMonthly = null;
  var sectorMonthlyStatus = 'idle';
  var businessData = null;
  var businessFetchPromise = null;
  var businessCharts = {};
  var chartsResizeBound = false;
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
  function fmtPct(v){return v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':((Number(v)>0?'+':'')+Number(v).toFixed(2)+'%');}
  function fmtMoney(v){return Number.isFinite(Number(v))?Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';}
  function monthlyLastPoints(points, valueKey) {
    var byMonth = {};
    (Array.isArray(points) ? points : []).forEach(function(p) {
      if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !(Number(p[valueKey]) > 0)) return;
      var month = p.date.slice(0, 7);
      if (!byMonth[month] || p.date > byMonth[month].date) byMonth[month] = { date: month, value: Number(p[valueKey]) };
    });
    return Object.keys(byMonth).sort().map(function(month) { return byMonth[month]; }).slice(-60);
  }
  function tone(v){return Number(v)>0?'text-up':Number(v)<0?'text-down':'text-body-secondary';}
  function stockForCode(code){var c=String(code||'').trim().toLowerCase();if(/^\d{6}$/.test(c))c=(/^[5689]/.test(c)?'sh':'sz')+c;return stocks.find(function(s){return String(s.code||'').toLowerCase()===c;})||null;}
  function renderSectors(){
    var node=el('sector-hotspots');if(!node)return;renderSectorNote();
    if(!sectorMonthly){node.innerHTML='<div class="empty-state">'+(sectorMonthlyStatus==='error'?'板块日线数据暂不可用，等待每日缓存任务生成。':'正在读取板块日线数据…')+'</div>';return;}
    var stats=sectorMonthly.stocks||{},groups={};
    stocks.forEach(function(s){
      var key=s.group||'未分类';if(!groups[key])groups[key]={name:key,count:0,covered:0,up:0,down:0,zone:0,periods:{d1:0,d5:0,d20:0,d60:0,d120:0,d200:0},counts:{d1:0,d5:0,d20:0,d60:0,d120:0,d200:0},leaders:[]};
      var g=groups[key];g.count++;var q=quotes[s.code];if(q&&Number(q.price)>0){var z=Croc.evaluate(s,q).zone;if(z==='heavy'||z==='entry')g.zone++;}
      var item=stats[s.code];if(!item)return;
      if(Number.isFinite(Number(item.d1))){g.covered++;if(Number(item.d1)>0)g.up++;else if(Number(item.d1)<0)g.down++;}
      ['d1','d5','d20','d60','d120','d200'].forEach(function(k){var v=Number(item[k]);if(Number.isFinite(v)){g.periods[k]+=v;g.counts[k]++;}});
      if(Number.isFinite(Number(item.d20)))g.leaders.push({name:s.name,code:s.code,change:Number(item.d20)});
    });
    var rows=Object.keys(groups).map(function(k){var g=groups[k];Object.keys(g.periods).forEach(function(p){g.periods[p]=g.counts[p]?g.periods[p]/g.counts[p]:null;});g.avg=g.periods.d20;g.leaders.sort(function(a,b){return b.change-a.change;});return g;}).sort(function(a,b){return (b.avg==null?-999:b.avg)-(a.avg==null?-999:a.avg);});
    node.innerHTML=rows.map(function(g){
      var leaders=g.leaders.slice(0,3).map(function(s){return '<a class="text-body text-decoration-none me-2" href="stock.html?code='+encodeURIComponent(s.code)+'">'+esc(s.name)+' <span class="'+tone(s.change)+'">'+fmtPct(s.change)+'</span></a>';}).join('')||'<span class="mini-label">暂无有效日线涨跌幅</span>';
      var period=['d1|近1日','d5|近5日','d20|近20日','d60|近60日','d120|近120日','d200|近200日'].map(function(pair){var p=pair.split('|');return '<span>'+p[1]+' <b class="'+tone(g.periods[p[0]])+'">'+fmtPct(g.periods[p[0]])+'</b></span>';}).join('');
      return '<article class="insight-card"><div class="d-flex justify-content-between align-items-start gap-2"><div class="fw-bold">'+esc(g.name)+'</div><span class="flag" style="margin:0">'+g.covered+'/'+g.count+' 有日线</span></div><div class="d-flex flex-wrap align-items-baseline gap-2 mt-2"><span class="business-price '+tone(g.avg)+'">'+fmtPct(g.avg)+'</span><span class="mini-label">近20个交易日等权平均</span><span class="mini-label">涨 '+g.up+' · 跌 '+g.down+' · 到计划区 '+g.zone+'</span></div><div class="d-flex flex-wrap gap-2 mt-2 mini-label">'+period+'</div><div class="mini-label mt-2 mb-1">日线领先 · 近20个交易日</div><div>'+leaders+'</div></article>';
    }).join('')||'<div class="empty-state">暂无分组数据。</div>';
  }
  function renderSectorNote(){
    var note=el('sector-monthly-note');if(!note)return;
    var base='按复权日 K 收盘价计算板块内等权平均涨跌幅；周期按交易日计，最多使用最近 200 根日线。';
    var stats=sectorMonthly&&sectorMonthly.stocks?sectorMonthly.stocks:{};
    var covered=stocks.filter(function(s){var item=stats[s.code];return item&&Number.isFinite(Number(item.d20));}).length;
    note.textContent=(!sectorMonthly||!stocks.length)?base:'数据日期：'+(sectorMonthly.marketDate||'未知')+' · '+covered+'/'+stocks.length+' 只有效日线涨跌幅 · '+base;
  }
  /** 只读取 Actions 预生成的小文件，不逐只拉个股缓存。 */
  function loadSectorMonthly(force){
    if(sectorMonthly&&!force){renderSectors();return;}
    sectorMonthly=null;sectorMonthlyStatus='loading';renderSectors();
    fetch('data/sector-monthly.json?t='+Date.now(),{cache:'no-store'})
      .then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
      .then(function(payload){
        if(!payload||!payload.stocks||typeof payload.stocks!=='object')throw new Error('数据格式不正确');
        sectorMonthly=payload;sectorMonthlyStatus='ready';
      })
      .catch(function(){sectorMonthly=null;sectorMonthlyStatus='error';})
      .then(function(){renderSectors();});
  }
  function renderBrief(){
    renderSectors();
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
  function formatNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
  }
  function renderBusiness() {
    var container = el('business-cards');
    if (!container) return;
    Object.keys(businessCharts).forEach(function(key) {
      try {
        if (businessCharts[key] && typeof businessCharts[key].dispose === 'function') businessCharts[key].dispose();
      } catch (error) { /* ignore detached charts */ }
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
      var dailyPoints = series.filter(function(p){ return Number(p[metricKey])>0; });
      var suppliedMonthly = data.monthlyPrices && Array.isArray(data.monthlyPrices.series)
        ? data.monthlyPrices.series.filter(function(p){ return p && Number(p.value)>0 && (p.date || p.label); }).map(function(p){
            return { date: String(p.date || p.label).slice(0, 7), value: Number(p.value) };
          }).filter(function(p){ return /^\d{4}-\d{2}$/.test(p.date); })
        : [];
      var monthlyKlines = data.monthlyKlines && Array.isArray(data.monthlyKlines.series)
        ? data.monthlyKlines.series.filter(function(p){
            return p && /^\d{4}-\d{2}$/.test(p.date)
              && Number(p.open)>0 && Number(p.high)>0 && Number(p.low)>0 && Number(p.close)>0;
          }).slice(-180)
        : [];
      var points = dailyPoints.slice(-200).map(function(p){ return { date:p.date, value:Number(p[metricKey]) }; });
      var last = data.latest != null && Number(data.latest)>0 ? Number(data.latest) : (points.length ? Number(points[points.length-1].value != null ? points[points.length-1].value : points[points.length-1][metricKey]) : null);
      var latestDate = data.latestDate || (points.length ? points[points.length-1].date : null);
      var quoteRangeHtml = '';
      var rangePoint = series.length ? series[series.length-1] : null;
      if (rangePoint && Number(rangePoint.low)>0 && Number(rangePoint.high)>=Number(rangePoint.low)) {
        var regionalRanges = rangePoint.markets && typeof rangePoint.markets === 'object'
          ? Object.keys(rangePoint.markets).map(function(region) {
              var quote = rangePoint.markets[region] || {};
              return Number(quote.low)>0 && Number(quote.high)>=Number(quote.low)
                ? esc(region)+' '+formatNumber(quote.low)+'–'+formatNumber(quote.high) : '';
            }).filter(Boolean).join('；')
          : '';
        var rangeUnit = data.unit || meta.unit || '元/吨';
        quoteRangeHtml = '<div class="mini-label">报价区间（'+esc(rangePoint.spec || '来源规格')+'）：'
          + (regionalRanges || (esc(rangePoint.region || '山东')+' '+formatNumber(rangePoint.low)+'–'+formatNumber(rangePoint.high)))
          + ' '+esc(rangeUnit)+' · 含税、现款、送到</div>'
          + '<div class="mini-label">走势图采用山东报价区间中点，不代表单笔成交价或全国均价</div>';
      }
      var delta = null;
      if (points.length > 1 && Number(points[0].value != null ? points[0].value : points[0][metricKey]) > 0) {
        delta = (Number(points[points.length-1].value != null ? points[points.length-1].value : points[points.length-1][metricKey]) / Number(points[0].value != null ? points[0].value : points[0][metricKey]) - 1) * 100;
      } else if (Number.isFinite(Number(data.changePct))) {
        delta = Number(data.changePct);
      }
      var trend = delta == null ? '趋势数据不足' : ((delta > 0 ? '+' : '') + delta.toFixed(2) + '%');
      var tone = delta == null ? 'text-body-secondary' : delta > 0 ? 'text-up' : delta < 0 ? 'text-down' : 'text-body-secondary';
      var chart = '<div class="empty-state py-2 small">' + (last ? '该来源暂未提供可绘制的历史序列' : '等待自动数据源返回有效报价') + '</div>';
      if (monthlyKlines.length >= 2) {
        var chartId = 'business-price-chart-' + meta.id;
        businessChartSpecs.push({
          id: chartId, type: 'candlestick', name: meta.name,
          unit: data.unit || meta.unit || '',
          data: monthlyKlines.map(function(p){ return { time: p.date, value: [Number(p.open), Number(p.close), Number(p.low), Number(p.high)] }; })
        });
        chart = '<div class="business-chart-wrap"><div class="business-chart-caption"><span>'+esc(meta.name)+'月K线</span><span>近'+monthlyKlines.length+'个月 · 主力连续合约</span></div><div class="business-price-chart" id="'+chartId+'" role="img" aria-label="'+esc(meta.name)+'历史月K线"></div></div>';
      } else if (points.length >= 2) {
        var chartId = 'business-price-chart-' + meta.id;
        businessChartSpecs.push({
          id: chartId, type: 'line', name: meta.name,
          unit: data.unit || meta.unit || '',
          data: points.map(function(p){ return { time: p.date, value: Number(p.value != null ? p.value : p[metricKey]) }; })
        });
        chart = '<div class="business-chart-wrap"><div class="business-chart-caption"><span>'+esc(meta.name)+'价格走势</span><span>近'+points.length+'根日线</span></div><div class="business-price-chart" id="'+chartId+'" role="img" aria-label="'+esc(meta.name)+'历史价格曲线"></div></div>';
      }
      var related = (data.stocks || meta.stocks || []).map(function(name){
        var stock = stocks.find(function(s){ return s.name === name; });
        return stock ? '<a class="text-body text-decoration-none me-1 mb-1" href="stock.html?code='+encodeURIComponent(stock.code)+'">'+esc(name)+'</a>' : '<span class="tag me-1">'+esc(name)+'</span>';
      }).join('');
      var source = data.source || '暂未匹配到可靠的自动报价源';
      var sourceLink = data.sourceUrl ? '<a href="'+esc(data.sourceUrl)+'" target="_blank" rel="noopener noreferrer">查看来源</a>' : '';
      var status = data.status === 'ok' ? '现货 / 期货历史' : data.status === 'latest-only' ? '自动最新报价' : '等待可靠数据源';
      var monthlyPrices = []; // 行情页统一使用日线图。
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
      if (dailyPoints.length >= 4 && inventoryPoints.length >= 4) {
        var priceBase = Number(dailyPoints[Math.max(0, dailyPoints.length-5)][metricKey]);
        var priceEnd = Number(dailyPoints[dailyPoints.length-1][metricKey]);
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
          marketSignalHtml = '<div class="mini-label mt-2">短期供需观察（近'+Math.min(dailyPoints.length,inventoryPoints.length,5)+'个数据点）：'+esc(signalText)+'</div>';
        }
      }
      return '<article class="insight-card">'
        + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="fw-bold">'+esc(data.name || meta.name)+'</div><div class="mini-label">'+esc(data.unit || meta.unit || '价格')+'</div></div><span class="flag" style="margin:0">'+status+'</span></div>'
        + '<div class="d-flex align-items-baseline justify-content-between mt-2 gap-2"><div class="business-price tabular">'+(last == null ? '—' : formatNumber(last))+'</div><div class="'+tone+' fw-semibold">'+trend+'</div></div>'
        + '<div class="mini-label">'+(latestDate ? '数据日期：'+esc(latestDate) : '当前没有有效报价')+' · '+(data.latestSpot != null && Number(data.latestSpot)>0 ? '现货价格' : '期货价格')+'</div>'
        + quoteRangeHtml
        + (data.latestFutures != null && Number(data.latestFutures)>0 ? '<div class="mini-label">期货参考价：'+formatNumber(data.latestFutures)+' '+esc(data.unit || meta.unit || '')+' · '+esc(data.futuresDate || latestDate || '')+(data.futuresTime ? ' '+esc(data.futuresTime) : '')+' · '+esc(data.futuresSource || '主力合约参考价')+'</div>' : '')
        + '<div class="mt-2">'+chart+'</div>'
        + monthlyPriceHtml
        + basisHtml
        + inventoryHtml
        + marketSignalHtml
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
        }) : [];
        var suppliedMonthlySeries = Array.isArray(input.monthlyPrices) ? input.monthlyPrices.filter(function(p) {
          return p && Number(p.value)>0 && (p.date || p.label);
        }).map(function(p){ return { date: String(p.date || p.label).slice(0,7), value:Number(p.value), label:p.label || p.date }; }) : [];
        var monthlySeries = suppliedMonthlySeries.length >= 2 ? suppliedMonthlySeries.slice(-6)
          : monthlyLastPoints(datedSeries, datedSeries.some(function(p){return Number(p.spot)>0;}) ? 'spot' : 'futures');
        var series = monthlySeries.length ? monthlySeries : datedSeries.slice(-6);
        function pointValue(p) { return Number(p.spot || p.futures || p.value); }
        var latest = input.latest != null && Number(input.latest)>0 ? Number(input.latest) :
          (series.length ? pointValue(series[series.length-1]) : null);
        var first = series.length ? pointValue(series[0]) : null;
        var lastValue = series.length ? pointValue(series[series.length-1]) : null;
        var change = first>0 && lastValue>0 ? (lastValue/first-1)*100 : null;
        var tone = change == null ? 'text-body-secondary' : change>0 ? 'text-up' : change<0 ? 'text-down' : 'text-body-secondary';
        var trend = change == null ? '趋势数据不足' : ((change>0?'+':'')+change.toFixed(2)+'%');
        var chart = '<div class="empty-state py-2 small">暂未获取到可绘制的原料历史价格</div>';
        if (monthlySeries.length>=2) {
          var chartId = 'business-cost-chart-' + input.id;
          businessChartSpecs.push({
            id: chartId,
            name: input.name,
            unit: input.unit || '元/吨',
            data: monthlySeries.map(function(p){ return { time: String(p.date || p.label).slice(0,7), value: pointValue(p) }; })
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
    var lib = global.echarts;
    if (!lib || typeof lib.init !== 'function') {
      specs.forEach(function(spec) {
        var node = el(spec.id);
        if (node) node.innerHTML = '<div class="empty-state py-2 small">图表组件暂不可用</div>';
      });
      return;
    }
    var rootStyle = getComputedStyle(document.documentElement);
    var textColor = (rootStyle.getPropertyValue('--bs-body-color') || '').trim() || '#212529';
    var borderColor = (rootStyle.getPropertyValue('--bs-border-color') || '').trim() || '#dee2e6';
    var primary = (rootStyle.getPropertyValue('--bs-primary') || '').trim() || '#0d6efd';
    var surface = (rootStyle.getPropertyValue('--bs-body-bg') || '').trim() || '#ffffff';
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
    if (!chartsResizeBound) {
      chartsResizeBound = true;
      global.addEventListener('resize', function () {
        Object.keys(businessCharts).forEach(function (key) {
          try { businessCharts[key].resize(); } catch (error) { /* ignore */ }
        });
      });
    }
    specs.forEach(function(spec) {
      var node = el(spec.id);
      if (!node || node.dataset.chartReady === '1') return;
      var data = (spec.data || []).filter(function(p) {
        if (!p) return false;
        if (spec.type === 'candlestick') {
          return /^\d{4}-\d{2}$/.test(p.time) && Array.isArray(p.value)
            && p.value.length === 4 && p.value.every(function(v){ return Number.isFinite(Number(v)) && Number(v)>0; });
        }
        return /^\d{4}-\d{2}-\d{2}$/.test(p.time) && Number.isFinite(Number(p.value)) && Number(p.value) > 0;
      });
      if (data.length < 2) return;
      try {
        var chart = lib.init(node, null, { renderer: 'canvas' });
        var unit = spec.unit ? ' ' + spec.unit : '';
        chart.setOption({
          animation: false,
          backgroundColor: 'transparent',
          textStyle: { color: textColor, fontSize: 10, fontFamily: 'inherit' },
          grid: { left: 22, right: 48, top: 10, bottom: 20 },
          tooltip: {
            trigger: 'axis',
            backgroundColor: surface,
            borderColor: borderColor,
            borderWidth: 1,
            padding: [5, 7],
            textStyle: { color: textColor, fontSize: 10 },
            formatter: function (params) {
              var hit = Array.isArray(params) ? params[0] : params;
              if (!hit) return '';
              if (spec.type === 'candlestick') {
                var candle = Array.isArray(hit.data) ? hit.data : (hit.data && hit.data.value);
                if (!Array.isArray(candle) || candle.length < 4) return '';
                return esc(hit.axisValue) + '<br>' + esc(spec.name || '')
                  + '<br>开：' + Number(candle[0]).toLocaleString('zh-CN')
                  + ' 收：' + Number(candle[1]).toLocaleString('zh-CN')
                  + '<br>低：' + Number(candle[2]).toLocaleString('zh-CN')
                  + ' 高：' + Number(candle[3]).toLocaleString('zh-CN') + esc(unit);
              }
              var value = Number(hit.data);
              return esc(hit.axisValue) + '<br>' + esc(spec.name || '') + ' '
                + (Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—')
                + esc(unit);
            }
          },
          xAxis: {
            type: 'category',
            data: data.map(function (p) { return p.time; }),
            boundaryGap: false,
            axisLine: { lineStyle: { color: borderColor } },
            axisTick: { show: false },
            axisLabel: {
              color: textColor, fontSize: 9, hideOverlap: true,
              formatter: function (value) { return /^\\d{4}-\\d{2}$/.test(String(value)) ? String(value) : String(value).slice(5); }
            },
            splitLine: { show: false }
          },
          yAxis: {
            type: 'value',
            scale: true,
            position: 'right',
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { lineStyle: { color: borderColor, opacity: 0.5 } },
            axisLabel: {
              color: textColor, fontSize: 9,
              formatter: function (value) { return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
            }
          },
          series: [{
            type: spec.type === 'candlestick' ? 'candlestick' : 'line',
            data: spec.type === 'candlestick'
              ? data.map(function(p){ return p.value.map(Number); })
              : data.map(function (p) { return Number(p.value); }),
            showSymbol: false,
            symbolSize: 5,
            itemStyle: spec.type === 'candlestick'
              ? { color: '#ef232a', color0: '#14b143', borderColor: '#ef232a', borderColor0: '#14b143' }
              : { color: primary },
            lineStyle: { color: primary, width: 2 },
            areaStyle: spec.type === 'candlestick' ? undefined : {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: withAlpha(primary, 0.22) },
                  { offset: 1, color: withAlpha(primary, 0.01) }
                ]
              }
            }
          }]
        }, true);
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
    renderBrief();
  }
  // 只有进入行情页才拉取板块日线与商品数据，避免自选/作战页的无效请求。
  function onTab(target) {
    if (target !== 'market') return;
    renderBrief();
    loadSectorMonthly();
    fetchBusinessData();
  }
  /** 主题切换后按新配色重建商品走势图（配色取自 CSS 变量，不重建会保留旧主题颜色）。 */
  function refreshCharts() {
    if (!businessData) return;
    var container = el('business-cards');
    if (!container) return;
    renderBusiness();
    renderBrief();
  }
  /** 手动刷新时重新读取板块月线汇总（每天由 Actions 更新）。 */
  function reloadSectors() {
    loadSectorMonthly(true);
  }
  global.StockBusiness={init:init,onTab:onTab,renderBrief:renderBrief,renderBusiness:renderBusiness,reloadSectors:reloadSectors,refreshCharts:refreshCharts};
})(window);

(function(){
'use strict';
var cards=[], companyProducts=[], charts=[];
function $(id){return document.getElementById(id);}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pct(value){return value==null||!Number.isFinite(Number(value))?'—':(Number(value)>0?'+':'')+Number(value).toFixed(2)+'%';}
function share(value){return value==null||!Number.isFinite(Number(value))?'—':(Number(value)*100).toFixed(1)+'%';}
function money(value){return value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
function tone(value){return Number(value)>0?'product-positive':Number(value)<0?'product-negative':'';}
function destroyCharts(){charts.forEach(function(chart){try{chart.dispose();}catch(e){}});charts=[];}
function searchText(){return ($('product-search').value||'').trim().toLowerCase();}
function visibleCards(){
 var query=searchText(),filter=$('product-filter').value;
 return cards.filter(function(card){
  var text=[card.name,card.code,card.productName,card.group].join(' ').toLowerCase();
  if(query&&!text.includes(query))return false;
  if(filter==='ready'&&card.status!=='ready')return false;
  if(filter==='pending'&&card.status==='ready')return false;
  if(filter==='divergence'&&card.divergence!=='方向背离')return false;
  return true;
 });
}
function visibleProducts(){
 var query=searchText(),filter=$('db-filter').value;
 return companyProducts.filter(function(p){
  var text=[p.stockName,p.stockCode,p.productName,p.group].join(' ').toLowerCase();
  if(query&&!text.includes(query))return false;
  if(filter==='available'&&(!Array.isArray(p.priceSeries)||!p.priceSeries.length))return false;
  if(filter==='unavailable'&&Array.isArray(p.priceSeries)&&p.priceSeries.length)return false;
  return true;
 });
}
function sparkline(series){
 if(!Array.isArray(series)||series.length<2)return '<span class="db-meta">暂无足够月度数据</span>';
 var values=series.map(function(p){return Number(p.price);}).filter(function(v){return Number.isFinite(v)&&v>0;});
 if(values.length<2)return '<span class="db-meta">暂无足够月度数据</span>';
 var min=Math.min.apply(null,values),max=Math.max.apply(null,values),range=max-min||1;
 var points=series.map(function(p,i){
  var v=Number(p.price);if(!Number.isFinite(v)||v<=0)return null;
  var x=4+i*182/Math.max(1,series.length-1),y=36-(v-min)/range*30;
  return x.toFixed(1)+','+y.toFixed(1);
 }).filter(Boolean).join(' ');
 return '<svg class="db-chart" viewBox="0 0 190 42" role="img" aria-label="近五年月度价格趋势"><polyline fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" points="'+points+'"/></svg><span class="db-meta">'+esc(series[0].month)+' — '+esc(series[series.length-1].month)+' · '+series.length+' 个月</span>';
}
function monthDetails(series){
 if(!Array.isArray(series)||!series.length)return '';
 return '<details class="mt-1"><summary class="db-meta">展开月度价格（'+series.length+' 个月）</summary><div class="db-months">'+series.slice().reverse().map(function(p){
  return '<div class="db-month"><span>'+esc(p.month)+'</span><strong>'+money(p.price)+'</strong></div>';
 }).join('')+'</div></details>';
}
function renderCompanyProducts(){
 var rows=visibleProducts(),body=$('db-rows');
 $('db-count').textContent='显示 '+rows.length+' / '+companyProducts.length+' 项产品';
 if(!rows.length){body.innerHTML='<tr><td colspan="7" class="db-empty">没有符合条件的产品</td></tr>';return;}
 body.innerHTML=rows.map(function(p){
  var series=Array.isArray(p.priceSeries)?p.priceSeries:[],last=series.length?series[series.length-1]:null;
  var status=series.length?'<span class="db-status ok">有历史价格</span>':'<span class="db-status pending">价格待补充</span>';
  var price=last?money(last.price)+' '+esc(p.priceUnit||'')+'<div class="db-meta">'+esc(last.month)+'</div>':'—';
  return '<tr><td><div class="db-stock"><a class="text-body text-decoration-none" href="stock.html?code='+encodeURIComponent(p.stockCode)+'">'+esc(p.stockName)+'</a></div><div class="db-code">'+esc(p.stockCode)+' · '+esc(p.group)+'</div></td><td><div class="db-product">'+esc(p.productName)+'</div><div class="db-meta">'+esc(p.ratioBasis==='product'?'产品分类':p.ratioBasis==='industry'?'行业分类':p.ratioBasis==='manual-mapping'?'人工映射':'—')+' · '+esc(p.ratioUnit||'')+'</div></td><td class="db-ratio">'+share(p.revenueRatio)+'</td><td>'+esc(p.reportDate||'—')+'</td><td class="db-price">'+price+'</td><td>'+sparkline(series)+monthDetails(series)+(p.priceNote?'<div class="db-meta">'+esc(p.priceNote)+'</div>':'')+'</td><td>'+status+(p.priceKind?'<div class="db-meta">'+esc(p.priceKind)+'</div>':'')+'</td></tr>';
 }).join('');
}
function render(){
 destroyCharts();
 var list=visibleCards(),node=$('product-cards');
 $('product-count').textContent='显示 '+list.length+' / '+cards.length+' 只';
 if(!list.length)node.innerHTML='<div class="product-empty">没有符合条件的股票</div>';
 else node.innerHTML=list.map(function(card){
  var status=card.status==='ready'?card.divergence:card.status==='mapping-pending'?'主营映射待核实':'商品历史数据不足';
  var badge=card.status==='ready'?(card.divergence==='方向背离'?'diverge':card.divergence==='走势大致同步'?'sync':''):'';
  var chart=card.status==='ready'?'<div class="product-chart" id="product-chart-'+esc(card.code)+'" role="img" aria-label="'+esc(card.name)+'主营产品价格与股价标准化月线对比"></div>':'<div class="product-empty">'+(card.status==='mapping-pending'?'尚未核实该公司的代表性主营产品。':'已记录产品：'+esc(card.productName)+'；暂无足够的同口径历史商品月线，暂不绘图。')+'</div>';
  return '<article class="product-card"><div class="product-card-head"><div><div class="product-card-name"><a class="text-body text-decoration-none" href="stock.html?code='+encodeURIComponent(card.code)+'">'+esc(card.name)+'</a> <span class="product-meta">'+esc(card.code)+' · '+esc(card.group)+'</span></div><div class="product-meta mt-1">主营观察：'+esc(card.productName)+' · '+esc(card.roleLabel)+(card.productUnit?' · '+esc(card.productUnit):'')+(card.mainRatio!==null&&card.mainRatio!==undefined?' · 主营占比参考 '+(Number(card.mainRatio)*100).toFixed(1)+'%':'')+'</div></div><span class="product-status '+badge+'">'+esc(status)+'</span></div><div class="product-metrics"><div><div class="product-metric-label">商品价格区间涨跌</div><div class="product-metric-value '+tone(card.productChange)+'">'+pct(card.productChange)+'</div></div><div><div class="product-metric-label">股票同期涨跌</div><div class="product-metric-value '+tone(card.stockChange)+'">'+pct(card.stockChange)+'</div></div><div><div class="product-metric-label">商品 / 股价数据日期</div><div class="product-meta">'+esc(card.productDate||'—')+' / '+esc(card.stockDate||'—')+'</div></div></div>'+chart+'<div class="product-note">'+esc(card.note||'')+' '+(card.stockSeriesSource?'股价序列：'+esc(card.stockSeriesSource)+'。':'')+(card.productSource?'商品来源：'+esc(card.productSource)+'。':'')+'</div></article>';
 }).join('');
 list.forEach(function(card){
  if(card.status!=='ready')return;
  var chartNode=$('product-chart-'+card.code);if(!chartNode)return;
  if(!window.echarts){chartNode.textContent='图表组件暂不可用';return;}
  var chart=window.echarts.init(chartNode);charts.push(chart);
  chart.setOption({
   animation:false,grid:{left:42,right:14,top:28,bottom:28},
   legend:{top:0,textStyle:{fontSize:10,color:'inherit'}},
   tooltip:{trigger:'axis',valueFormatter:function(v){return Number(v).toFixed(2);}},
   xAxis:{type:'category',data:card.series.map(function(p){return p.month;}),axisLabel:{fontSize:9,hideOverlap:true},boundaryGap:false},
   yAxis:{type:'value',scale:true,axisLabel:{fontSize:9,formatter:'{value}'},splitLine:{lineStyle:{type:'dashed',opacity:.35}}},
   series:[
    {name:'商品价格指数',type:'line',smooth:false,showSymbol:false,lineStyle:{width:2},data:card.series.map(function(p){return p.productIndex;})},
    {name:'股票价格指数',type:'line',smooth:false,showSymbol:false,lineStyle:{width:2},data:card.series.map(function(p){return p.stockIndex;})}
   ]
  });
 });
 renderCompanyProducts();
}
function loadComparison(){
 fetch('data/product-comparison.json?t='+Date.now(),{cache:'no-store'})
 .then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
 .then(function(payload){
  if(!payload||!Array.isArray(payload.cards))throw new Error('商品比较数据格式不正确');
  cards=payload.cards;
  $('product-updated').textContent='生成时间：'+(payload.generatedAt?new Date(payload.generatedAt).toLocaleString('zh-CN',{hour12:false}):'未知')+' · 可比 '+payload.comparableCount+'/'+payload.stockCount+' 只';
  render();
 }).catch(function(error){
  $('product-updated').textContent='商品对比数据读取失败';
  $('product-cards').innerHTML='<div class="product-empty">商品比较数据暂不可用：'+esc(error.message)+'。请稍后刷新。</div>';
 });
}
function loadCompanyProducts(){
 fetch('data/company-products.json?t='+Date.now(),{cache:'no-store'})
 .then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
 .then(function(payload){
  if(!payload||!Array.isArray(payload.products))throw new Error('主营产品数据格式不正确');
  companyProducts=payload.products;
  $('db-updated').textContent='数据更新：'+(payload.updatedAt?new Date(payload.updatedAt).toLocaleString('zh-CN',{hour12:false}):'未知')+' · '+companyProducts.length+' 项产品';
  renderCompanyProducts();
 }).catch(function(error){
  $('db-updated').textContent='主营产品数据读取失败';
  $('db-rows').innerHTML='<tr><td colspan="7" class="db-empty">主营产品数据暂不可用：'+esc(error.message)+'</td></tr>';
 });
}
$('product-search').addEventListener('input',function(){render();});
$('product-filter').addEventListener('change',render);
$('db-filter').addEventListener('change',renderCompanyProducts);
window.addEventListener('resize',function(){charts.forEach(function(chart){try{chart.resize();}catch(e){}});});
loadComparison();
loadCompanyProducts();
})();
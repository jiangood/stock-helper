(function(){
'use strict';
var cards=[], charts=[];
function $(id){return document.getElementById(id);}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pct(value){return value==null||!Number.isFinite(Number(value))?'—':(Number(value)>0?'+':'')+Number(value).toFixed(2)+'%';}
function tone(value){return Number(value)>0?'product-positive':Number(value)<0?'product-negative':'';}
function destroyCharts(){charts.forEach(function(chart){try{chart.dispose();}catch(e){}});charts=[];}
function visibleCards(){
 var query=($('product-search').value||'').trim().toLowerCase(), filter=$('product-filter').value;
 return cards.filter(function(card){
  var text=[card.name,card.code,card.productName,card.group].join(' ').toLowerCase();
  if(query&&!text.includes(query))return false;
  if(filter==='ready'&&card.status!=='ready')return false;
  if(filter==='pending'&&card.status==='ready')return false;
  if(filter==='divergence'&&card.divergence!=='方向背离')return false;
  return true;
 });
}
function render(){
 destroyCharts();
 var list=visibleCards(),node=$('product-cards');
 $('product-count').textContent='显示 '+list.length+' / '+cards.length+' 只';
 if(!list.length){node.innerHTML='<div class="product-empty">没有符合条件的股票</div>';return;}
 node.innerHTML=list.map(function(card){
  var status=card.status==='ready'?card.divergence:card.status==='mapping-pending'?'主营映射待核实':'商品历史数据不足';
  var badge=card.status==='ready'?(card.divergence==='方向背离'?'diverge':card.divergence==='走势大致同步'?'sync':''):'';
  var chart=card.status==='ready'?'<div class="product-chart" id="product-chart-'+esc(card.code)+'" role="img" aria-label="'+esc(card.name)+'主营产品价格与股价标准化月线对比"></div>':'<div class="product-empty">'+(card.status==='mapping-pending'?'尚未核实该公司的代表性主营产品。':'已记录产品：'+esc(card.productName)+'；暂无足够的同口径历史商品月线，暂不绘图。')+'</div>';
  return '<article class="product-card"><div class="product-card-head"><div><div class="product-card-name"><a class="text-body text-decoration-none" href="stock.html?code='+encodeURIComponent(card.code)+'">'+esc(card.name)+'</a> <span class="product-meta">'+esc(card.code)+' · '+esc(card.group)+'</span></div><div class="product-meta mt-1">主营观察：'+esc(card.productName)+' · '+esc(card.roleLabel)+(card.productUnit?' · '+esc(card.productUnit):'')+(card.mainRatio!==null&&card.mainRatio!==undefined?' · 主营占比参考 '+(Number(card.mainRatio)*100).toFixed(1)+'%':'')+'</div></div><span class="product-status '+badge+'">'+esc(status)+'</span></div><div class="product-metrics"><div><div class="product-metric-label">商品价格区间涨跌</div><div class="product-metric-value '+tone(card.productChange)+'">'+pct(card.productChange)+'</div></div><div><div class="product-metric-label">股票同期涨跌</div><div class="product-metric-value '+tone(card.stockChange)+'">'+pct(card.stockChange)+'</div></div><div><div class="product-metric-label">商品 / 股价数据日期</div><div class="product-meta">'+esc(card.productDate||'—')+' / '+esc(card.stockDate||'—')+'</div></div></div>'+chart+'<div class="product-note">'+esc(card.note||'')+' '+(card.stockSeriesSource?'股价序列：'+esc(card.stockSeriesSource)+'。':'')+(card.productSource?'商品来源：'+esc(card.productSource)+'。':'')+'</div></article>';
 }).join('');
 list.forEach(function(card){
  if(card.status!=='ready')return;
  var node=$('product-chart-'+card.code);if(!node||!window.echarts)return;
  var chart=window.echarts.init(node);charts.push(chart);
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
}
function load(){
 fetch('data/product-comparison.json?t='+Date.now(),{cache:'no-store'})
 .then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
 .then(function(payload){
  if(!payload||!Array.isArray(payload.cards))throw new Error('商品比较数据格式不正确');
  cards=payload.cards;
  $('product-updated').textContent='生成时间：'+(payload.generatedAt?new Date(payload.generatedAt).toLocaleString('zh-CN',{hour12:false}):'未知')+' · 可比 '+payload.comparableCount+'/'+payload.stockCount+' 只';
  render();
 }).catch(function(error){
  $('product-updated').textContent='数据读取失败';
  $('product-cards').innerHTML='<div class="product-empty">商品比较数据暂不可用：'+esc(error.message)+'。请稍后刷新。</div>';
 });
}
$('product-search').addEventListener('input',render);
$('product-filter').addEventListener('change',render);
window.addEventListener('resize',function(){charts.forEach(function(chart){try{chart.resize();}catch(e){}});});
load();
})();

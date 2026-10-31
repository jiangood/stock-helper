(function(){
'use strict';
var cards=[],charts=[],chartObservers=[];
function $(id){return document.getElementById(id);}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pct(value){return value==null||!Number.isFinite(Number(value))?'—':(Number(value)>0?'+':'')+Number(value).toFixed(2)+'%';}
function money(value){return value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
function normalizedPosition(value,min,max){var n=Number(value);if(!Number.isFinite(n))return null;if(!(max>min))return 0;return Math.max(0,Math.min(1,(n-min)/(max-min)));}
function productSummaryHtml(series,unit){
 var points=(Array.isArray(series)?series:[]).filter(function(point){return point&&point.price!=null&&Number.isFinite(Number(point.price));});
 if(!points.length)return '';
 var prices=points.map(function(point){return Number(point.price);});
 var high=Math.max.apply(null,prices),low=Math.min.apply(null,prices);
 return '<div class="product-summary" aria-label="商品价格统计"><span>最高 '+money(high)+'</span><span>最低 '+money(low)+'</span><span>期初 '+money(prices[0])+'</span><span>当前 '+money(prices[prices.length-1])+'</span><span>'+esc(unit||'')+'</span></div>';
}
function tone(value){return Number(value)>0?'product-positive':Number(value)<0?'product-negative':'';}
function displayProductName(value){return String(value==null?'':value).replace(/[（(][^）)]*[）)]/g,'').trim();}
function destroyCharts(){chartObservers.forEach(function(observer){try{observer.disconnect();}catch(e){}});chartObservers=[];charts.forEach(function(chart){try{chart.dispose();}catch(e){}});charts=[];}
function render(){
 destroyCharts();
 var list=cards,node=$('product-cards');
 if(!list.length){node.innerHTML='<div class="product-empty">没有符合条件的商品</div>';return;}
 node.innerHTML=list.map(function(card,index){
  var stockRows=(card.stocks||[]).map(function(stock){
   var hasHistory=Array.isArray(stock.values)&&stock.values.length>=2;
   return '<div class="commodity-stock"><div><a class="commodity-stock-name text-body text-decoration-none" href="stock.html?code='+encodeURIComponent(stock.code)+'">'+esc(stock.name)+'</a><span class="product-meta ms-2">'+esc(stock.roleLabel||'关联观察')+(stock.mainRatio!=null?' · 主营占比 '+(Number(stock.mainRatio)*100).toFixed(1)+'%':'')+'</span></div><div class="commodity-stock-meta">'+(stock.latestClose!=null?'最新复权月收 '+money(stock.latestClose)+' 元':'暂无月线')+' · '+esc(stock.latestDate||'—')+' · 区间 '+pct(stock.changePct)+'</div></div>';
  }).join('');
  var chart=Array.isArray(card.productSeries)&&card.productSeries.length>=2?'<div class="product-chart" id="commodity-chart-'+index+'" role="img" aria-label="'+esc(displayProductName(card.name))+'及关联股票归一化月线，悬停查看真实价格"></div>':'<div class="product-empty">商品与关联股票暂无足够的共同月份，暂不绘图。</div>';
  var badge=card.status==='ready'?'数据齐全':'部分数据缺失';
  return '<article class="commodity-card"><div class="commodity-head"><div><div class="commodity-title">'+esc(displayProductName(card.name))+'</div><div class="product-meta">'+esc(card.id)+' · '+esc(card.unit||'')+' · 商品数据 '+esc(card.latestDate||'—')+'</div></div><span class="product-status '+(card.status==='ready'?'sync':'')+'">'+badge+'</span></div><div class="commodity-metrics"><div><div class="product-metric-label">商品最新参考价</div><div class="product-metric-value">'+money(card.latestPrice)+' <small>'+esc(card.unit||'')+'</small></div></div><div><div class="product-metric-label">共同月线区间（最多 200 根）</div><div class="product-metric-value">'+(card.months&&card.months.length?card.months.length+' 根月线':'—')+'</div></div><div><div class="product-metric-label">商品区间变化</div><div class="product-metric-value '+tone(card.productChange)+'">'+pct(card.productChange)+'</div></div></div>'+chart+productSummaryHtml(card.productSeries,card.unit)+'<div class="commodity-stocks-title">关联股票月线</div>'+stockRows+''+(card.note?'<div class="product-note">'+esc(card.note)+'</div>':'')+'</article>';
 }).join('');
 list.forEach(function(card,index){
  var node=$('commodity-chart-'+index);
  if(!node||!window.echarts||!Array.isArray(card.productSeries)||card.productSeries.length<2)return;
  var chart=window.echarts.init(node);charts.push(chart);
  var series=[{name:displayProductName(card.name)+'（商品）',type:'line',smooth:false,showSymbol:false,lineStyle:{width:2.5},data:card.productSeries.map(function(point){return {value:Number(point.index),actualPrice:point.price,actualUnit:card.unit||'商品价格'};})}];
  (card.stocks||[]).forEach(function(stock){
   if(!Array.isArray(stock.values)||stock.values.length<2)return;
   series.push({name:stock.name,type:'line',smooth:false,showSymbol:false,lineStyle:{width:2},data:stock.values.map(function(point){return {value:Number(point.index),actualPrice:point.price,actualUnit:'元/股'};} )});
  });
  var compactLegend=window.matchMedia&&window.matchMedia('(max-width:575px)').matches;
  chart.setOption({
   animation:false,
   grid:compactLegend
    ?{left:2,right:2,top:8,bottom:48,containLabel:false}
    :{left:12,right:12,top:38,bottom:34,containLabel:true},
   legend:compactLegend
    ?{type:'scroll',orient:'horizontal',left:8,right:8,bottom:2,itemGap:9,itemWidth:12,itemHeight:8,pageButtonItemGap:4,pageIconSize:9,textStyle:{fontSize:10,color:'inherit'},formatter:function(name){return name.length>5?name.slice(0,5)+'…':name;}}
    :{top:2,textStyle:{fontSize:11,color:'inherit'}},
   xAxis:{type:'category',data:card.months||[],boundaryGap:false,axisLabel:{fontSize:10,hideOverlap:true}},
   yAxis:{type:'value',scale:true,axisLabel:{show:false},axisTick:{show:false},axisLine:{show:false},splitLine:{show:false}},
   series:series
  });
  // 按容器真实尺寸校准；手机旋屏、地址栏和卡片宽度变化均触发重排。
  chart.resize();
  if(typeof ResizeObserver==='function'){
   var observer=new ResizeObserver(function(){try{chart.resize();}catch(e){}});
   observer.observe(node);
   chartObservers.push(observer);
  }
 });
}
function load(){
 fetch('data/product-comparison.json?t='+Date.now(),{cache:'no-store'})
 .then(function(response){if(!response.ok)throw new Error('HTTP '+response.status);return response.json();})
 .then(function(payload){
  if(!payload||!Array.isArray(payload.commodityCards))throw new Error('商品月线数据格式不正确，请等待缓存任务重建');
  cards=payload.commodityCards;
  $('product-updated').textContent='数据生成：'+(payload.generatedAt?new Date(payload.generatedAt).toLocaleString('zh-CN',{hour12:false}):'未知')+' · '+cards.length+' 个商品';
  render();
 }).catch(function(error){
  $('product-updated').textContent='商品月线数据读取失败';
  $('product-cards').innerHTML='<div class="product-empty">商品月线数据暂不可用：'+esc(error.message)+'。</div>';
 });
}
window.addEventListener('resize',function(){charts.forEach(function(chart){try{chart.resize();}catch(e){}});});
load();
})();
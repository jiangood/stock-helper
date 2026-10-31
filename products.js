(function(){
'use strict';
var cards=[],charts=[],chartObservers=[];
function $(id){return document.getElementById(id);}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pct(value){return value==null||!Number.isFinite(Number(value))?'—':(Number(value)>0?'+':'')+Number(value).toFixed(2)+'%';}
function money(value){return value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
function normalizedPosition(value,min,max){var n=Number(value);if(!Number.isFinite(n))return null;if(!(max>min))return 0;return Math.max(0,Math.min(1,(n-min)/(max-min)));}
function priceStats(series){
 var points=(Array.isArray(series)?series:[]).filter(function(point){return point&&point.price!=null&&Number.isFinite(Number(point.price));});
 if(!points.length)return null;
 var prices=points.map(function(point){return Number(point.price);});
 return {low:Math.min.apply(null,prices),high:Math.max.apply(null,prices),first:prices[0],current:prices[prices.length-1]};
}
function comparisonRow(name,type,ratio,unit,series,change,href){
 var stats=priceStats(series);
 var ratioText=type==='商品'?'—':(ratio==null||!Number.isFinite(Number(ratio))?'暂无数据':(Number(ratio)*100).toFixed(1)+'%');
 var nameHtml=href?'<a class="commodity-stock-name text-body text-decoration-none" href="'+esc(href)+'">'+esc(name)+'</a>':'<strong>'+esc(name)+'</strong>';
 return '<tr><td>'+nameHtml+'</td><td>'+type+'</td><td>'+ratioText+'</td><td>'+esc(unit||'—')+'</td><td>'+(stats?money(stats.low):'—')+'</td><td>'+(stats?money(stats.high):'—')+'</td><td>'+(stats?money(stats.first):'—')+'</td><td>'+(stats?money(stats.current):'—')+'</td><td class="'+tone(change)+'">'+pct(change)+'</td></tr>';
}
function comparisonTableHtml(card){
 var rows=comparisonRow(displayProductName(card.name),'商品',null,card.unit,card.productSeries,card.productChange,'');
 rows+=(card.stocks||[]).map(function(stock){
  return comparisonRow(stock.name,'股票',stock.mainRatio,'元/股',stock.values,stock.changePct,'stock.html?code='+encodeURIComponent(stock.code));
 }).join('');
 return '<div class="commodity-table-wrap"><table class="commodity-comparison" aria-label="'+esc(displayProductName(card.name))+'及关联股票价格与主营占比汇总"><thead><tr><th>名称</th><th>类型</th><th>主营占比</th><th>单位</th><th>最低价</th><th>最高价</th><th>期初价</th><th>当前价</th><th>区间涨跌</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function tone(value){return Number(value)>0?'product-positive':Number(value)<0?'product-negative':'';}
function displayProductName(value){return String(value==null?'':value).replace(/[（(][^）)]*[）)]/g,'').trim();}
function destroyCharts(){chartObservers.forEach(function(observer){try{observer.disconnect();}catch(e){}});chartObservers=[];charts.forEach(function(chart){try{chart.dispose();}catch(e){}});charts=[];}
function render(){
 destroyCharts();
 var list=cards,node=$('product-cards');
 if(!list.length){node.innerHTML='<div class="product-empty">没有符合条件的商品</div>';return;}
 node.innerHTML=list.map(function(card,index){
  var comparisonTable=comparisonTableHtml(card);
  var chart=Array.isArray(card.productSeries)&&card.productSeries.length>=2?'<div class="product-chart" id="commodity-chart-'+index+'" role="img" aria-label="'+esc(displayProductName(card.name))+'及关联股票归一化月线，悬停查看真实价格"></div>':'<div class="product-empty">商品与关联股票暂无足够的共同月份，暂不绘图。</div>';
  var badge=card.status==='ready'?'数据齐全':'部分数据缺失';
  return '<article class="commodity-card"><div class="commodity-head"><div><div class="commodity-title">'+esc(displayProductName(card.name))+'</div><div class="product-meta">'+esc(displayProductName(card.name))+' · '+esc(card.unit||'')+' · 商品数据 '+esc(card.latestDate||'—')+'</div></div><span class="product-status '+(card.status==='ready'?'sync':'')+'">'+badge+'</span></div><div class="commodity-metrics"><div><div class="product-metric-label">商品最新参考价</div><div class="product-metric-value">'+money(card.latestPrice)+' <small>'+esc(card.unit||'')+'</small></div></div><div><div class="product-metric-label">共同月线区间（最多 200 根）</div><div class="product-metric-value">'+(card.months&&card.months.length?card.months.length+' 根月线':'—')+'</div></div><div><div class="product-metric-label">商品区间变化</div><div class="product-metric-value '+tone(card.productChange)+'">'+pct(card.productChange)+'</div></div></div>'+chart+'<div class="commodity-stocks-title">商品及关联股票价格汇总</div>'+comparisonTable+''+(card.note?'<div class="product-note">'+esc(card.note)+'</div>':'')+'</article>';
 }).join('');
 list.forEach(function(card,index){
  var node=$('commodity-chart-'+index);
  if(!node||!window.echarts||!Array.isArray(card.productSeries)||card.productSeries.length<2)return;
  var chart=window.echarts.init(node);charts.push(chart);
  var series=[{name:displayProductName(card.name),type:'line',smooth:false,showSymbol:false,lineStyle:{width:2.5},data:card.productSeries.map(function(point){return {value:Number(point.index),actualPrice:point.price,actualUnit:card.unit||'商品价格'};})}];
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
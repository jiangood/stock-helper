(function(){
'use strict';
var cards=[],charts=[];
function $(id){return document.getElementById(id);}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pct(value){return value==null||!Number.isFinite(Number(value))?'—':(Number(value)>0?'+':'')+Number(value).toFixed(2)+'%';}
function money(value){return value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
function tone(value){return Number(value)>0?'product-positive':Number(value)<0?'product-negative':'';}
function destroyCharts(){charts.forEach(function(chart){try{chart.dispose();}catch(e){}});charts=[];}
function render(){
 destroyCharts();
 var list=cards,node=$('product-cards');
 if(!list.length){node.innerHTML='<div class="product-empty">没有符合条件的商品</div>';return;}
 node.innerHTML=list.map(function(card,index){
  var stockRows=(card.stocks||[]).map(function(stock){
   var hasHistory=Array.isArray(stock.values)&&stock.values.length>=2;
   return '<div class="commodity-stock"><div><a class="commodity-stock-name text-body text-decoration-none" href="stock.html?code='+encodeURIComponent(stock.code)+'">'+esc(stock.name)+'</a><span class="product-meta ms-2">'+esc(stock.roleLabel||'关联观察')+(stock.mainRatio!=null?' · 主营占比 '+(Number(stock.mainRatio)*100).toFixed(1)+'%':'')+'</span></div><div class="commodity-stock-meta">'+(stock.latestClose!=null?'最新复权月收 '+money(stock.latestClose)+' 元':'暂无月线')+' · '+esc(stock.latestDate||'—')+' · 区间 '+pct(stock.changePct)+'</div></div>';
  }).join('');
  var chart=Array.isArray(card.productSeries)&&card.productSeries.length>=2?'<div class="product-chart" id="commodity-chart-'+index+'" role="img" aria-label="'+esc(card.name)+'及关联股票实际价格月线"></div>':'<div class="product-empty">商品与关联股票暂无足够的共同月份，暂不绘图。</div>';
  var badge=card.status==='ready'?'数据齐全':'部分数据缺失';
  return '<article class="commodity-card"><div class="commodity-head"><div><div class="commodity-title">'+esc(card.name)+'</div><div class="product-meta">'+esc(card.id)+' · '+esc(card.unit||'')+' · 商品数据 '+esc(card.latestDate||'—')+'</div></div><span class="product-status '+(card.status==='ready'?'sync':'')+'">'+badge+'</span></div><div class="commodity-metrics"><div><div class="product-metric-label">商品最新参考价</div><div class="product-metric-value">'+money(card.latestPrice)+' <small>'+esc(card.unit||'')+'</small></div></div><div><div class="product-metric-label">共同月线区间</div><div class="product-metric-value">'+(card.months&&card.months.length?card.months.length+' 个月':'—')+'</div></div><div><div class="product-metric-label">商品区间变化</div><div class="product-metric-value '+tone(card.productChange)+'">'+pct(card.productChange)+'</div></div></div>'+chart+'<div class="commodity-stocks-title">关联股票月线</div>'+stockRows+'<div class="product-note">图表显示实际价格：商品使用左侧纵轴（'+esc(card.unit||'商品价格')+'），股票复权月收使用右侧纵轴（元/股）；商品使用'+esc(card.source||'可用商品参考价')+'，股票使用'+(card.stocks||[]).map(function(stock){return esc(stock.source||'缺少月K');}).filter(function(v,i,a){return a.indexOf(v)===i;}).join(' / ')+'。'+esc(card.note||'')+' 商品价格不等同于公司实际售价，关联关系也不代表利润必然同向变化。</div></article>';
 }).join('');
 list.forEach(function(card,index){
  var node=$('commodity-chart-'+index);
  if(!node||!window.echarts||!Array.isArray(card.productSeries)||card.productSeries.length<2)return;
  var chart=window.echarts.init(node);charts.push(chart);
  var series=[{name:card.name+'（'+(card.unit||'商品价格')+'）',type:'line',yAxisIndex:0,smooth:false,showSymbol:false,lineStyle:{width:2.5},data:card.productSeries.map(function(point){return point.price;})}];
  (card.stocks||[]).forEach(function(stock){
   if(!Array.isArray(stock.values)||stock.values.length<2)return;
   series.push({name:stock.name+'（元/股）',type:'line',yAxisIndex:1,smooth:false,showSymbol:false,lineStyle:{width:2},data:stock.values.map(function(point){return point.price;})});
  });
  chart.setOption({
   animation:false,grid:{left:58,right:58,top:34,bottom:34,containLabel:false},
   legend:{top:2,textStyle:{fontSize:11,color:'inherit'}},
   tooltip:{trigger:'axis',axisPointer:{type:'cross'},formatter:function(params){
    if(!Array.isArray(params)||!params.length)return '';
    var month=params[0].axisValue;
    return '<strong>'+esc(month)+'</strong><br>'+params.map(function(item){return esc(item.seriesName)+'：'+Number(item.value).toFixed(2);}).join('<br>');
   }},
   xAxis:{type:'category',data:card.months||[],boundaryGap:false,axisLabel:{fontSize:10,hideOverlap:true}},
   yAxis:[{type:'value',position:'left',scale:true,axisLabel:{fontSize:10,formatter:function(value){return money(value);}},name:card.unit||'商品价格',nameTextStyle:{fontSize:9},splitLine:{lineStyle:{type:'dashed',opacity:.35}}},{type:'value',position:'right',scale:true,axisLabel:{fontSize:10,formatter:function(value){return money(value);}},name:'股票复权价（元/股）',nameTextStyle:{fontSize:9},splitLine:{show:false}}],
   series:series
  });
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
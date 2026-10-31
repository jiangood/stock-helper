(function(){
'use strict';
var products=[];
function $(id){return document.getElementById(id);}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pct(value){return value==null||!Number.isFinite(Number(value))?'—':(Number(value)*100).toFixed(1)+'%';}
function money(value){return value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
function basis(value){return value==='product'?'产品分类':value==='industry'?'行业分类':value==='manual-mapping'?'人工映射':'—';}
function sparkline(series){
 if(!Array.isArray(series)||series.length<2)return '<span class="db-meta">暂无足够月度数据</span>';
 var vals=series.map(function(p){return Number(p.price);}).filter(function(v){return Number.isFinite(v)&&v>0;});
 if(vals.length<2)return '<span class="db-meta">暂无足够月度数据</span>';
 var min=Math.min.apply(null,vals),max=Math.max.apply(null,vals),range=max-min||1;
 var points=series.map(function(p,i){var v=Number(p.price);var x=4+i*182/Math.max(1,series.length-1);var y=36-(v-min)/range*30;return Number.isFinite(v)?x.toFixed(1)+','+y.toFixed(1):null;}).filter(Boolean).join(' ');
 return '<svg class="db-chart" viewBox="0 0 190 42" role="img" aria-label="近五年月度价格趋势"><polyline fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" points="'+points+'"/></svg><span class="db-meta">'+esc(series[0].month)+' — '+esc(series[series.length-1].month)+' · '+series.length+' 个月</span>';
}
function monthDetails(series){
 if(!Array.isArray(series)||!series.length)return '';
 return '<details class="mt-1"><summary class="db-meta">展开月度价格（'+series.length+' 个月）</summary><div class="db-months">'+series.slice().reverse().map(function(p){return '<div class="db-month"><span>'+esc(p.month)+'</span><strong>'+money(p.price)+'</strong></div>';}).join('')+'</div></details>';
}
function visible(){
 var q=($('db-search').value||'').trim().toLowerCase(),filter=$('db-filter').value;
 return products.filter(function(p){
  var hay=[p.stockName,p.stockCode,p.productName,p.group].join(' ').toLowerCase();
  if(q&&hay.indexOf(q)<0)return false;
  if(filter==='available'&&p.priceStatus!=='available')return false;
  if(filter==='unavailable'&&p.priceStatus==='available')return false;
  return true;
 });
}
function render(){
 var rows=visible();$('db-count').textContent='显示 '+rows.length+' / '+products.length+' 项产品';
 if(!rows.length){$('db-rows').innerHTML='<tr><td colspan="7" class="db-empty">没有符合条件的产品</td></tr>';return;}
 $('db-rows').innerHTML=rows.map(function(p){
  var series=Array.isArray(p.priceSeries)?p.priceSeries:[];
  var last=series.length?series[series.length-1]:null;
  var status=p.priceStatus==='available'?'<span class="db-status ok">有历史价格</span>':'<span class="db-status pending">价格待补充</span>';
  var price=last?money(last.price)+' '+esc(p.priceUnit||'')+'<div class="db-meta">'+esc(last.month)+'</div>':'—';
  return '<tr><td><div class="db-stock"><a class="text-body text-decoration-none" href="stock.html?code='+encodeURIComponent(p.stockCode)+'">'+esc(p.stockName)+'</a></div><div class="db-code">'+esc(p.stockCode)+' · '+esc(p.group)+'</div></td><td><div class="db-product">'+esc(p.productName)+'</div><div class="db-meta">'+esc(basis(p.ratioBasis))+' · '+esc(p.ratioUnit||'')+'</div></td><td class="db-ratio">'+pct(p.revenueRatio)+'</td><td><div>'+esc(p.reportDate||'—')+'</div></td><td class="db-price">'+price+'</td><td>'+sparkline(series)+monthDetails(series)+(p.priceNote?'<div class="db-meta">'+esc(p.priceNote)+'</div>':'')+'</td><td>'+status+(p.priceKind?'<div class="db-meta">'+esc(p.priceKind)+'</div>':'')+'</td></tr>';
 }).join('');
}
function load(){
 fetch('data/company-products.json?t='+Date.now(),{cache:'no-store'})
 .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
 .then(function(data){
  if(!data||!Array.isArray(data.products))throw new Error('主营产品数据格式不正确');
  products=data.products;
  $('db-updated').textContent='更新：'+(data.updatedAt?new Date(data.updatedAt).toLocaleString('zh-CN',{hour12:false}):'未知')+' · '+(data.pricedCount||0)+' 项有月价';
  render();
 }).catch(function(error){$('db-updated').textContent='数据读取失败';$('db-rows').innerHTML='<tr><td colspan="7" class="db-empty">主营产品数据暂不可用：'+esc(error.message)+'</td></tr>';});
}
$('db-search').addEventListener('input',render);$('db-filter').addEventListener('change',render);load();
})();

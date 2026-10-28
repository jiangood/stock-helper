# 股票助手 Stock Helper

## 访问地址

- **在线首页：** [https://jiangood.github.io/stock-helper/](https://jiangood.github.io/stock-helper/)
- **个股详情示例（002408）：** [打开个股详情](https://jiangood.github.io/stock-helper/stock.html?code=sz002408)

首页提供股票池监控看板，支持实时行情、搜索、分组和纪律筛选；个股详情页可查看行情、K 线、估值与交易辅助面板。

## 本地预览

```bash
python -m http.server 8089
```

打开 http://localhost:8089/

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.html` | 股票池监控看板（Bootstrap 5）：搜索（含拼音）、分组、纪律筛选、市值/PE/PB/股息率、破净/八折/ST 旗标、纪律列（5 项自动筛选）、每日简报、股票池体检 |
| `stock.html` `stock.js` | 个股详情页（`?code=sz002408`）：行情、日周月 K、估值与周期位置、跟踪计划、做T、补仓、鳄鱼纪律、卖出纪律、资源股估值 |
| `stocks.json` | 股票基础数据（分组 / 别名 / 入场 / 重仓 / 止盈 / 股票池） |
| `croc.js` | 鳄鱼纪律工具：PB 八折、200 亿市值、PE 30 倍、纪律全过判定、入场/重仓区、连续涨停、月 K 分位、体检与简报 |
| `indicators.js` | 量价指标纯函数：MFI、OBV、A/D、MA、枢轴点、背离、筹码分布（POC/价值区）、量比 |
| `pinyin.js` | 搜索拼音索引：GB2312 6763 字主读音，支持首字母与全拼，无外部依赖 |
| `quotes.js` | 行情 SDK（东方财富 + 腾讯财经，多源降级；日/周/月 K、分钟 K、分时） |

## 鳄鱼纪律

`croc.js` 把资料里可量化的规则做成页面共用工具：

- **净资产八折**：PB ≤ 0.8 标记「八折」，PB < 1 标记「破净」
- **200 亿市值**：总市值 ≤ 200 亿才算通过「纪律」项，超过则扣一项
- **30 倍估值锚**：PE(TTM) 在 0–30 之间才算通过，> 30 或亏损均未过
- **不买 ST / 亏损**：首页旗标 + 体检风险清单
- **入场区 / 重仓区**：现价 ≤ 重仓价 / 入场价
- **卖其疯狂**：日 K 连续涨停 ≥ 3 或涨停打开时提示清仓纪律
- **历史分位**：月 K（最多 240 根）价格分位，辅助判断长周期位置
- **纪律全过**：非 ST、非亏损、PE ≤ 30、市值 ≤ 200 亿、PB < 1 五项自动筛选，首页「纪律」列显示通过数（全过 / 4/5 / 3/5…），可按「纪律全过」「全过 + 买点」筛选

首页 `📋` 弹窗查看每日简报（只读展示）：除重仓/入场/破净外，还会列出「纪律全过」「全过且到买点」以及「差一项」的标的与未过原因；`🩺` 检查 `stocks.json` 的结构问题（代码重复、买点区间写反、止盈顺序、ST/亏损）。

详情页「鳄鱼纪律」中可填写**持仓成本**，本机浏览器保存，用于计算翻倍卖点、三倍目标与浮盈；「资源股现价估值」按 `(P−C)×Q×折扣×PE` 粗算合理市值，同样只保存在本机。

> localStorage 键：`croc-cost:<code>`、`croc-valuation:<code>`。换浏览器或清缓存会丢失。

## 做T / 补仓

详情页两张面板均为纯前端计算，数据缺失只降级展示，不阻塞主流程：

- **做T（日内）**：现价对 VWAP 的偏离、15 分 MFI、量能（近 3 根 ÷ 前 12 根），外加单边行情过滤；给出正T / 倒T 参考价位与默认 2% 差价目标。分钟数据约 20 个交易日。
- **补仓（日线）**：① 到支撑（POC / 价值区下沿 / 重仓价 ≤3%）② 资金确认（MFI 底背离，或 MFI<20 后回升上穿）③ 趋势过滤（现价 > MA20，或 OBV 20 日不创新低）。3/3 才提示分批补仓，2/3 小仓试探。
- 筹码分布按日 K 成交量均匀摊到价格区间，是**近似**值；所有结论仅辅助参考，不构成投资建议。

拼音搜索示例：`tk` / `tksw` / `tiankang` / `kangsheng` 都能命中「天康生物」，`qitian` 命中别名「齐天大圣」。

## 行情 SDK

```js
const q = new StockQuotes.Client({ timeout: 8000, cacheTTL: 1000 });
const data = await q.fetch(['sz002408', 'sh600519']);
// { sz002408: { code, name, price, prevClose, change, todayChange, divYield, time } }

// 单只详情（含估值、52 周高低）
await q.fetchDetail('sz002408');

// K 线、分钟 K 与分时
await q.fetchKline('sz002408', { period: 'day', count: 250, adjust: 'qfq' });
await q.fetchMinuteKline('sz002408', { period: '15', count: 320 });   // 约 20 个交易日
await q.fetchTrends('sz002408');

StockQuotes.marketSession();   // 'open' | 'pre' | 'lunch' | 'closed' | 'holiday'
StockQuotes.isTrading();       // 是否处于需要刷新行情的时段
```

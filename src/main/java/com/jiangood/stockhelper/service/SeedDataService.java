package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.config.StockProperties;
import com.jiangood.stockhelper.domain.BusinessItem;
import com.jiangood.stockhelper.domain.CostInput;
import com.jiangood.stockhelper.domain.Fundamental;
import com.jiangood.stockhelper.domain.GlobalAsset;
import com.jiangood.stockhelper.domain.ResearchReport;
import com.jiangood.stockhelper.domain.ResearchScoreRecord;
import com.jiangood.stockhelper.domain.SectorMonthly;
import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.domain.StockDetail;
import com.jiangood.stockhelper.domain.StockKline;
import com.jiangood.stockhelper.domain.StockQuote;
import com.jiangood.stockhelper.repository.BusinessItemRepository;
import com.jiangood.stockhelper.repository.CostInputRepository;
import com.jiangood.stockhelper.repository.FundamentalRepository;
import com.jiangood.stockhelper.repository.GlobalAssetRepository;
import com.jiangood.stockhelper.repository.ResearchReportRepository;
import com.jiangood.stockhelper.repository.ResearchScoreRecordRepository;
import com.jiangood.stockhelper.repository.SectorMonthlyRepository;
import com.jiangood.stockhelper.repository.StockDetailRepository;
import com.jiangood.stockhelper.repository.StockKlineRepository;
import com.jiangood.stockhelper.repository.StockQuoteRepository;
import com.jiangood.stockhelper.repository.StockRepository;
import com.jiangood.stockhelper.support.CodeUtils;
import com.jiangood.stockhelper.support.JsonUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 首次启动时把仓库内的 JSON 历史数据导入 H2。
 * 使用「按业务键判断是否已存在」的幂等写法，已存在的数据不覆盖。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SeedDataService {

    private final StockProperties properties;
    private final StockRepository stockRepository;
    private final StockQuoteRepository quoteRepository;
    private final StockDetailRepository detailRepository;
    private final StockKlineRepository klineRepository;
    private final FundamentalRepository fundamentalRepository;
    private final ResearchReportRepository reportRepository;
    private final ResearchScoreRecordRepository scoreRepository;
    private final SectorMonthlyRepository sectorRepository;
    private final GlobalAssetRepository globalAssetRepository;
    private final BusinessItemRepository businessItemRepository;
    private final CostInputRepository costInputRepository;

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void importIfEmpty() {
        if (stockRepository.count() > 0) {
            return;
        }
        Path dir = Paths.get(properties.getSeedDir());
        if (!Files.isDirectory(dir)) {
            log.warn("种子数据目录不存在，跳过导入：{}", dir.toAbsolutePath());
            return;
        }
        log.info("开始从 {} 导入历史数据到 H2", dir.toAbsolutePath());
        try {
            importStocks(dir.resolve("stocks.json"));
            importQuotes(dir.resolve("stock-quotes.json"));
            importStockCaches(dir.resolve("stock-cache"));
            importIndexCache(dir.resolve("index-cache.json"));
            importFundamentals(dir.resolve("fundamentals.json"));
            importReports(dir.resolve("research-reports.json"));
            importScores(dir.resolve("research-scores.json"));
            importSectors(dir.resolve("sector-monthly.json"));
            importGlobalAssets(dir.resolve("global-assets-data.json"));
            importBusiness(dir.resolve("business-data.json"));
            log.info("历史数据导入完成：{} 只股票，{} 条 K 线", stockRepository.count(), klineRepository.count());
        } catch (Exception e) {
            log.error("历史数据导入失败", e);
            throw new IllegalStateException("历史数据导入失败", e);
        }
    }

    private JsonNode read(Path path) throws IOException {
        if (!Files.isRegularFile(path)) {
            log.warn("缺少种子文件：{}", path);
            return null;
        }
        return JsonUtils.mapper().readTree(Files.readString(path));
    }

    private void importStocks(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null || !root.isArray()) {
            return;
        }
        int index = 0;
        for (JsonNode node : root) {
            String code = CodeUtils.normalize(text(node, "code"));
            if (code == null) {
                continue;
            }
            Stock stock = new Stock();
            stock.setCode(code);
            stock.setName(text(node, "name"));
            stock.setAlias(text(node, "alias"));
            stock.setGroupName(text(node, "group"));
            stock.setYearInit(dbl(node, "yearInit"));
            stock.setEntry(dbl(node, "entry"));
            stock.setHeavy(dbl(node, "heavy"));
            stock.setTp1(dbl(node, "tp1"));
            stock.setTp2(dbl(node, "tp2"));
            stock.setPrevChg(dbl(node, "prevChg"));
            stock.setUpdDate(date(node, "updDate"));
            stock.setPool(node.path("pool").asBoolean(true));
            stock.setSortOrder(index++);
            fillPinyin(stock);
            stockRepository.save(stock);
        }
    }

    private void fillPinyin(Stock stock) {
        String text = (stock.getName() == null ? "" : stock.getName())
                + (stock.getAlias() == null ? "" : stock.getAlias());
        stock.setPinyinInitials(CodeUtils.initials(text));
        stock.setPinyinFull(CodeUtils.fullPinyin(text));
    }

    private void importQuotes(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null) {
            return;
        }
        LocalDate marketDate = date(root, "marketDate");
        JsonNode quotes = root.path("quotes");
        if (!quotes.isObject()) {
            return;
        }
        for (Map.Entry<String, JsonNode> entry : quotes.properties()) {
            String code = CodeUtils.normalize(entry.getKey());
            JsonNode node = entry.getValue();
            if (code == null || !node.isObject()) {
                continue;
            }
            StockQuote quote = quoteRepository.findByCode(code).orElseGet(StockQuote::new);
            quote.setCode(code);
            quote.setName(text(node, "name"));
            quote.setPrice(dbl(node, "price"));
            quote.setPrevClose(dbl(node, "prevClose"));
            quote.setChange(dbl(node, "change"));
            quote.setTodayChange(dbl(node, "todayChange"));
            quote.setPe(dbl(node, "pe"));
            quote.setPb(dbl(node, "pb"));
            quote.setTotalCap(dbl(node, "totalCap"));
            quote.setFloatCap(dbl(node, "floatCap"));
            quote.setDivYield(dbl(node, "divYield"));
            Long time = lng(node, "time");
            quote.setQuoteTime(time == null ? null : Instant.ofEpochMilli(time));
            quote.setMarketDate(marketDate != null ? marketDate : CodeUtils.chinaDate(quote.getQuoteTime()));
            quoteRepository.save(quote);
        }
    }

    private void importStockCaches(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) {
            return;
        }
        try (var stream = Files.list(dir)) {
            for (Path file : stream.filter(p -> p.toString().endsWith(".json")).toList()) {
                JsonNode cache = read(file);
                if (cache == null) {
                    continue;
                }
                String code = CodeUtils.normalize(text(cache, "code"));
                if (code == null) {
                    code = CodeUtils.normalize(file.getFileName().toString().replace(".json", ""));
                }
                if (code == null) {
                    continue;
                }
                JsonNode detail = cache.get("detail");
                if (detail != null && detail.isObject()) {
                    saveDetail(code, detail);
                }
                importBars(code, "day", "qfq", cache.get("dailyAdjusted"));
                importBars(code, "day", "none", cache.get("dailyRaw"));
                importBars(code, "week", "qfq", cache.get("weeklyAdjusted"));
                importBars(code, "month", "qfq", cache.get("monthlyAdjusted"));
            }
        }
    }

    private void saveDetail(String code, JsonNode node) {
        StockDetail detail = detailRepository.findByCode(code).orElseGet(StockDetail::new);
        detail.setCode(code);
        detail.setName(text(node, "name"));
        detail.setPrice(dbl(node, "price"));
        detail.setPrevClose(dbl(node, "prevClose"));
        detail.setChange(dbl(node, "change"));
        detail.setTodayChange(dbl(node, "todayChange"));
        detail.setOpen(dbl(node, "open"));
        detail.setHigh(dbl(node, "high"));
        detail.setLow(dbl(node, "low"));
        detail.setAvg(dbl(node, "avg"));
        detail.setVolume(dbl(node, "volume"));
        detail.setAmount(dbl(node, "amount"));
        detail.setTurnover(dbl(node, "turnover"));
        detail.setVolumeRatio(dbl(node, "volumeRatio"));
        detail.setAmplitude(dbl(node, "amplitude"));
        detail.setLimitUp(dbl(node, "limitUp"));
        detail.setLimitDown(dbl(node, "limitDown"));
        detail.setPe(dbl(node, "pe"));
        detail.setPeStatic(dbl(node, "peStatic"));
        detail.setPeTtm(dbl(node, "peTtm"));
        detail.setPb(dbl(node, "pb"));
        detail.setRoe(dbl(node, "roe"));
        detail.setGrossMargin(dbl(node, "grossMargin"));
        detail.setNetMargin(dbl(node, "netMargin"));
        detail.setRevenue(dbl(node, "revenue"));
        detail.setRevenueYoY(dbl(node, "revenueYoY"));
        detail.setProfit(dbl(node, "profit"));
        detail.setProfitYoY(dbl(node, "profitYoY"));
        detail.setNavPerShare(dbl(node, "navPerShare"));
        detail.setHigh52(dbl(node, "high52"));
        detail.setLow52(dbl(node, "low52"));
        detail.setListedAt(text(node, "listedAt"));
        detail.setBoard(text(node, "board"));
        detail.setTotalShares(dbl(node, "totalShares"));
        detail.setFloatShares(dbl(node, "floatShares"));
        detail.setTotalCap(dbl(node, "totalCap"));
        detail.setFloatCap(dbl(node, "floatCap"));
        Long time = lng(node, "time");
        detail.setQuoteTime(time == null ? null : Instant.ofEpochMilli(time));
        detailRepository.save(detail);
    }

    private void importBars(String code, String period, String adjust, JsonNode wrapper) {
        if (wrapper == null || !wrapper.isObject()) {
            return;
        }
        JsonNode bars = wrapper.get("bars");
        if (bars == null || !bars.isArray()) {
            return;
        }
        klineRepository.deleteByCodeAndPeriodAndAdjust(code, period, adjust);
        List<StockKline> list = new ArrayList<>();
        for (JsonNode node : bars) {
            String time = text(node, "time");
            Double open = dbl(node, "open");
            Double close = dbl(node, "close");
            Double high = dbl(node, "high");
            Double low = dbl(node, "low");
            if (time == null || open == null || close == null || high == null || low == null) {
                continue;
            }
            LocalDate tradeDate = parseDate(time);
            if (tradeDate == null) {
                continue;
            }
            StockKline kline = new StockKline();
            kline.setCode(code);
            kline.setPeriod(period);
            kline.setAdjust(adjust);
            kline.setTradeDate(tradeDate);
            kline.setOpen(open);
            kline.setClose(close);
            kline.setHigh(high);
            kline.setLow(low);
            kline.setVolume(dbl(node, "volume"));
            list.add(kline);
        }
        if (!list.isEmpty()) {
            klineRepository.saveAll(list);
        }
    }

    private void importIndexCache(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null) {
            return;
        }
        JsonNode monthly = root.path("monthly");
        if (!monthly.isObject()) {
            return;
        }
        for (Map.Entry<String, JsonNode> entry : monthly.properties()) {
            String code = CodeUtils.normalize(entry.getKey());
            if (code == null) {
                continue;
            }
            importBars(code, "month", "none", entry.getValue());
        }
    }

    private void importFundamentals(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null) {
            return;
        }
        JsonNode stocks = root.path("stocks");
        if (!stocks.isObject()) {
            return;
        }
        for (Map.Entry<String, JsonNode> entry : stocks.properties()) {
            String code = CodeUtils.normalize(entry.getKey());
            JsonNode node = entry.getValue();
            if (code == null || !node.isObject()) {
                continue;
            }
            Fundamental item = fundamentalRepository.findByCode(code).orElseGet(Fundamental::new);
            item.setCode(code);
            item.setName(text(node, "name"));
            item.setOwner(text(node, "owner"));
            item.setOwnerType(text(node, "ownerType"));
            item.setMainItem(text(node, "mainItem"));
            item.setMainRatio(dbl(node, "mainRatio"));
            item.setMainBasis(text(node, "mainBasis"));
            item.setMainDate(date(node, "mainDate"));
            item.setAnnualJson(node.has("annual") ? node.get("annual").toString() : null);
            fundamentalRepository.save(item);
        }
    }

    private void importReports(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null) {
            return;
        }
        JsonNode reports = root.path("reports");
        if (!reports.isObject()) {
            return;
        }
        for (Map.Entry<String, JsonNode> entry : reports.properties()) {
            String code = CodeUtils.normalize(entry.getKey());
            JsonNode node = entry.getValue();
            if (code == null || !node.isObject()) {
                continue;
            }
            ResearchReport item = reportRepository.findByCode(code).orElseGet(ResearchReport::new);
            item.setCode(code);
            item.setName(text(node, "name"));
            item.setScore(dbl(node, "score"));
            item.setReportDate(date(node, "date"));
            item.setSource(text(node, "source"));
            item.setAlternatesJson(node.has("alternates") ? node.get("alternates").toString() : null);
            reportRepository.save(item);
        }
    }

    private void importScores(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null) {
            return;
        }
        LocalDate marketDate = date(root, "marketDate");
        JsonNode scores = root.path("scores");
        if (!scores.isObject()) {
            return;
        }
        for (Map.Entry<String, JsonNode> entry : scores.properties()) {
            String code = CodeUtils.normalize(entry.getKey());
            JsonNode node = entry.getValue();
            if (code == null || !node.isObject()) {
                continue;
            }
            ResearchScoreRecord item = scoreRepository.findByCode(code).orElseGet(ResearchScoreRecord::new);
            item.setCode(code);
            item.setPoints(dbl(node, "points"));
            item.setMax(dbl(node, "max"));
            item.setPercent(dbl(node, "percent"));
            item.setComplete(node.path("complete").asBoolean(false));
            item.setBand(text(node, "band"));
            item.setItemsJson(node.has("items") ? node.get("items").toString() : null);
            item.setMetricsJson(node.has("metrics") ? node.get("metrics").toString() : null);
            item.setScoreDate(marketDate);
            scoreRepository.save(item);
        }
    }

    private void importSectors(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null) {
            return;
        }
        LocalDate marketDate = date(root, "marketDate");
        JsonNode stocks = root.path("stocks");
        if (!stocks.isObject()) {
            return;
        }
        for (Map.Entry<String, JsonNode> entry : stocks.properties()) {
            String code = CodeUtils.normalize(entry.getKey());
            JsonNode node = entry.getValue();
            if (code == null || !node.isObject()) {
                continue;
            }
            SectorMonthly item = sectorRepository.findByCode(code).orElseGet(SectorMonthly::new);
            item.setCode(code);
            item.setSource(text(node, "source"));
            item.setMonthKey(text(node, "month"));
            item.setClose(dbl(node, "close"));
            item.setM1(dbl(node, "m1"));
            item.setM3(dbl(node, "m3"));
            item.setM6(dbl(node, "m6"));
            item.setM12(dbl(node, "m12"));
            item.setMonths(intg(node, "months"));
            item.setMarketDate(marketDate);
            sectorRepository.save(item);
        }
    }

    private static final Map<String, String[]> ASSET_META = Map.of(
            "gold", new String[]{"贵金属", "USD/盎司"},
            "bitcoin", new String[]{"加密资产", "USD"},
            "ethereum", new String[]{"加密资产", "USD"},
            "nikkei225", new String[]{"海外指数", "指数点"},
            "nasdaq100", new String[]{"海外指数", "指数点"},
            "sp500", new String[]{"海外指数", "指数点"},
            "vix", new String[]{"波动率指标", "指数点"},
            "usdcny", new String[]{"外汇", "CNY/USD"});

    private void importGlobalAssets(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null) {
            return;
        }
        JsonNode assets = root.path("assets");
        if (!assets.isArray()) {
            return;
        }
        int index = 0;
        for (JsonNode node : assets) {
            String id = text(node, "id");
            if (id == null) {
                continue;
            }
            GlobalAsset item = globalAssetRepository.findByAssetId(id).orElseGet(GlobalAsset::new);
            item.setAssetId(id);
            item.setName(text(node, "name"));
            String[] meta = ASSET_META.getOrDefault(id, new String[]{"全球资产", ""});
            item.setKind(meta[0]);
            item.setUnit(meta[1]);
            item.setCurrency(text(node, "currency"));
            item.setStatus(text(node, "status"));
            item.setPrice(dbl(node, "price"));
            item.setPrevClose(dbl(node, "prevClose"));
            item.setChange(dbl(node, "change"));
            item.setChangePct(dbl(node, "changePct"));
            item.setQuoteTime(text(node, "quoteTime"));
            item.setSourceSymbol(text(node, "sourceSymbol"));
            item.setSourceUrl(text(node, "sourceUrl"));
            item.setHistoryJson(node.has("history") ? node.get("history").toString() : null);
            item.setSortOrder(index++);
            globalAssetRepository.save(item);
        }
    }

    private void importBusiness(Path path) throws IOException {
        JsonNode root = read(path);
        if (root == null) {
            return;
        }
        Instant updatedAt = instant(root, "updatedAt");
        JsonNode items = root.path("items");
        if (items.isObject()) {
            int index = 0;
            for (Map.Entry<String, JsonNode> entry : items.properties()) {
                saveBusinessItem(entry.getKey(), entry.getValue(), updatedAt, index++);
            }
        }
        JsonNode costInputs = root.path("costInputs");
        if (costInputs.isObject()) {
            int index = 0;
            for (Map.Entry<String, JsonNode> entry : costInputs.properties()) {
                JsonNode node = entry.getValue();
                if (!node.isObject()) {
                    continue;
                }
                CostInput item = costInputRepository.findByInputId(entry.getKey()).orElseGet(CostInput::new);
                item.setInputId(entry.getKey());
                item.setName(text(node, "name"));
                item.setUnit(text(node, "unit"));
                item.setRole(text(node, "role"));
                item.setRelatedProductsJson(node.has("relatedProducts") ? node.get("relatedProducts").toString() : null);
                item.setLatest(dbl(node, "latest"));
                item.setLatestDate(date(node, "latestDate"));
                item.setSeriesJson(node.has("series") ? node.get("series").toString() : null);
                item.setMonthlyPricesJson(node.has("monthlyPrices") ? node.get("monthlyPrices").toString() : null);
                item.setSource(text(node, "source"));
                item.setSourceUrl(text(node, "sourceUrl"));
                item.setStatus(text(node, "status"));
                item.setSortOrder(index++);
                costInputRepository.save(item);
            }
        }
    }

    private void saveBusinessItem(String id, JsonNode node, Instant updatedAt, int index) {
        if (!node.isObject()) {
            return;
        }
        BusinessItem item = businessItemRepository.findByItemId(id).orElseGet(BusinessItem::new);
        item.setItemId(id);
        item.setName(text(node, "name"));
        item.setUnit(text(node, "unit"));
        item.setSymbol(text(node, "symbol"));
        item.setSeriesJson(node.has("series") ? node.get("series").toString() : null);
        item.setLatest(dbl(node, "latest"));
        item.setLatestDate(date(node, "latestDate"));
        item.setLatestSpot(dbl(node, "latestSpot"));
        item.setLatestFutures(dbl(node, "latestFutures"));
        item.setFuturesDate(date(node, "futuresDate"));
        item.setFuturesTime(text(node, "futuresTime"));
        item.setFuturesSource(text(node, "futuresSource"));
        item.setFuturesSourceUrl(text(node, "futuresSourceUrl"));
        item.setChangePct(dbl(node, "changePct"));
        item.setInventoryJson(node.has("inventory") ? node.get("inventory").toString() : null);
        item.setMonthlyPricesJson(node.has("monthlyPrices") ? node.get("monthlyPrices").toString() : null);
        item.setIndustryLinksJson(node.has("industryLinks") ? node.get("industryLinks").toString() : null);
        item.setStocksJson(node.has("stocks") ? node.get("stocks").toString() : null);
        item.setChain(text(node, "chain"));
        item.setDrivers(text(node, "drivers"));
        item.setSource(text(node, "source"));
        item.setSourceUrl(text(node, "sourceUrl"));
        item.setStatus(text(node, "status"));
        item.setUpdatedAt(updatedAt);
        item.setSortOrder(index);
        businessItemRepository.save(item);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static Double dbl(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (value.isNumber()) {
            return value.asDouble();
        }
        try {
            return Double.parseDouble(value.asText());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Long lng(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.isNumber() ? value.asLong() : null;
    }

    private static Integer intg(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.isNumber() ? value.asInt() : null;
    }

    private static LocalDate date(JsonNode node, String field) {
        String value = text(node, field);
        return parseDate(value);
    }

    private static LocalDate parseDate(String value) {
        if (value == null) {
            return null;
        }
        String s = value.length() > 10 ? value.substring(0, 10) : value;
        try {
            return LocalDate.parse(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static Instant instant(JsonNode node, String field) {
        String value = text(node, field);
        if (value == null) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (Exception e) {
            return null;
        }
    }
}

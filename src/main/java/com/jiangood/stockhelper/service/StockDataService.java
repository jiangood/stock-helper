package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.BusinessItem;
import com.jiangood.stockhelper.domain.CostInput;
import com.jiangood.stockhelper.domain.Fundamental;
import com.jiangood.stockhelper.domain.GlobalAsset;
import com.jiangood.stockhelper.domain.ResearchReport;
import com.jiangood.stockhelper.domain.ResearchScoreRecord;
import com.jiangood.stockhelper.domain.SectorMonthly;
import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.domain.StockDetail;
import com.jiangood.stockhelper.domain.StockQuote;
import com.jiangood.stockhelper.indicator.Bar;
import com.jiangood.stockhelper.indicator.CrocEvaluator;
import com.jiangood.stockhelper.indicator.ResearchScoreCalculator;
import com.jiangood.stockhelper.indicator.TechIndicators;
import com.jiangood.stockhelper.indicator.TradeSignalCalculator;
import com.jiangood.stockhelper.repository.BusinessItemRepository;
import com.jiangood.stockhelper.repository.CostInputRepository;
import com.jiangood.stockhelper.repository.FundamentalRepository;
import com.jiangood.stockhelper.repository.GlobalAssetRepository;
import com.jiangood.stockhelper.repository.ResearchReportRepository;
import com.jiangood.stockhelper.repository.ResearchScoreRecordRepository;
import com.jiangood.stockhelper.repository.SectorMonthlyRepository;
import com.jiangood.stockhelper.repository.StockDetailRepository;
import com.jiangood.stockhelper.repository.StockQuoteRepository;
import com.jiangood.stockhelper.repository.StockRepository;
import com.jiangood.stockhelper.support.CodeUtils;
import com.jiangood.stockhelper.support.JsonUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.text.Collator;
import java.time.LocalDate;
import java.time.Period;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * 页面读模型：自选看板、个股详情、作战信号、行情概览、全球资产。
 * 所有派生值在服务端计算，缺失数据返回 null，前端只负责格式化与展示。
 */
@Service
@RequiredArgsConstructor
public class StockDataService {

    private static final Collator ZH = Collator.getInstance(Locale.CHINA);

    private final StockRepository stockRepository;
    private final StockQuoteRepository quoteRepository;
    private final StockDetailRepository detailRepository;
    private final ResearchReportRepository reportRepository;
    private final ResearchScoreRecordRepository scoreRepository;
    private final SectorMonthlyRepository sectorRepository;
    private final FundamentalRepository fundamentalRepository;
    private final GlobalAssetRepository globalAssetRepository;
    private final BusinessItemRepository businessItemRepository;
    private final CostInputRepository costInputRepository;
    private final KlineService klineService;

    // ==================== 自选看板 ====================

    public Map<String, Object> dashboard(String search, String group, String status) {
        List<Stock> stocks = stockRepository.findAllByOrderBySortOrderAsc();
        Map<String, StockQuote> quotes = quotes();
        Map<String, ResearchReport> reports = reports();
        Map<String, ResearchScoreRecord> scores = scores();

        List<Map<String, Object>> rows = new ArrayList<>();
        for (Stock stock : stocks) {
            StockQuote quote = quotes.get(stock.getCode());
            Map<String, Object> row = dashboardRow(stock, quote, reports.get(stock.getCode()), scores.get(stock.getCode()));
            if (!matchesGroup(stock, group) || !matchesStatus(stock, quote, row, status)
                    || !matchesSearch(stock, search)) {
                continue;
            }
            rows.add(row);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rows", rows);
        result.put("total", stocks.size());
        result.put("filtered", rows.size());
        result.put("summary", dashboardSummary(stocks, quotes, reports, scores));
        result.put("groups", groups(stocks));
        result.put("generatedAt", System.currentTimeMillis());
        return result;
    }

    private Map<String, Object> dashboardRow(Stock stock, StockQuote quote, ResearchReport report,
                                             ResearchScoreRecord score) {
        CrocEvaluator.Eval e = CrocEvaluator.evaluate(stock, quote);
        CrocEvaluator.Screen screen = CrocEvaluator.screen(stock, quote);
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("code", stock.getCode());
        row.put("name", stock.getName());
        row.put("alias", stock.getAlias());
        row.put("group", stock.getGroupName());
        row.put("pinyinInitials", stock.getPinyinInitials());
        row.put("pinyinFull", stock.getPinyinFull());
        row.put("entry", stock.getEntry());
        row.put("heavy", stock.getHeavy());
        row.put("tp1", stock.getTp1());
        row.put("tp2", stock.getTp2());
        row.put("yearInit", stock.getYearInit());
        row.put("prevChg", stock.getPrevChg());
        row.put("updDate", stock.getUpdDate() == null ? null : stock.getUpdDate().toString());
        row.put("price", e.price());
        row.put("prevClose", quote == null ? null : quote.getPrevClose());
        row.put("todayChange", quote == null ? null : quote.getTodayChange());
        row.put("pe", e.pe());
        row.put("pb", e.pb());
        row.put("totalCap", e.cap());
        row.put("divYield", quote == null ? null : quote.getDivYield());
        row.put("zone", e.zone());
        row.put("st", e.st());
        row.put("loss", e.loss());
        row.put("pbUnder1", e.pbUnder1());
        row.put("pbGolden", e.pbGolden());
        row.put("smallCap", e.smallCap());
        row.put("tp1Reached", e.price() != null && stock.getTp1() != null && e.price() >= stock.getTp1());
        row.put("tp2Reached", e.price() != null && stock.getTp2() != null && e.price() >= stock.getTp2());

        Map<String, Object> screenMap = new LinkedHashMap<>();
        screenMap.put("passed", screen.passed());
        screenMap.put("total", screen.total());
        screenMap.put("complete", screen.complete());
        screenMap.put("allPass", screen.allPass());
        screenMap.put("failed", screen.failed().stream().map(CrocEvaluator.Check::label).toList());
        screenMap.put("pending", screen.pending().stream().map(CrocEvaluator.Check::label).toList());
        row.put("screen", screenMap);
        row.put("flags", flags(e));

        row.put("machineScore", machineScore(score));
        row.put("reportScore", reportScore(report));
        row.put("scoreSort", report != null ? report.getScore()
                : score != null ? score.getPercent() : null);
        return row;
    }

    private List<String> flags(CrocEvaluator.Eval e) {
        List<String> flags = new ArrayList<>();
        if (e.st()) {
            flags.add("ST");
        }
        if (e.loss()) {
            flags.add("亏");
        }
        if (e.pbGolden()) {
            flags.add("八折");
        } else if (e.pbUnder1()) {
            flags.add("破净");
        }
        return flags;
    }

    private Map<String, Object> machineScore(ResearchScoreRecord score) {
        if (score == null) {
            return null;
        }
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("points", score.getPoints());
        map.put("max", score.getMax());
        map.put("percent", score.getPercent());
        map.put("complete", score.getComplete());
        map.put("band", score.getBand());
        map.put("bandLabel", ResearchScoreCalculator.bandLabel(score.getBand()));
        map.put("items", JsonUtils.readMap(score.getItemsJson()));
        map.put("metrics", JsonUtils.readMap(score.getMetricsJson()));
        map.put("scoreDate", score.getScoreDate() == null ? null : score.getScoreDate().toString());
        return map;
    }

    private Map<String, Object> reportScore(ResearchReport report) {
        if (report == null) {
            return null;
        }
        Integer months = monthsBetween(report.getReportDate());
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("score", report.getScore());
        map.put("date", report.getReportDate() == null ? null : report.getReportDate().toString());
        map.put("source", report.getSource());
        map.put("months", months);
        map.put("stale", months != null && months >= 12);
        map.put("bandLabel", reportBand(report.getScore()));
        map.put("alternates", JsonUtils.readList(report.getAlternatesJson()));
        return map;
    }

    private Map<String, Object> dashboardSummary(List<Stock> stocks, Map<String, StockQuote> quotes,
                                                 Map<String, ResearchReport> reports,
                                                 Map<String, ResearchScoreRecord> scores) {
        int heavy = 0;
        int pb = 0;
        int pb80 = 0;
        int risk = 0;
        int pass = 0;
        int scoreGood = 0;
        for (Stock stock : stocks) {
            StockQuote quote = quotes.get(stock.getCode());
            CrocEvaluator.Eval e = CrocEvaluator.evaluate(stock, quote);
            if ("heavy".equals(e.zone())) {
                heavy++;
            }
            if (e.pbUnder1()) {
                pb++;
            }
            if (e.pbGolden()) {
                pb80++;
            }
            if (e.st() || e.loss()) {
                risk++;
            }
            if (CrocEvaluator.screen(stock, quote).allPass()) {
                pass++;
            }
            ResearchReport report = reports.get(stock.getCode());
            ResearchScoreRecord score = scores.get(stock.getCode());
            if (report != null && report.getScore() != null && report.getScore() >= 80) {
                scoreGood++;
            } else if (report == null && score != null && score.getPercent() != null && score.getPercent() >= 75) {
                scoreGood++;
            }
        }
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("heavy", heavy);
        summary.put("pb", pb);
        summary.put("pb80", pb80);
        summary.put("risk", risk);
        summary.put("pass", pass);
        summary.put("score", scoreGood);
        return summary;
    }

    private boolean matchesGroup(Stock stock, String group) {
        return group == null || group.isBlank() || group.equals(stock.getGroupName());
    }

    private boolean matchesSearch(Stock stock, String search) {
        if (search == null || search.isBlank()) {
            return true;
        }
        String q = search.trim().toLowerCase(Locale.ROOT);
        String key = q.replaceAll("\\s+", "");
        boolean lettersOnly = key.matches("^[a-z]+$");
        return contains(stock.getName(), q) || contains(stock.getCode(), q) || contains(stock.getAlias(), q)
                || contains(stock.getGroupName(), q)
                || (lettersOnly && (contains(stock.getPinyinInitials(), key)
                || contains(stock.getPinyinFull(), key)
                || contains(stock.getPinyinFull() == null ? null : stock.getPinyinFull().replace("v", "u"), key)));
    }

    private static boolean contains(String value, String needle) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(needle);
    }

    private boolean matchesStatus(Stock stock, StockQuote quote, Map<String, Object> row, String status) {
        if (status == null || status.isBlank()) {
            return true;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> report = (Map<String, Object>) row.get("reportScore");
        @SuppressWarnings("unchecked")
        Map<String, Object> machine = (Map<String, Object>) row.get("machineScore");
        Double reportScore = report == null ? null : asDouble(report.get("score"));
        Double percent = machine == null ? null : asDouble(machine.get("percent"));
        return switch (status) {
            case "score-report" -> report != null;
            case "score-report80" -> reportScore != null && reportScore >= 80;
            case "score-good" -> reportScore != null ? reportScore >= 80 : percent != null && percent >= 75;
            case "score-low" -> reportScore != null ? reportScore < 70 : percent != null && percent < 56;
            default -> CrocEvaluator.matchStatus(stock, quote, status);
        };
    }

    public List<Map<String, String>> groups(List<Stock> stocks) {
        return stocks.stream().map(Stock::getGroupName).filter(Objects::nonNull).distinct()
                .sorted(ZH::compare)
                .map(g -> Map.of("label", g, "value", g)).toList();
    }

    public List<Map<String, Object>> searchStocks(String keyword) {
        List<Stock> stocks = stockRepository.findAllByOrderBySortOrderAsc();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Stock stock : stocks) {
            if (matchesSearch(stock, keyword)) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("code", stock.getCode());
                item.put("name", stock.getName());
                item.put("group", stock.getGroupName());
                out.add(item);
            }
        }
        return out;
    }

    // ==================== 个股详情 ====================

    public Map<String, Object> detail(String rawCode) {
        String code = CodeUtils.normalize(rawCode);
        Stock stock = code == null ? null : stockRepository.findByCode(code).orElse(null);
        if (stock == null) {
            return null;
        }
        StockQuote quote = quoteRepository.findByCode(stock.getCode()).orElse(null);
        StockDetail detail = detailRepository.findByCode(stock.getCode()).orElse(null);
        List<Bar> daily = klineService.bars(stock.getCode(), "day", "qfq");
        List<Bar> dailyRaw = klineService.bars(stock.getCode(), "day", "none");
        List<Bar> monthly = klineService.bars(stock.getCode(), "month", "qfq");

        Map<String, Object> quoteMap = quoteMap(quote, detail, daily);
        Map<String, Object> history = historyStats(monthly, asDouble(quoteMap.get("price")));
        Map<String, Object> peer = peerStats(stock, detail);
        Map<String, Object> plan = planView(stock, quoteMap, detail);
        Map<String, Object> add = addView(stock, quoteMap, daily);
        Map<String, Object> discipline = disciplineView(stock, quoteMap, detail, history, dailyRaw);
        Map<String, Object> score = scoreView(stock);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("stock", stockView(stock));
        result.put("quote", quoteMap);
        result.put("history", history);
        result.put("peer", peer);
        result.put("plan", plan);
        result.put("add", add);
        result.put("discipline", discipline);
        result.put("score", score);
        result.put("generatedAt", System.currentTimeMillis());
        return result;
    }

    private Map<String, Object> stockView(Stock stock) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("code", stock.getCode());
        map.put("code6", CodeUtils.code6(stock.getCode()));
        map.put("name", stock.getName());
        map.put("alias", stock.getAlias());
        map.put("group", stock.getGroupName());
        map.put("yearInit", stock.getYearInit());
        map.put("entry", stock.getEntry());
        map.put("heavy", stock.getHeavy());
        map.put("tp1", stock.getTp1());
        map.put("tp2", stock.getTp2());
        map.put("prevChg", stock.getPrevChg());
        map.put("updDate", stock.getUpdDate() == null ? null : stock.getUpdDate().toString());
        return map;
    }

    private Map<String, Object> quoteMap(StockQuote quote, StockDetail detail, List<Bar> daily) {
        Map<String, Object> map = new LinkedHashMap<>();
        Double price = detail != null && detail.getPrice() != null ? detail.getPrice()
                : quote == null ? null : quote.getPrice();
        map.put("price", price);
        map.put("prevClose", detail != null ? detail.getPrevClose() : quote == null ? null : quote.getPrevClose());
        map.put("change", detail != null ? detail.getChange() : quote == null ? null : quote.getChange());
        map.put("todayChange", detail != null ? detail.getTodayChange() : quote == null ? null : quote.getTodayChange());
        map.put("open", detail == null ? null : detail.getOpen());
        map.put("high", detail == null ? null : detail.getHigh());
        map.put("low", detail == null ? null : detail.getLow());
        map.put("avg", detail == null ? null : detail.getAvg());
        map.put("amount", detail == null ? null : detail.getAmount());
        map.put("turnover", detail == null ? null : detail.getTurnover());
        map.put("volumeRatio", detail == null ? null : detail.getVolumeRatio());
        map.put("pe", detail == null ? null : detail.getPe());
        map.put("peTtm", detail == null ? null : detail.getPeTtm());
        map.put("peStatic", detail == null ? null : detail.getPeStatic());
        map.put("pb", detail != null && detail.getPb() != null ? detail.getPb()
                : quote == null ? null : quote.getPb());
        map.put("navPerShare", detail == null ? null : detail.getNavPerShare());
        map.put("roe", detail == null ? null : detail.getRoe());
        map.put("grossMargin", detail == null ? null : detail.getGrossMargin());
        map.put("netMargin", detail == null ? null : detail.getNetMargin());
        map.put("revenue", detail == null ? null : detail.getRevenue());
        map.put("revenueYoY", detail == null ? null : detail.getRevenueYoY());
        map.put("profit", detail == null ? null : detail.getProfit());
        map.put("profitYoY", detail == null ? null : detail.getProfitYoY());
        map.put("totalCap", detail != null && detail.getTotalCap() != null ? detail.getTotalCap()
                : quote == null ? null : quote.getTotalCap());
        map.put("floatCap", detail != null && detail.getFloatCap() != null ? detail.getFloatCap()
                : quote == null ? null : quote.getFloatCap());
        map.put("totalShares", detail == null ? null : detail.getTotalShares());
        map.put("divYield", quote == null ? null : quote.getDivYield());
        map.put("listedAt", detail == null ? null : detail.getListedAt());
        map.put("board", detail == null ? null : detail.getBoard());
        Double high52 = detail == null ? null : detail.getHigh52();
        Double low52 = detail == null ? null : detail.getLow52();
        if ((high52 == null || low52 == null) && !daily.isEmpty()) {
            double hi = -Double.MAX_VALUE;
            double lo = Double.MAX_VALUE;
            int from = Math.max(0, daily.size() - 250);
            for (int i = from; i < daily.size(); i++) {
                Bar bar = daily.get(i);
                if (bar.high() != null) {
                    hi = Math.max(hi, bar.high());
                }
                if (bar.low() != null) {
                    lo = Math.min(lo, bar.low());
                }
            }
            if (hi > lo) {
                high52 = hi;
                low52 = lo;
            }
        }
        map.put("high52", high52);
        map.put("low52", low52);
        map.put("quoteTime", detail != null && detail.getQuoteTime() != null ? detail.getQuoteTime().toString()
                : quote == null || quote.getQuoteTime() == null ? null : quote.getQuoteTime().toString());
        Double lo = asDouble(map.get("low52"));
        Double hi = asDouble(map.get("high52"));
        if (price != null && lo != null && hi != null && hi > lo) {
            double pos = Math.max(0, Math.min(100, (price - lo) / (hi - lo) * 100));
            map.put("position52", pos);
            map.put("zone52", pos < 25 ? "低位区" : pos > 75 ? "高位区" : "中枢区");
            map.put("toLow", (price / lo - 1) * 100);
            map.put("toHigh", (price / hi - 1) * 100);
        } else {
            map.put("position52", null);
            map.put("zone52", null);
            map.put("toLow", null);
            map.put("toHigh", null);
        }
        return map;
    }

    private Map<String, Object> historyStats(List<Bar> monthly, Double price) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (monthly.isEmpty() || price == null) {
            map.put("count", monthly.size());
            return map;
        }
        List<Double> closes = monthly.stream().map(Bar::close).filter(Objects::nonNull).toList();
        double lo = monthly.stream().map(Bar::low).filter(Objects::nonNull).mapToDouble(Double::doubleValue).min().orElse(Double.NaN);
        double hi = monthly.stream().map(Bar::high).filter(Objects::nonNull).mapToDouble(Double::doubleValue).max().orElse(Double.NaN);
        if (closes.isEmpty() || !(hi > lo)) {
            map.put("count", monthly.size());
            return map;
        }
        map.put("lo", lo);
        map.put("hi", hi);
        map.put("count", monthly.size());
        map.put("pos", CrocEvaluator.percentile(closes, price));
        map.put("rangePos", Math.max(0, Math.min(100, (price - lo) / (hi - lo) * 100)));
        return map;
    }

    private Map<String, Object> peerStats(Stock stock, StockDetail detail) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("group", stock.getGroupName());
        if (stock.getGroupName() == null) {
            map.put("summary", "该股票未分组，暂无同组数据");
            return map;
        }
        List<Stock> peers = stockRepository.findAllByOrderBySortOrderAsc().stream()
                .filter(s -> stock.getGroupName().equals(s.getGroupName()) && !s.getCode().equals(stock.getCode()))
                .toList();
        List<Double> peList = new ArrayList<>();
        List<Double> pbList = new ArrayList<>();
        List<StockDetail> details = detailRepository.findAllByCodeIn(peers.stream().map(Stock::getCode).toList());
        for (StockDetail peer : details) {
            if (peer.getPeTtm() != null && peer.getPeTtm() > 0) {
                peList.add(peer.getPeTtm());
            }
            if (peer.getPb() != null && peer.getPb() > 0) {
                pbList.add(peer.getPb());
            }
        }
        Double peMedian = median(peList);
        Double pbMedian = median(pbList);
        map.put("count", details.size() + 1);
        map.put("peMedian", peMedian);
        map.put("pbMedian", pbMedian);
        if (detail != null && detail.getPeTtm() != null && detail.getPeTtm() > 0
                && peMedian != null && peMedian != 0) {
            map.put("peDiffPct", (detail.getPeTtm() - peMedian) / peMedian * 100);
        }
        if (detail != null && detail.getPb() != null && detail.getPb() > 0
                && pbMedian != null && pbMedian != 0) {
            map.put("pbDiffPct", (detail.getPb() - pbMedian) / pbMedian * 100);
        }
        map.put("summary", "组内 " + (details.size() + 1) + " 只 · PE(TTM) 中位数 "
                + fmt(peMedian) + (map.get("peDiffPct") == null ? ""
                : "（本股 " + fmt(detail.getPeTtm()) + "，" + (asDouble(map.get("peDiffPct")) > 0 ? "溢价" : "折价")
                + " " + fmt(Math.abs(asDouble(map.get("peDiffPct")))) + "%）")
                + " · PB 中位数 " + fmt(pbMedian) + (map.get("pbDiffPct") == null ? ""
                : "（本股 " + fmt(detail.getPb()) + "，" + (asDouble(map.get("pbDiffPct")) > 0 ? "溢价" : "折价")
                + " " + fmt(Math.abs(asDouble(map.get("pbDiffPct")))) + "%）"));
        return map;
    }

    private static Double median(List<Double> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        List<Double> list = values.stream().sorted().toList();
        int m = list.size() / 2;
        return list.size() % 2 == 1 ? list.get(m) : (list.get(m - 1) + list.get(m)) / 2;
    }

    private Map<String, Object> planView(Stock stock, Map<String, Object> quote, StockDetail detail) {
        Double price = asDouble(quote.get("price"));
        Double pe = detail != null && detail.getPeTtm() != null ? detail.getPeTtm() : asDouble(quote.get("pe"));
        StockQuote proxy = new StockQuote();
        proxy.setName(stock.getName());
        proxy.setPe(pe);
        CrocEvaluator.Eligibility eligibility = CrocEvaluator.buyEligibility(stock, proxy);
        String buyBlock = eligibility.eligible() ? null : eligibility.reason();

        List<Map<String, Object>> levels = new ArrayList<>();
        levels.add(level(stock, "heavy", "重仓", stock.getHeavy(), price, buyBlock));
        levels.add(level(stock, "entry", "入场", stock.getEntry(), price, buyBlock));
        levels.add(level(stock, "tp1", "止盈1", stock.getTp1(), price, buyBlock));
        levels.add(level(stock, "tp2", "止盈2", stock.getTp2(), price, buyBlock));

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("yearInit", stock.getYearInit());
        meta.put("ytd", price != null && stock.getYearInit() != null && stock.getYearInit() > 0
                ? (price / stock.getYearInit() - 1) * 100 : null);
        meta.put("prevChg", stock.getPrevChg());
        meta.put("group", stock.getGroupName());
        meta.put("updDate", stock.getUpdDate() == null ? null : stock.getUpdDate().toString());
        meta.put("alias", stock.getAlias());

        Map<String, Object> map = new LinkedHashMap<>();
        map.put("levels", levels);
        map.put("meta", meta);
        map.put("zone", CrocEvaluator.zoneOf(stock, price));
        map.put("buyBlock", buyBlock);
        return map;
    }

    private Map<String, Object> level(Stock stock, String key, String label, Double value, Double price,
                                      String buyBlock) {
        Map<String, Object> level = new LinkedHashMap<>();
        level.put("key", key);
        level.put("label", label);
        level.put("value", value);
        if (value == null || value <= 0 || price == null || price <= 0) {
            level.put("diffPct", null);
            level.put("direction", null);
            level.put("status", "unset");
            level.put("statusLabel", "未设置");
            return level;
        }
        double diff = (value - price) / price * 100;
        level.put("diffPct", diff);
        level.put("direction", diff > 0 ? "上方" : diff < 0 ? "下方" : "持平");
        if ("heavy".equals(key) || "entry".equals(key)) {
            if (buyBlock != null) {
                level.put("status", "blocked");
                level.put("statusLabel", "盈利数据缺失，暂不判断买点".equals(buyBlock) ? "待核实盈利" : "禁止买入");
                level.put("blockReason", buyBlock);
            } else if (price <= value) {
                level.put("status", "reached");
                level.put("statusLabel", "heavy".equals(key) ? "已到重仓区" : "低于入场");
            } else {
                level.put("status", "above");
                level.put("statusLabel", "未到");
            }
        } else {
            level.put("status", price >= value ? "reached" : "above");
            level.put("statusLabel", price >= value ? "已达成" : "未达成");
        }
        return level;
    }

    // ==================== 补仓与纪律 ====================

    private Map<String, Object> addView(Stock stock, Map<String, Object> quote, List<Bar> bars) {
        Double price = asDouble(quote.get("price"));
        Map<String, Object> map = new LinkedHashMap<>();
        if (bars == null || bars.isEmpty()) {
            map.put("score", 0);
            map.put("badge", "日K 不可用");
            map.put("checks", List.of());
            map.put("hint", "日K 获取失败，补仓面板暂不可用；不影响行情展示。");
            return map;
        }
        TechIndicators.VolumeProfile profile = bars.size() >= 20
                ? TechIndicators.volumeProfile(bars, 30, 120, 0.7) : null;
        TechIndicators.Series mfiRes = bars.size() >= 16 ? TechIndicators.mfi(bars, 14) : null;
        Double mfi = mfiRes == null ? null : mfiRes.latest();
        TechIndicators.Divergence div = mfiRes == null ? null
                : TechIndicators.detectDivergence(bars, mfiRes.series(), null, null, null);
        TechIndicators.Divergence bottomDiv = div != null && "bottom".equals(div.type()) ? div : null;
        Map<String, Object> recover = mfiRecovery(mfiRes == null ? null : mfiRes.series());

        TechIndicators.Series maRes = bars.size() >= 20 ? TechIndicators.ma(bars, 20) : null;
        Double maLatest = maRes == null ? null : maRes.latest();
        boolean aboveMa = maLatest != null && price != null && price > maLatest;

        Boolean obvNewLow = null;
        if (bars.size() >= 20) {
            List<Double> obv = TechIndicators.obv(bars).series().subList(bars.size() - 20, bars.size());
            List<Double> valid = obv.stream().filter(Objects::nonNull).toList();
            if (valid.size() >= 2) {
                double min = valid.subList(0, valid.size() - 1).stream().mapToDouble(Double::doubleValue).min().orElse(0);
                obvNewLow = valid.get(valid.size() - 1) <= min;
            }
        }
        boolean trendKnown = maLatest != null || obvNewLow != null;
        boolean trendOk = aboveMa || Boolean.FALSE.equals(obvNewLow);

        Map<String, Object> support = nearestSupport(price, profile, stock);
        boolean supportOk = support != null && asDouble(support.get("dist")) <= 3;
        boolean confirmOk = bottomDiv != null || recover != null;
        boolean confirmKnown = mfiRes != null;
        int score = (supportOk ? 1 : 0) + (confirmOk ? 1 : 0) + (trendOk ? 1 : 0);

        String text;
        if (score >= 3) {
            text = "可考虑分批补仓";
        } else if (score == 2) {
            text = "小仓试探";
        } else {
            text = "观望";
        }
        map.put("score", score);
        map.put("badge", text);

        List<Map<String, Object>> checks = new ArrayList<>();
        if (support == null) {
            checks.add(check("neutral", "① 到支撑", "—", profile == null ? "筹码 / 重仓价数据不足" : "未找到有效支撑"));
        } else {
            checks.add(check(supportOk ? "ok" : "warn", "① 到支撑",
                    fmt(price) + " · 距" + support.get("label") + " " + fmt1(asDouble(support.get("dist"))) + "%",
                    support.get("label") + " " + fmt(asDouble(support.get("value"))) + "（阈值 3%）"));
        }
        if (!confirmKnown) {
            checks.add(check("neutral", "② 资金确认", "—", "日K 不足"));
        } else if (bottomDiv != null) {
            checks.add(check("ok", "② 资金确认", "MFI " + fmt1(mfi),
                    "MFI 底背离：" + bottomDiv.barsAgo() + " 根前枢轴，指标 +" + fmt1(bottomDiv.indDelta())));
        } else if (recover != null) {
            checks.add(check("ok", "② 资金确认", "MFI " + fmt1(mfi),
                    "MFI " + fmt1(asDouble(recover.get("low"))) + " 后回升上穿 20（"
                            + recover.get("barsAgo") + " 根前）"));
        } else {
            checks.add(check("warn", "② 资金确认", mfi == null ? "—" : "MFI " + fmt1(mfi),
                    "无底背离，也未上穿 20"));
        }
        if (!trendKnown) {
            checks.add(check("neutral", "③ 趋势过滤", "—", "日K 不足"));
        } else {
            checks.add(check(trendOk ? "ok" : "bad", "③ 趋势过滤", trendOk ? "趋势未破" : "趋势偏弱",
                    (maLatest == null ? "MA20 —" : "MA20 " + fmt(maLatest) + "（现价在其" + (aboveMa ? "上方" : "下方") + "）")
                            + " · " + (obvNewLow == null ? "OBV —" : obvNewLow ? "OBV 20 日创新低" : "OBV 未创新低")));
        }
        map.put("checks", checks);

        String hint;
        if (score >= 3) {
            hint = "三项齐备：价格到支撑、资金出现确认、趋势未破。可考虑分批补仓，单次不超过计划仓位的 1/3。";
        } else if (score == 2) {
            hint = "只满足 2/3，小仓试探；等缺失项补齐，不要一次打满。";
        } else {
            hint = "仅满足 " + score + "/3，观望；补仓看日线止跌，不接下跌趋势。";
        }
        map.put("hint", hint + " 辅助参考，不构成投资建议。");

        List<Map<String, Object>> stats = new ArrayList<>();
        stats.add(stat("POC", profile == null ? "—" : fmt(profile.poc())));
        stats.add(stat("价值区下沿", profile == null ? "—" : fmt(profile.val())));
        stats.add(stat("价值区上沿", profile == null ? "—" : fmt(profile.vah())));
        stats.add(stat("MA20", fmt(maLatest)));
        stats.add(stat("日线 MFI", mfi == null ? "—" : fmt1(mfi)));
        stats.add(stat("OBV 20日", obvNewLow == null ? "—" : obvNewLow ? "新低" : "未创新低"));
        stats.add(stat("距支撑", support == null ? "—"
                : support.get("label") + " " + fmt1(asDouble(support.get("dist"))) + "%"));
        stats.add(stat("筹码样本", profile == null ? "—" : profile.count() + " 根"));
        map.put("stats", stats);
        map.put("note", "日 K · " + (profile == null ? bars.size() : profile.count()) + " 根 · 筹码近似");
        return map;
    }

    private static Map<String, Object> check(String tone, String label, String value, String note) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("tone", tone);
        map.put("label", label);
        map.put("value", value);
        map.put("note", note);
        return map;
    }

    private static Map<String, Object> stat(String label, String value) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("label", label);
        map.put("value", value);
        return map;
    }

    private static Map<String, Object> mfiRecovery(List<Double> series) {
        if (series == null || series.size() < 3) {
            return null;
        }
        int n = series.size();
        Double latest = series.get(n - 1);
        if (latest == null || latest < 20) {
            return null;
        }
        int from = Math.max(0, n - 1 - 10);
        for (int i = n - 2; i >= from; i--) {
            Double v = series.get(i);
            if (v != null && v < 20) {
                Map<String, Object> map = new LinkedHashMap<>();
                map.put("barsAgo", n - 1 - i);
                map.put("low", v);
                map.put("latest", latest);
                return map;
            }
        }
        return null;
    }

    private static Map<String, Object> nearestSupport(Double price, TechIndicators.VolumeProfile profile, Stock stock) {
        if (price == null || price <= 0) {
            return null;
        }
        List<Map<String, Object>> candidates = new ArrayList<>();
        if (profile != null) {
            candidates.add(support("POC", profile.poc()));
            candidates.add(support("价值区下沿", profile.val()));
        }
        if (stock != null && stock.getHeavy() != null && stock.getHeavy() > 0) {
            candidates.add(support("重仓价", stock.getHeavy()));
        }
        Map<String, Object> best = null;
        for (Map<String, Object> candidate : candidates) {
            double value = asDouble(candidate.get("value"));
            if (!(value > 0)) {
                continue;
            }
            double dist = Math.abs(price / value - 1) * 100;
            if (best == null || dist < asDouble(best.get("dist"))) {
                candidate.put("dist", dist);
                best = candidate;
            }
        }
        return best;
    }

    private static Map<String, Object> support(String label, double value) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("label", label);
        map.put("value", value);
        return map;
    }

    private Map<String, Object> disciplineView(Stock stock, Map<String, Object> quote, StockDetail detail,
                                               Map<String, Object> history, List<Bar> dailyRaw) {
        Double price = asDouble(quote.get("price"));
        Double pe = asDouble(quote.get("peTtm"));
        if (pe == null) {
            pe = asDouble(quote.get("pe"));
        }
        StockQuote proxy = new StockQuote();
        proxy.setName(stock.getName());
        proxy.setPe(pe);
        proxy.setPb(asDouble(quote.get("pb")));
        proxy.setTotalCap(asDouble(quote.get("totalCap")));
        CrocEvaluator.Eval e = CrocEvaluator.evaluate(stock, proxy);

        List<Map<String, Object>> checks = new ArrayList<>();
        String pbText = fmt1(e.pb());
        Double nav = asDouble(quote.get("navPerShare"));
        Double navGolden = nav != null && nav > 0 ? nav * CrocEvaluator.PB_GOLDEN : null;
        String navText = navGolden == null ? "" : " · 八折价 " + fmt(navGolden);
        if (e.pbGolden()) {
            checks.add(check("ok", "PB / 净资产八折", "PB " + pbText + navText, "PB≤0.8：黄金买点"));
        } else if (e.pbUnder1()) {
            checks.add(check("warn", "PB / 净资产八折", "PB " + pbText + navText, "已破净，但未到八折"));
        } else if (e.pb() != null && e.pb() > 0) {
            checks.add(check("bad", "PB / 净资产八折", "PB " + pbText + navText, "高于八折，安全边际不足"));
        } else {
            checks.add(check("neutral", "PB / 净资产八折", "PB —", "行情源未提供 PB"));
        }

        if (e.cap() != null && e.cap() > 0) {
            checks.add(check(e.smallCap() ? "ok" : "bad", "市值 / 200 亿", fmtYi(e.cap()),
                    e.smallCap() ? "≤200 亿，弹性优先" : ">200 亿，弹性偏小"));
        } else {
            checks.add(check("neutral", "市值 / 200 亿", "—", "行情源未提供总市值"));
        }

        String peTone;
        String peNote;
        if (e.loss()) {
            peTone = "bad";
            peNote = "TTM 亏损，PE 失效，改看 PB";
        } else if (e.pe() != null && e.pe() > 30) {
            peTone = "bad";
            peNote = "30 倍以上算高";
        } else if (e.pe() != null) {
            peTone = "ok";
            peNote = "30 倍以内";
        } else {
            peTone = "neutral";
            peNote = "行情源未提供 PE";
        }
        checks.add(check(peTone, "PE(TTM) / 30 倍", e.pe() == null ? "—" : e.pe() < 0 ? "亏损" : fmt(e.pe()), peNote));

        Double pos52 = asDouble(quote.get("position52"));
        checks.add(check(pos52 == null ? "neutral" : pos52 <= 25 ? "ok" : pos52 >= 75 ? "bad" : "neutral",
                "52 周位置", pos52 == null ? "—" : "分位 " + Math.round(pos52) + "%",
                pos52 == null ? "区间数据缺失" : pos52 <= 25 ? "低位区" : pos52 >= 75 ? "高位区" : "中枢区"));

        Double mPos = asDouble(history.get("pos"));
        checks.add(check(mPos == null ? "neutral" : mPos <= 25 ? "ok" : mPos >= 75 ? "bad" : "neutral",
                "历史分位（月K）", mPos == null ? "—" : Math.round(mPos) + "%",
                history.get("count") == null ? "月K 数据不足"
                        : history.get("count") + " 根月K · 低 " + fmt(asDouble(history.get("lo")))
                        + " / 高 " + fmt(asDouble(history.get("hi")))));

        String zone = e.zone();
        String zoneText = "heavy".equals(zone) ? "重仓区" : "entry".equals(zone) ? "入场区"
                : "above".equals(zone) ? "高于入场" : "—";
        String buyBlock = e.st() ? "ST 风险股，不买" : e.pe() == null ? "盈利数据缺失，暂不判断买点"
                : e.pe() <= 0 ? "亏损股，不买" : null;
        if (stock.getEntry() == null && stock.getHeavy() == null) {
            checks.add(check("neutral", "计划区间", "未设置买点", "入场价与重仓价都为空"));
        } else {
            checks.add(check(buyBlock != null ? "bad" : "heavy".equals(zone) || "entry".equals(zone) ? "ok"
                            : "above".equals(zone) ? "warn" : "neutral",
                    "计划区间", buyBlock != null ? "禁止买入" : zoneText,
                    (stock.getHeavy() == null ? "" : "重仓 " + fmt(stock.getHeavy()) + " · ")
                            + (stock.getEntry() == null ? "" : "入场 " + fmt(stock.getEntry()) + " · ")
                            + (buyBlock == null ? "" : buyBlock)));
        }

        checks.add(check(e.st() ? "bad" : "ok", "ST / 风险警示", e.st() ? "是" : "否",
                e.st() ? "铁律：不买 ST" : "非 ST"));

        CrocEvaluator.LimitUpInfo li = CrocEvaluator.limitUpInfo(dailyRaw, stock.getCode(), e.name());
        String lTone = "neutral";
        String lVal = "—";
        String lNote = dailyRaw == null || dailyRaw.isEmpty() ? "日K 加载中…" : "未复权日K 数据不足";
        if (li != null) {
            lTone = li.count() >= 3 || li.opened() ? "bad" : li.count() == 2 ? "warn" : "ok";
            lVal = li.count() > 0 ? li.count() + " 连板" : "无连板";
            lNote = li.opened() ? "最近交易日涨停打开" : "涨停幅度 " + (int) li.pct() + "%";
        }
        checks.add(check(lTone, "连续涨停", lVal, lNote));

        CrocEvaluator.Screen screen = CrocEvaluator.screen(stock, proxy);
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("checks", checks);
        map.put("passed", screen.passed());
        map.put("total", screen.total());
        map.put("complete", screen.complete());
        map.put("allPass", screen.allPass());
        map.put("limitUp", li == null ? null : Map.of(
                "count", li.count(), "pct", li.pct(), "opened", li.opened(),
                "lastDate", li.lastDate(), "limitPrice", li.limitPrice() == null ? 0 : li.limitPrice()));
        return map;
    }

    private Map<String, Object> scoreView(Stock stock) {
        Map<String, Object> map = new LinkedHashMap<>();
        ResearchReport report = reportRepository.findByCode(stock.getCode()).orElse(null);
        ResearchScoreRecord machine = scoreRepository.findByCode(stock.getCode()).orElse(null);
        if (report != null && report.getScore() != null) {
            Map<String, Object> reportMap = reportScore(report);
            map.put("kind", "report");
            map.put("report", reportMap);
            map.put("machine", machineScore(machine));
            Map<String, Object> primary = new LinkedHashMap<>();
            primary.put("score", report.getScore());
            primary.put("bandLabel", reportBand(report.getScore()));
            primary.put("stale", Boolean.TRUE.equals(reportMap.get("stale")));
            primary.put("source", report.getSource());
            primary.put("date", report.getReportDate() == null ? "" : report.getReportDate().toString());
            map.put("primary", primary);
            return map;
        }
        if (machine == null || machine.getPercent() == null) {
            map.put("kind", "none");
            map.put("message", "暂无评分：该股票既没有收录研报评分，也未纳入机器复算。");
            return map;
        }
        Map<String, Object> machineMap = machineScore(machine);
        map.put("kind", "machine");
        map.put("machine", machineMap);
        map.put("primary", Map.of(
                "score", machine.getPercent(),
                "bandLabel", ResearchScoreCalculator.bandLabel(machine.getBand()),
                "stale", false,
                "complete", Boolean.TRUE.equals(machine.getComplete())));
        map.put("message", "暂无研报总分，按 7 项可复算指标（国资背景 / 扣非增长 / 主营集中 / 市值 / 盘整 / 月线 / 放量）折算成百分制。");
        return map;
    }

    // ==================== 作战台 ====================

    public Map<String, Object> combat() {
        List<Stock> stocks = stockRepository.findAllByOrderBySortOrderAsc();
        Map<String, StockQuote> quotes = quotes();
        List<Map<String, Object>> rows = new ArrayList<>();
        int add = 0;
        int exitTriggered = 0;
        int tracking = 0;
        int cooling = 0;
        int risk = 0;
        int data = 0;
        for (Stock stock : stocks) {
            if (Boolean.FALSE.equals(stock.getPool())) {
                continue;
            }
            Map<String, Object> row = combatRow(stock, quotes.get(stock.getCode()));
            rows.add(row);
            String kind = String.valueOf(((Map<?, ?>) row.get("primary")).get("kind"));
            if ("add-ready".equals(kind) || "add-watch".equals(kind)) {
                add++;
            } else if ("exit".equals(kind)) {
                exitTriggered++;
            } else if ("risk".equals(kind)) {
                risk++;
            } else if ("data".equals(kind)) {
                data++;
            }
            Object exitValue = row.get("exit");
            TradeSignalCalculator.ExitResult exit = exitValue instanceof TradeSignalCalculator.ExitResult result
                    ? result : null;
            if (exit != null && "跟踪中".equals(exit.state())) {
                tracking++;
            }
            if (exit != null && exit.cooldownDays() > 0) {
                cooling++;
            }
        }
        rows.sort(Comparator
                .comparingInt((Map<String, Object> r) -> ((Number) r.get("priority")).intValue())
                .thenComparingInt(r -> ((Number) r.get("statusRank")).intValue())
                .thenComparing(r -> String.valueOf(r.get("statusText")), ZH::compare)
                .thenComparing((Map<String, Object> r) -> (Double) r.get("scoreValue"),
                        Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing((Map<String, Object> r) -> (Double) r.get("gapValue"),
                        Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(r -> String.valueOf(r.get("name")), ZH::compare));

        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("add", add);
        counts.put("exit", exitTriggered);
        counts.put("tracking", tracking);
        counts.put("cooling", cooling);
        counts.put("risk", risk);
        counts.put("data", data);
        counts.put("watch", rows.size() - add - exitTriggered - risk - data);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("rows", rows);
        result.put("counts", counts);
        result.put("total", rows.size());
        result.put("generatedAt", System.currentTimeMillis());
        return result;
    }

    private Map<String, Object> combatRow(Stock stock, StockQuote quote) {
        Double price = quote == null ? null : quote.getPrice();
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("stock", stockView(stock));
        row.put("name", stock.getName());
        row.put("quote", quoteMap(quote, detailRepository.findByCode(stock.getCode()).orElse(null), List.of()));
        row.put("price", price);

        if (price == null || price <= 0) {
            row.put("primary", Map.of("status", "数据不足", "kind", "data",
                    "reasons", List.of("当前行情无有效价格，不使用过期空值推断")));
            row.put("add", null);
            row.put("exit", null);
            row.put("eligible", CrocEvaluator.buyEligibility(stock, quote));
            row.put("inZone", false);
            row.put("entry", stock.getEntry());
            row.put("indicators", null);
            row.put("priority", 6);
            row.put("statusRank", 4);
            row.put("statusText", "数据不足");
            row.put("scoreValue", null);
            row.put("gapValue", null);
            row.put("dataNote", "行情缺失");
            return row;
        }

        List<Bar> bars = klineService.bars(stock.getCode(), "day", "qfq", 120);
        Map<String, Object> indicators = indicators(bars, price);
        CrocEvaluator.Eligibility eligible = CrocEvaluator.buyEligibility(stock, quote);
        boolean inZone = stock.getEntry() != null && stock.getEntry() > 0 && price < stock.getEntry();

        TradeSignalCalculator.AddResult add = inZone
                ? TradeSignalCalculator.evaluateAdd(price, stock.getEntry(), bars) : null;
        TradeSignalCalculator.ExitResult exit = TradeSignalCalculator.evaluateExit(price, bars);

        String kind;
        String status;
        List<String> reasons;
        if ("已触发".equals(exit.state())) {
            kind = "exit";
            status = "触发止盈";
            reasons = exit.reasons().subList(0, Math.min(2, exit.reasons().size()));
        } else if (exit.cooldownDays() > 0) {
            kind = "watch";
            status = "离场冷却中";
            reasons = List.of("止盈已触发 " + exit.barsSinceTrigger() + " 个交易日前，冷却剩余 "
                    + exit.cooldownDays() + " 个交易日", "冷却期内不生成买入信号");
        } else if (!inZone) {
            kind = "watch";
            status = stock.getEntry() != null && stock.getEntry() > 0 ? "高于入场价" : "未配置入场价";
            reasons = List.of(stock.getEntry() != null && stock.getEntry() > 0
                    ? "现价 " + fmt(price) + " ≥ 入场价 " + fmt(stock.getEntry())
                    + "（" + fmt1((price / stock.getEntry() - 1) * 100) + "%），不追高"
                    : "计划未配置入场价，不生成买入信号");
        } else if (add != null && !eligible.eligible()) {
            kind = "risk";
            status = "风险拦截";
            reasons = List.of(eligible.reason() == null ? "未通过买入纪律门槛" : eligible.reason(),
                    "价格到计划区不代表允许买入");
        } else if (add != null && "add-ready".equals(add.kind())) {
            kind = "add-ready";
            status = add.status();
            reasons = add.reasons().subList(0, Math.min(3, add.reasons().size()));
        } else if (add != null && "add-watch".equals(add.kind())) {
            kind = "add-watch";
            status = add.status();
            reasons = add.reasons().subList(0, Math.min(3, add.reasons().size()));
        } else if (add != null && "data".equals(add.kind())) {
            kind = "data";
            status = "数据不足";
            reasons = add.reasons();
        } else {
            kind = "watch";
            status = add == null ? "观望" : add.status();
            reasons = add == null ? List.of("暂无信号") : add.reasons().subList(0, Math.min(2, add.reasons().size()));
        }

        int priority = switch (kind) {
            case "exit" -> 0;
            case "add-ready" -> 1;
            case "add-watch" -> 2;
            default -> "risk".equals(kind) ? 5 : "data".equals(kind) ? 6 : 4;
        };
        int statusRank = status.startsWith("观望") ? 0 : status.startsWith("高于入场价") ? 1
                : status.startsWith("离场冷却") ? 2 : status.startsWith("未配置入场价") ? 3 : 4;
        Double scoreValue = add != null && add.dataReady() && add.inZone() ? (double) add.score() : null;
        Double gapValue = add != null ? add.gapPct() : null;

        row.put("primary", Map.of("status", status, "kind", kind, "reasons", reasons));
        row.put("add", add);
        row.put("exit", exit);
        row.put("eligible", Map.of("eligible", eligible.eligible(), "reason", eligible.reason() == null ? "" : eligible.reason()));
        row.put("inZone", inZone);
        row.put("entry", stock.getEntry());
        row.put("indicators", indicators);
        row.put("priority", priority);
        row.put("statusRank", statusRank);
        row.put("statusText", status);
        row.put("scoreValue", scoreValue);
        row.put("gapValue", gapValue);
        row.put("dataNote", "日K " + (bars.isEmpty() ? "不可用" : bars.size() + " 根")
                + ("数据不足".equals(exit.state()) ? "" : " · 止盈" + exit.state()));
        return row;
    }

    private Map<String, Object> indicators(List<Bar> bars, Double price) {
        if (bars == null || bars.isEmpty()) {
            return null;
        }
        TechIndicators.Series rsi = TechIndicators.rsi(bars, 14);
        TechIndicators.MacdResult macd = TechIndicators.macd(bars, 12, 26, 9);
        TechIndicators.Series mfi = TechIndicators.mfi(bars, 14);
        TechIndicators.Series ma = TechIndicators.ma(bars, 20);
        TechIndicators.Series obv = TechIndicators.obv(bars);

        Double rsiValue = rsi.latest();
        Double rsiPrev = rsi.series().size() > 1 ? rsi.series().get(rsi.series().size() - 2) : null;
        TechIndicators.MacdValue macdValue = macd.latest();
        Double macdPrev = macd.histogram().size() > 1 ? macd.histogram().get(macd.histogram().size() - 2) : null;

        String rsiTrend = rsiValue == null || rsiPrev == null ? "数据不足"
                : rsiValue > rsiPrev ? "回升" : rsiValue < rsiPrev ? "回落" : "持平";
        String rsiState = rsiValue == null ? "数据不足" : rsiValue < 30 ? "超卖区"
                : rsiValue < 45 ? "偏弱" : rsiValue <= 55 ? "中性" : rsiValue < 70 ? "偏强" : "超买区";
        String macdState = macdValue == null ? "数据不足"
                : macdValue.dif() > macdValue.dea()
                ? (macdValue.histogram() >= 0 ? "多头动能" : "偏多改善")
                : (macdPrev != null && macdValue.histogram() > macdPrev ? "空头动能减弱" : "偏空");
        String macdCross = "数据不足";
        if (macdValue != null && macd.dif().size() > 1 && macd.dea().size() > 1) {
            Double dif2 = macd.dif().get(macd.dif().size() - 2);
            Double dea2 = macd.dea().get(macd.dea().size() - 2);
            if (dif2 != null && dea2 != null) {
                macdCross = macdValue.dif() > macdValue.dea() && dif2 <= dea2 ? "金叉"
                        : macdValue.dif() < macdValue.dea() && dif2 >= dea2 ? "死叉" : "未新交叉";
            }
        }
        Double mfiValue = mfi.latest();
        Double ma20 = ma.latest();
        Double obvValue = obv.latest();
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("bars", bars.size());
        map.put("rsi", rsiValue);
        map.put("rsiTrend", rsiTrend);
        map.put("rsiState", rsiState);
        map.put("macd", macdValue == null ? null : Map.of("dif", macdValue.dif(), "dea", macdValue.dea(),
                "histogram", macdValue.histogram()));
        map.put("macdState", macdState);
        map.put("macdCross", macdCross);
        map.put("mfi", mfiValue);
        map.put("ma20", ma20);
        map.put("ma20Relation", ma20 == null || price == null ? "数据不足" : price > ma20 ? "现价在均线上方" : "现价在均线下方");
        map.put("obv", obvValue);
        return map;
    }

    // ==================== 行情页 ====================

    public Map<String, Object> market() {
        List<Stock> stocks = stockRepository.findAllByOrderBySortOrderAsc();
        Map<String, StockQuote> quotes = quotes();
        Map<String, SectorMonthly> sectors = sectors();

        List<Map<String, Object>> indices = new ArrayList<>();
        for (String[] spec : new String[][]{{"sh000001", "上证指数"}, {"sz399001", "深证成指"}, {"sz399006", "创业板指"}}) {
            Map<String, Object> card = new LinkedHashMap<>();
            StockQuote quote = quotes.get(spec[0]);
            card.put("code", spec[0]);
            card.put("name", spec[1]);
            card.put("price", quote == null ? null : quote.getPrice());
            card.put("todayChange", quote == null ? null : quote.getTodayChange());
            card.put("prevClose", quote == null ? null : quote.getPrevClose());
            card.put("monthly", barsView(klineService.bars(spec[0], "month", "none", 12)));
            indices.add(card);
        }

        List<Stock> live = stocks.stream().filter(s -> {
            StockQuote q = quotes.get(s.getCode());
            return q != null && q.getPrice() != null && q.getPrice() > 0;
        }).toList();
        int up = 0;
        int down = 0;
        int zone = 0;
        double sum = 0;
        for (Stock stock : live) {
            StockQuote quote = quotes.get(stock.getCode());
            if (quote.getTodayChange() != null) {
                sum += quote.getTodayChange();
                if (quote.getTodayChange() > 0) {
                    up++;
                } else if (quote.getTodayChange() < 0) {
                    down++;
                }
            }
            String z = CrocEvaluator.evaluate(stock, quote).zone();
            if ("heavy".equals(z) || "entry".equals(z)) {
                zone++;
            }
        }
        Map<String, Object> pulse = new LinkedHashMap<>();
        pulse.put("up", up);
        pulse.put("down", down);
        pulse.put("flat", live.size() - up - down);
        pulse.put("avgChange", live.isEmpty() ? null : sum / live.size());
        pulse.put("zoneCount", zone);
        pulse.put("total", live.size());

        List<Map<String, Object>> groupRows = new ArrayList<>();
        Map<String, List<Stock>> grouped = stocks.stream()
                .collect(Collectors.groupingBy(s -> s.getGroupName() == null ? "未分类" : s.getGroupName(),
                        LinkedHashMap::new, Collectors.toList()));
        for (Map.Entry<String, List<Stock>> entry : grouped.entrySet()) {
            String group = entry.getKey();
            List<Stock> members = entry.getValue();
            int covered = 0;
            int gUp = 0;
            int gDown = 0;
            int zoneCount = 0;
            double sum12 = 0;
            double sum1 = 0;
            double sum3 = 0;
            double sum6 = 0;
            int n1 = 0;
            int n3 = 0;
            int n6 = 0;
            List<Map<String, Object>> leaders = new ArrayList<>();
            for (Stock stock : members) {
                StockQuote quote = quotes.get(stock.getCode());
                if (quote != null && quote.getPrice() != null && quote.getPrice() > 0) {
                    String z = CrocEvaluator.evaluate(stock, quote).zone();
                    if ("heavy".equals(z) || "entry".equals(z)) {
                        zoneCount++;
                    }
                }
                SectorMonthly item = sectors.get(stock.getCode());
                if (item == null) {
                    continue;
                }
                if (item.getM12() != null) {
                    covered++;
                    sum12 += item.getM12();
                    if (item.getM12() > 0) {
                        gUp++;
                    } else if (item.getM12() < 0) {
                        gDown++;
                    }
                    leaders.add(Map.of("code", stock.getCode(), "name", stock.getName(), "change", item.getM12()));
                }
                if (item.getM1() != null) {
                    sum1 += item.getM1();
                    n1++;
                }
                if (item.getM3() != null) {
                    sum3 += item.getM3();
                    n3++;
                }
                if (item.getM6() != null) {
                    sum6 += item.getM6();
                    n6++;
                }
            }
            leaders.sort(Comparator.comparingDouble((Map<String, Object> m) -> asDouble(m.get("change"))).reversed());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", group);
            row.put("count", members.size());
            row.put("covered", covered);
            row.put("avg", covered > 0 ? sum12 / covered : null);
            row.put("avg1", n1 > 0 ? sum1 / n1 : null);
            row.put("avg3", n3 > 0 ? sum3 / n3 : null);
            row.put("avg6", n6 > 0 ? sum6 / n6 : null);
            row.put("up", gUp);
            row.put("down", gDown);
            row.put("zone", zoneCount);
            row.put("leaders", leaders.subList(0, Math.min(3, leaders.size())));
            groupRows.add(row);
        }
        groupRows.sort(Comparator.comparingDouble((Map<String, Object> m) ->
                m.get("avg") == null ? -999 : asDouble(m.get("avg"))).reversed());

        LocalDate marketDate = quotes.values().stream().map(StockQuote::getMarketDate)
                .filter(Objects::nonNull).max(LocalDate::compareTo).orElse(null);
        StockQuote latest = quotes.values().stream()
                .filter(q -> q.getQuoteTime() != null)
                .max(Comparator.comparing(StockQuote::getQuoteTime)).orElse(null);
        int covered = (int) stocks.stream().filter(s -> sectors.containsKey(s.getCode())
                && sectors.get(s.getCode()).getM12() != null).count();

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("marketDate", marketDate == null ? null : marketDate.toString());
        meta.put("quoteUpdatedAt", latest == null || latest.getQuoteTime() == null ? null : latest.getQuoteTime().toString());
        meta.put("stale", marketDate == null || !marketDate.equals(CodeUtils.today()));
        meta.put("sectorCovered", covered);
        meta.put("sectorTotal", stocks.size());
        meta.put("sectorMarketDate", sectors.values().stream().map(SectorMonthly::getMarketDate)
                .filter(Objects::nonNull).max(LocalDate::compareTo).map(LocalDate::toString).orElse(null));
        meta.put("businessUpdatedAt", businessItemRepository.findAllByOrderBySortOrderAsc().stream()
                .map(BusinessItem::getUpdatedAt).filter(Objects::nonNull).max(Comparator.naturalOrder())
                .map(Object::toString).orElse(null));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("indices", indices);
        result.put("pulse", pulse);
        result.put("sectors", groupRows);
        result.put("meta", meta);
        result.put("globalAssets", globalAssets().get("assets"));
        result.put("business", business());
        return result;
    }

    private List<Map<String, Object>> barsView(List<Bar> bars) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Bar bar : bars) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("time", bar.time());
            map.put("open", bar.open());
            map.put("close", bar.close());
            map.put("high", bar.high());
            map.put("low", bar.low());
            map.put("volume", bar.volume());
            out.add(map);
        }
        return out;
    }

    // ==================== 全球资产 / 产业链 ====================

    public Map<String, Object> globalAssets() {
        List<GlobalAsset> list = globalAssetRepository.findAllByOrderBySortOrderAsc();
        List<Map<String, Object>> assets = new ArrayList<>();
        for (GlobalAsset asset : list) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", asset.getAssetId());
            map.put("name", asset.getName());
            map.put("kind", asset.getKind());
            map.put("unit", asset.getUnit());
            map.put("currency", asset.getCurrency());
            map.put("status", asset.getStatus());
            map.put("price", asset.getPrice());
            map.put("prevClose", asset.getPrevClose());
            map.put("change", asset.getChange());
            map.put("changePct", asset.getChangePct());
            map.put("quoteTime", asset.getQuoteTime());
            map.put("sourceSymbol", asset.getSourceSymbol());
            map.put("sourceUrl", asset.getSourceUrl());
            map.put("history", JsonUtils.readList(asset.getHistoryJson()));
            assets.add(map);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("assets", assets);
        result.put("updatedAt", assets.stream().map(a -> (String) a.get("quoteTime"))
                .filter(Objects::nonNull).max(String::compareTo).orElse(null));
        result.put("source", "Yahoo Finance public chart endpoint");
        return result;
    }

    private Map<String, Object> business() {
        List<Map<String, Object>> items = new ArrayList<>();
        for (BusinessItem item : businessItemRepository.findAllByOrderBySortOrderAsc()) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", item.getItemId());
            map.put("name", item.getName());
            map.put("unit", item.getUnit());
            map.put("symbol", item.getSymbol());
            map.put("series", JsonUtils.readList(item.getSeriesJson()));
            map.put("latest", item.getLatest());
            map.put("latestDate", item.getLatestDate() == null ? null : item.getLatestDate().toString());
            map.put("latestSpot", item.getLatestSpot());
            map.put("latestFutures", item.getLatestFutures());
            map.put("futuresDate", item.getFuturesDate() == null ? null : item.getFuturesDate().toString());
            map.put("futuresTime", item.getFuturesTime());
            map.put("futuresSource", item.getFuturesSource());
            map.put("futuresSourceUrl", item.getFuturesSourceUrl());
            map.put("changePct", item.getChangePct());
            map.put("inventory", JsonUtils.readMap(item.getInventoryJson()));
            map.put("monthlyPrices", JsonUtils.readMap(item.getMonthlyPricesJson()));
            map.put("industryLinks", JsonUtils.readMap(item.getIndustryLinksJson()));
            map.put("stocks", JsonUtils.readAnyList(item.getStocksJson()));
            map.put("chain", item.getChain());
            map.put("drivers", item.getDrivers());
            map.put("source", item.getSource());
            map.put("sourceUrl", item.getSourceUrl());
            map.put("status", item.getStatus());
            items.add(map);
        }
        List<Map<String, Object>> costs = new ArrayList<>();
        for (CostInput input : costInputRepository.findAllByOrderBySortOrderAsc()) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", input.getInputId());
            map.put("name", input.getName());
            map.put("unit", input.getUnit());
            map.put("role", input.getRole());
            map.put("relatedProducts", JsonUtils.readAnyList(input.getRelatedProductsJson()));
            map.put("latest", input.getLatest());
            map.put("latestDate", input.getLatestDate() == null ? null : input.getLatestDate().toString());
            map.put("series", JsonUtils.readList(input.getSeriesJson()));
            map.put("monthlyPrices", JsonUtils.readMap(input.getMonthlyPricesJson()));
            map.put("source", input.getSource());
            map.put("sourceUrl", input.getSourceUrl());
            map.put("status", input.getStatus());
            costs.add(map);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("costInputs", costs);
        result.put("updatedAt", items.stream().map(i -> (String) i.get("latestDate"))
                .filter(Objects::nonNull).max(String::compareTo).orElse(null));
        int valid = (int) items.stream().filter(i -> i.get("latest") != null).count();
        result.put("validCount", valid);
        return result;
    }

    // ==================== 公共工具 ====================

    public Map<String, StockQuote> quotes() {
        Map<String, StockQuote> map = new HashMap<>();
        for (StockQuote quote : quoteRepository.findAll()) {
            map.put(quote.getCode(), quote);
        }
        return map;
    }

    public Map<String, ResearchReport> reports() {
        Map<String, ResearchReport> map = new HashMap<>();
        for (ResearchReport report : reportRepository.findAll()) {
            map.put(report.getCode(), report);
        }
        return map;
    }

    public Map<String, ResearchScoreRecord> scores() {
        Map<String, ResearchScoreRecord> map = new HashMap<>();
        for (ResearchScoreRecord score : scoreRepository.findAll()) {
            map.put(score.getCode(), score);
        }
        return map;
    }

    public Map<String, SectorMonthly> sectors() {
        Map<String, SectorMonthly> map = new HashMap<>();
        for (SectorMonthly sector : sectorRepository.findAll()) {
            map.put(sector.getCode(), sector);
        }
        return map;
    }

    public List<Fundamental> fundamentals() {
        return fundamentalRepository.findAll();
    }

    public static int monthsBetween(LocalDate date) {
        if (date == null) {
            return -1;
        }
        LocalDate now = CodeUtils.today();
        return Math.max(0, (now.getYear() - date.getYear()) * 12 + (now.getMonthValue() - date.getMonthValue()));
    }

    public static String reportBand(Double score) {
        if (score == null) {
            return "";
        }
        if (score >= 90) {
            return "绝佳买入机会";
        }
        if (score >= 80) {
            return "稀有买入机会";
        }
        if (score >= 70) {
            return "合理买入机会";
        }
        return "等待区间";
    }

    public static Double asDouble(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String fmt(Double value) {
        return value == null ? "—" : String.format(Locale.ROOT, "%.2f", value);
    }

    private static String fmt1(Double value) {
        return value == null ? "—" : String.format(Locale.ROOT, "%.1f", value);
    }

    private static String fmtYi(Double value) {
        return value == null ? "—" : String.format(Locale.ROOT, "%.2f亿", value / 1e8);
    }
}

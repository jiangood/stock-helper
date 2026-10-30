package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.Fundamental;
import com.jiangood.stockhelper.domain.ResearchScoreRecord;
import com.jiangood.stockhelper.domain.SectorMonthly;
import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.domain.StockDetail;
import com.jiangood.stockhelper.domain.StockQuote;
import com.jiangood.stockhelper.indicator.Bar;
import com.jiangood.stockhelper.indicator.ResearchScoreCalculator;
import com.jiangood.stockhelper.repository.FundamentalRepository;
import com.jiangood.stockhelper.repository.ResearchScoreRecordRepository;
import com.jiangood.stockhelper.repository.SectorMonthlyRepository;
import com.jiangood.stockhelper.repository.StockDetailRepository;
import com.jiangood.stockhelper.repository.StockQuoteRepository;
import com.jiangood.stockhelper.repository.StockRepository;
import com.jiangood.stockhelper.support.CodeUtils;
import com.jiangood.stockhelper.support.JsonUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

/**
 * 从 K 线与基本面重建派生读模型：机器评分与板块月线强弱。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ScoreRebuildService {

    private final StockRepository stockRepository;
    private final StockQuoteRepository quoteRepository;
    private final StockDetailRepository detailRepository;
    private final FundamentalRepository fundamentalRepository;
    private final ResearchScoreRecordRepository scoreRepository;
    private final SectorMonthlyRepository sectorRepository;
    private final KlineService klineService;

    @Transactional
    public Map<String, Object> rebuild() {
        List<Stock> stocks = stockRepository.findAllByOrderBySortOrderAsc();
        LocalDate marketDate = quoteRepository.findAll().stream().map(StockQuote::getMarketDate)
                .filter(Objects::nonNull).max(LocalDate::compareTo).orElse(CodeUtils.today());
        Map<String, StockQuote> quotes = new LinkedHashMap<>();
        quoteRepository.findAll().forEach(q -> quotes.put(q.getCode(), q));
        Map<String, StockDetail> details = new LinkedHashMap<>();
        detailRepository.findAll().forEach(d -> details.put(d.getCode(), d));
        Map<String, Fundamental> fundamentals = new LinkedHashMap<>();
        fundamentalRepository.findAll().forEach(f -> fundamentals.put(f.getCode(), f));

        int scored = 0;
        int sectorCount = 0;
        for (Stock stock : stocks) {
            List<Bar> daily = klineService.bars(stock.getCode(), "day", "qfq");
            List<Bar> weekly = klineService.bars(stock.getCode(), "week", "qfq");
            List<Bar> monthly = klineService.bars(stock.getCode(), "month", "qfq");
            StockDetail detail = details.get(stock.getCode());
            StockQuote quote = quotes.get(stock.getCode());
            Fundamental fund = fundamentals.get(stock.getCode());

            Double cap = detail != null && detail.getTotalCap() != null ? detail.getTotalCap()
                    : quote == null ? null : quote.getTotalCap();
            Double price = detail != null && detail.getPrice() != null ? detail.getPrice()
                    : quote == null ? null : quote.getPrice();
            Double high52 = detail == null ? null : detail.getHigh52();
            Double low52 = detail == null ? null : detail.getLow52();

            List<ResearchScoreCalculator.Annual> annual = new ArrayList<>();
            if (fund != null && fund.getAnnualJson() != null) {
                for (Map<String, Object> item : JsonUtils.readList(fund.getAnnualJson())) {
                    annual.add(new ResearchScoreCalculator.Annual(
                            item.get("date") == null ? null : String.valueOf(item.get("date")),
                            StockDataService.asDouble(item.get("yoy")),
                            StockDataService.asDouble(item.get("value"))));
                }
            }
            ResearchScoreCalculator.Result result = ResearchScoreCalculator.compute(
                    new ResearchScoreCalculator.Input(cap, monthly, weekly, daily, price, high52, low52,
                            fund == null ? null : fund.getOwnerType(), fund == null ? null : fund.getMainRatio(),
                            annual, null));
            if (result.points() == null) {
                continue;
            }
            ResearchScoreRecord record = scoreRepository.findByCode(stock.getCode())
                    .orElseGet(ResearchScoreRecord::new);
            record.setCode(stock.getCode());
            record.setPoints(result.points());
            record.setMax(result.max());
            record.setPercent(result.percent());
            record.setComplete(result.complete());
            record.setBand(result.band());
            record.setItemsJson(JsonUtils.write(roundItems(result.items())));
            Map<String, Object> metrics = new LinkedHashMap<>(result.metrics());
            if (fund != null) {
                metrics.put("owner", fund.getOwner());
                metrics.put("mainItem", fund.getMainItem());
            }
            record.setMetricsJson(JsonUtils.write(metrics));
            record.setScoreDate(marketDate);
            scoreRepository.save(record);
            scored++;

            Map<String, Object> sector = monthlyReturns(stock.getCode(), monthly, daily, marketDate);
            if (sector != null) {
                SectorMonthly item = sectorRepository.findByCode(stock.getCode()).orElseGet(SectorMonthly::new);
                item.setCode(stock.getCode());
                item.setSource((String) sector.get("source"));
                item.setMonthKey((String) sector.get("month"));
                item.setClose((Double) sector.get("close"));
                item.setM1((Double) sector.get("m1"));
                item.setM3((Double) sector.get("m3"));
                item.setM6((Double) sector.get("m6"));
                item.setM12((Double) sector.get("m12"));
                item.setMonths((Integer) sector.get("months"));
                item.setMarketDate(marketDate);
                sectorRepository.save(item);
                sectorCount++;
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("scored", scored);
        out.put("sectors", sectorCount);
        out.put("marketDate", marketDate.toString());
        return out;
    }

    private Map<String, Double> roundItems(Map<String, Double> items) {
        Map<String, Double> out = new LinkedHashMap<>();
        items.forEach((key, value) -> out.put(key, value == null ? null : Math.round(value * 10) / 10.0));
        return out;
    }

    /**
     * 月线涨跌幅：优先月 K，缺失时用日 K 聚合；m1 为相对上月末，非自然月收益。
     */
    private Map<String, Object> monthlyReturns(String code, List<Bar> monthly, List<Bar> daily,
                                               LocalDate marketDate) {
        TreeMap<String, Double> byMonth = new TreeMap<>();
        for (Bar bar : monthly) {
            if (bar.time() != null && bar.time().length() >= 7 && bar.close() != null && bar.close() > 0) {
                byMonth.put(bar.time().substring(0, 7), bar.close());
            }
        }
        String marketMonth = marketDate == null ? "" : marketDate.toString().substring(0, 7);
        String source = "monthly";
        if (byMonth.isEmpty() || (!marketMonth.isBlank()
                && byMonth.lastKey().compareTo(marketMonth) < 0)) {
            byMonth.clear();
            for (Bar bar : daily) {
                if (bar.time() != null && bar.time().length() >= 7 && bar.close() != null && bar.close() > 0) {
                    byMonth.put(bar.time().substring(0, 7), bar.close());
                }
            }
            source = "daily";
        }
        if (byMonth.size() < 2) {
            return null;
        }
        String lastMonth = byMonth.lastKey();
        double lastClose = byMonth.get(lastMonth);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", source);
        out.put("month", lastMonth);
        out.put("close", round(lastClose));
        out.put("m1", pct(byMonth, lastMonth, 1));
        out.put("m3", pct(byMonth, lastMonth, 3));
        out.put("m6", pct(byMonth, lastMonth, 6));
        out.put("m12", pct(byMonth, lastMonth, 12));
        out.put("months", byMonth.size());
        return out;
    }

    private static Double pct(TreeMap<String, Double> byMonth, String lastMonth, int monthsBack) {
        String baseMonth = shiftMonth(lastMonth, -monthsBack);
        Double base = baseMonth == null ? null : byMonth.get(baseMonth);
        if (base == null || base <= 0) {
            return null;
        }
        return round((byMonth.get(lastMonth) / base - 1) * 100);
    }

    private static String shiftMonth(String key, int delta) {
        if (key == null || !key.matches("^\\d{4}-\\d{2}$")) {
            return null;
        }
        int year = Integer.parseInt(key.substring(0, 4));
        int month = Integer.parseInt(key.substring(5, 7));
        int total = year * 12 + (month - 1) + delta;
        return String.format("%04d-%02d", total / 12, total % 12 + 1);
    }

    private static Double round(double value) {
        return Math.round(value * 100) / 100.0;
    }
}

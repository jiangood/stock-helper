package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.domain.StockDetail;
import com.jiangood.stockhelper.domain.StockKline;
import com.jiangood.stockhelper.domain.StockQuote;
import com.jiangood.stockhelper.repository.StockDetailRepository;
import com.jiangood.stockhelper.repository.StockKlineRepository;
import com.jiangood.stockhelper.repository.StockQuoteRepository;
import com.jiangood.stockhelper.repository.StockRepository;
import com.jiangood.stockhelper.support.CodeUtils;
import com.jiangood.stockhelper.sync.QuoteFetcher;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 收盘后采集股票池与指数行情、个股详情、日/周/月 K 线，并重建派生评分。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class QuoteSyncService {

    public static final List<String> INDEX_CODES = List.of("sh000001", "sz399001", "sz399006");

    private final StockRepository stockRepository;
    private final StockQuoteRepository quoteRepository;
    private final StockDetailRepository detailRepository;
    private final StockKlineRepository klineRepository;
    private final QuoteFetcher fetcher;
    private final ScoreRebuildService scoreRebuildService;
    private final SyncLogService syncLogService;

    public Map<String, Object> sync(boolean manual) {
        if (!manual && shouldSkip()) {
            return Map.of("skipped", true, "message", "周末或 A 股收盘前，保留现有行情缓存");
        }
        var syncLog = syncLogService.start("quotes", manual ? "manual" : "schedule");
        try {
            List<Stock> stocks = stockRepository.findAllByOrderBySortOrderAsc();
            if (stocks.isEmpty()) {
                throw new IllegalStateException("股票池为空");
            }
            List<String> codes = stocks.stream().map(Stock::getCode).filter(c -> c != null).distinct().toList();
            List<String> allCodes = new ArrayList<>(codes);
            INDEX_CODES.forEach(c -> {
                if (!allCodes.contains(c)) {
                    allCodes.add(c);
                }
            });

            Map<String, QuoteFetcher.Quote> fresh = fetcher.fetchQuotes(allCodes);
            long freshStock = codes.stream().filter(c -> fresh.get(c) != null
                    && fresh.get(c).price() != null && fresh.get(c).price() > 0).count();
            double coverage = freshStock / (double) Math.max(1, codes.size());
            if (freshStock == 0) {
                throw new IllegalStateException("所有行情源均不可用，保留现有缓存");
            }
            if (coverage < 0.8 && quoteRepository.count() == 0) {
                throw new IllegalStateException("首次行情覆盖率仅 " + Math.round(coverage * 100) + "%，拒绝发布不完整快照");
            }

            // 先写入有效行情，失败代码保留上一次有效值
            for (Map.Entry<String, QuoteFetcher.Quote> entry : fresh.entrySet()) {
                saveQuote(entry.getValue());
            }

            Map<String, StockDetail> details = new LinkedHashMap<>();
            Map<String, QuoteFetcher.KlineResult> dailyAdjusted = new LinkedHashMap<>();
            Map<String, QuoteFetcher.KlineResult> dailyRaw = new LinkedHashMap<>();
            Map<String, QuoteFetcher.KlineResult> weekly = new LinkedHashMap<>();
            Map<String, QuoteFetcher.KlineResult> monthly = new LinkedHashMap<>();

            AtomicInteger done = new AtomicInteger();
            ExecutorService pool = Executors.newFixedThreadPool(4);
            try {
                List<Future<?>> futures = new ArrayList<>();
                for (String code : codes) {
                    futures.add(pool.submit(() -> {
                        try {
                            QuoteFetcher.Detail detail = fetcher.fetchDetail(code);
                            if (detail != null && detail.price() != null && detail.price() > 0) {
                                synchronized (details) {
                                    details.put(code, toDetail(detail));
                                }
                            }
                            QuoteFetcher.KlineResult dayQfq = fetcher.fetchKline(code, "day", 250, "qfq");
                            QuoteFetcher.KlineResult dayRaw = fetcher.fetchKline(code, "day", 250, "none");
                            QuoteFetcher.KlineResult weekQfq = fetcher.fetchKline(code, "week", 200, "qfq");
                            QuoteFetcher.KlineResult monthQfq = fetcher.fetchKline(code, "month", 240, "qfq");
                            synchronized (dailyAdjusted) {
                                if (valid(dayQfq, 10)) {
                                    dailyAdjusted.put(code, dayQfq);
                                }
                                if (valid(dayRaw, 10)) {
                                    dailyRaw.put(code, dayRaw);
                                }
                                if (valid(weekQfq, 6)) {
                                    weekly.put(code, weekQfq);
                                }
                                if (valid(monthQfq, 6)) {
                                    monthly.put(code, monthQfq);
                                }
                            }
                        } finally {
                            int n = done.incrementAndGet();
                            if (n % 10 == 0) {
                                log.info("行情详情采集进度 {}/{}", n, codes.size());
                            }
                        }
                        return null;
                    }));
                }
                for (Future<?> future : futures) {
                    try {
                        future.get();
                    } catch (Exception e) {
                        log.warn("单只股票采集失败：{}", e.getMessage());
                    }
                }
            } finally {
                pool.shutdown();
            }

            details.values().forEach(this::saveDetail);
            dailyAdjusted.forEach((code, result) -> saveKline(code, "day", "qfq", result.bars()));
            dailyRaw.forEach((code, result) -> saveKline(code, "day", "none", result.bars()));
            weekly.forEach((code, result) -> saveKline(code, "week", "qfq", result.bars()));
            monthly.forEach((code, result) -> saveKline(code, "month", "qfq", result.bars()));

            // 指数月线用于行情卡片
            for (String indexCode : INDEX_CODES) {
                QuoteFetcher.KlineResult result = fetcher.fetchKline(indexCode, "month", 24, "none");
                if (valid(result, 6)) {
                    saveKline(indexCode, "month", "none", result.bars());
                }
            }

            // 用详情中的报价日修正行情日
            LocalDate marketDate = details.values().stream().map(StockDetail::getQuoteTime)
                    .filter(java.util.Objects::nonNull).map(CodeUtils::chinaDate)
                    .filter(java.util.Objects::nonNull).max(LocalDate::compareTo).orElse(CodeUtils.today());
            for (StockQuote quote : quoteRepository.findAll()) {
                quote.setMarketDate(marketDate);
                quoteRepository.save(quote);
            }

            Map<String, Object> rebuild = scoreRebuildService.rebuild();

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("coverage", Math.round(coverage * 100));
            result.put("details", details.size());
            result.put("daily", dailyAdjusted.size());
            result.put("weekly", weekly.size());
            result.put("monthly", monthly.size());
            result.put("marketDate", marketDate.toString());
            result.put("rebuild", rebuild);
            syncLogService.finish(syncLog, true, "行情采集完成：覆盖率 " + Math.round(coverage * 100) + "%，行情日 "
                    + marketDate + "，评分 " + rebuild.get("scored") + " 只");
            return result;
        } catch (Exception e) {
            log.error("行情采集失败", e);
            syncLogService.finish(syncLog, false, e.getMessage());
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    private boolean shouldSkip() {
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now(CodeUtils.CHINA);
        int day = now.getDayOfWeek().getValue();
        if (day >= 6) {
            return true;
        }
        return now.toLocalTime().isBefore(LocalTime.of(15, 15));
    }

    private boolean valid(QuoteFetcher.KlineResult result, int min) {
        return result != null && result.bars() != null && result.bars().size() >= min
                && result.bars().stream().allMatch(b -> b.open() != null && b.open() > 0
                && b.close() != null && b.close() > 0 && b.high() != null && b.high() > 0
                && b.low() != null && b.low() > 0);
    }

    private void saveQuote(QuoteFetcher.Quote quote) {
        if (quote == null || quote.code() == null || quote.price() == null || quote.price() <= 0) {
            return;
        }
        StockQuote entity = quoteRepository.findByCode(quote.code()).orElseGet(StockQuote::new);
        entity.setCode(quote.code());
        entity.setName(quote.name());
        entity.setPrice(quote.price());
        entity.setPrevClose(quote.prevClose());
        entity.setChange(quote.change());
        entity.setTodayChange(quote.todayChange());
        entity.setPe(quote.pe());
        entity.setPb(quote.pb());
        entity.setTotalCap(quote.totalCap());
        entity.setFloatCap(quote.floatCap());
        entity.setDivYield(quote.divYield());
        entity.setQuoteTime(quote.quoteTime());
        entity.setMarketDate(CodeUtils.chinaDate(quote.quoteTime()));
        quoteRepository.save(entity);
    }

    private StockDetail toDetail(QuoteFetcher.Detail d) {
        StockDetail e = new StockDetail();
        e.setCode(d.code());
        e.setName(d.name());
        e.setPrice(d.price());
        e.setPrevClose(d.prevClose());
        e.setChange(d.change());
        e.setTodayChange(d.todayChange());
        e.setOpen(d.open());
        e.setHigh(d.high());
        e.setLow(d.low());
        e.setAvg(d.avg());
        e.setVolume(d.volume());
        e.setAmount(d.amount());
        e.setTurnover(d.turnover());
        e.setVolumeRatio(d.volumeRatio());
        e.setAmplitude(d.amplitude());
        e.setLimitUp(d.limitUp());
        e.setLimitDown(d.limitDown());
        e.setPe(d.pe());
        e.setPeStatic(d.peStatic());
        e.setPeTtm(d.peTtm());
        e.setPb(d.pb());
        e.setRoe(d.roe());
        e.setGrossMargin(d.grossMargin());
        e.setNetMargin(d.netMargin());
        e.setRevenue(d.revenue());
        e.setRevenueYoY(d.revenueYoY());
        e.setProfit(d.profit());
        e.setProfitYoY(d.profitYoY());
        e.setNavPerShare(d.navPerShare());
        e.setHigh52(d.high52());
        e.setLow52(d.low52());
        e.setListedAt(d.listedAt());
        e.setBoard(d.board());
        e.setTotalShares(d.totalShares());
        e.setFloatShares(d.floatShares());
        e.setTotalCap(d.totalCap());
        e.setFloatCap(d.floatCap());
        e.setQuoteTime(d.quoteTime());
        return e;
    }

    private void saveDetail(StockDetail detail) {
        if (detail == null || detail.getCode() == null) {
            return;
        }
        StockDetail target = detailRepository.findByCode(detail.getCode()).orElseGet(StockDetail::new);
        target.setCode(detail.getCode());
        target.setName(detail.getName());
        target.setPrice(detail.getPrice());
        target.setPrevClose(detail.getPrevClose());
        target.setChange(detail.getChange());
        target.setTodayChange(detail.getTodayChange());
        target.setOpen(detail.getOpen());
        target.setHigh(detail.getHigh());
        target.setLow(detail.getLow());
        target.setAvg(detail.getAvg());
        target.setVolume(detail.getVolume());
        target.setAmount(detail.getAmount());
        target.setTurnover(detail.getTurnover());
        target.setVolumeRatio(detail.getVolumeRatio());
        target.setAmplitude(detail.getAmplitude());
        target.setLimitUp(detail.getLimitUp());
        target.setLimitDown(detail.getLimitDown());
        target.setPe(detail.getPe());
        target.setPeStatic(detail.getPeStatic());
        target.setPeTtm(detail.getPeTtm());
        target.setPb(detail.getPb());
        target.setRoe(detail.getRoe());
        target.setGrossMargin(detail.getGrossMargin());
        target.setNetMargin(detail.getNetMargin());
        target.setRevenue(detail.getRevenue());
        target.setRevenueYoY(detail.getRevenueYoY());
        target.setProfit(detail.getProfit());
        target.setProfitYoY(detail.getProfitYoY());
        target.setNavPerShare(detail.getNavPerShare());
        target.setHigh52(detail.getHigh52());
        target.setLow52(detail.getLow52());
        target.setListedAt(detail.getListedAt());
        target.setBoard(detail.getBoard());
        target.setTotalShares(detail.getTotalShares());
        target.setFloatShares(detail.getFloatShares());
        target.setTotalCap(detail.getTotalCap());
        target.setFloatCap(detail.getFloatCap());
        target.setQuoteTime(detail.getQuoteTime());
        detailRepository.save(target);
    }

    private void saveKline(String code, String period, String adjust, List<QuoteFetcher.BarRow> bars) {
        klineRepository.deleteByCodeAndPeriodAndAdjust(code, period, adjust);
        List<StockKline> rows = new ArrayList<>();
        Set<LocalDate> seen = new HashSet<>();
        for (QuoteFetcher.BarRow bar : bars) {
            LocalDate date;
            try {
                date = LocalDate.parse(bar.time());
            } catch (Exception e) {
                continue;
            }
            if (!seen.add(date)) {
                continue;
            }
            StockKline kline = new StockKline();
            kline.setCode(code);
            kline.setPeriod(period);
            kline.setAdjust(adjust);
            kline.setTradeDate(date);
            kline.setOpen(bar.open());
            kline.setHigh(bar.high());
            kline.setLow(bar.low());
            kline.setClose(bar.close());
            kline.setVolume(bar.volume());
            rows.add(kline);
        }
        if (!rows.isEmpty()) {
            klineRepository.saveAll(rows);
        }
    }
}

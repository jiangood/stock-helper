package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.Fundamental;
import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.repository.FundamentalRepository;
import com.jiangood.stockhelper.repository.StockRepository;
import com.jiangood.stockhelper.support.JsonUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * 东方财富 F10：实际控制人 / 主营构成 / 扣非净利年报。
 * 单个请求失败时保留上一次有效值，不写入推测数据。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FundamentalSyncService {

    private static final String SURVEY_URL =
            "https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=";
    private static final String BUSINESS_URL =
            "https://emweb.securities.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax?code=";
    private static final String FINANCE_URL =
            "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_GINCOME"
                    + "&columns=REPORT_DATE,REPORT_DATE_NAME,DEDUCT_PARENT_NETPROFIT,DEDUCT_PARENT_NETPROFIT_YOY"
                    + "&filter=(SECUCODE%3D%22{code}%22)&pageSize=24&sortColumns=REPORT_DATE&sortTypes=-1";

    private static final List<String> PROVINCES = List.of(
            "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江",
            "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州",
            "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏", "宁夏", "新疆");

    private static final Map<String, String> OWNER_OVERRIDES = Map.of(
            "华鲁控股集团有限公司", "province",
            "陕西有色金属控股集团有限责任公司", "province",
            "上海地产(集团)有限公司", "province",
            "新疆生产建设兵团国有资产经营有限责任公司", "province",
            "中粮集团有限公司", "central",
            "鞍钢集团有限公司", "central",
            "中国化工集团有限公司", "central",
            "中国化学工程集团有限公司", "central");

    private final StockRepository stockRepository;
    private final FundamentalRepository fundamentalRepository;
    private final ScoreRebuildService scoreRebuildService;
    private final SyncLogService syncLogService;

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public Map<String, Object> sync(boolean manual) {
        var syncLog = syncLogService.start("fundamentals", manual ? "manual" : "schedule");
        try {
            List<Stock> stocks = stockRepository.findAllByOrderBySortOrderAsc();
            ExecutorService pool = Executors.newFixedThreadPool(4);
            List<Future<?>> futures = new ArrayList<>();
            int[] failures = {0};
            for (Stock stock : stocks) {
                futures.add(pool.submit(() -> {
                    try {
                        refresh(stock);
                    } catch (Exception e) {
                        synchronized (failures) {
                            failures[0]++;
                        }
                        log.warn("{} 基本面刷新失败：{}", stock.getCode(), e.getMessage());
                    }
                }));
            }
            for (Future<?> future : futures) {
                try {
                    future.get();
                } catch (Exception ignored) {
                    // 单个失败已记录，继续处理其他股票
                }
            }
            pool.shutdown();

            Map<String, Object> rebuild = scoreRebuildService.rebuild();
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("stocks", stocks.size());
            result.put("failures", failures[0]);
            result.put("rebuild", rebuild);
            syncLogService.finish(syncLog, true, "基本面刷新完成：" + stocks.size() + " 只，失败 "
                    + failures[0] + " 只；重算评分 " + rebuild.get("scored") + " 只");
            return result;
        } catch (Exception e) {
            log.error("基本面刷新失败", e);
            syncLogService.finish(syncLog, false, e.getMessage());
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    private void refresh(Stock stock) throws Exception {
        Fundamental item = fundamentalRepository.findByCode(stock.getCode()).orElseGet(Fundamental::new);
        item.setCode(stock.getCode());
        item.setName(stock.getName());
        boolean changed = false;

        String upper = stock.getCode().substring(2).toUpperCase() + "."
                + stock.getCode().substring(0, 2).toUpperCase();
        try {
            JsonNode survey = getJson(SURVEY_URL + stock.getCode().toUpperCase());
            JsonNode rows = survey.path("sjkzr");
            if (rows.isArray() && !rows.isEmpty()) {
                String owner = text(rows.get(0), "HOLDER_NAME");
                item.setOwner(owner);
                item.setOwnerType(ownerType(owner));
                changed = true;
            }
        } catch (Exception e) {
            log.debug("{} 实控人获取失败：{}", stock.getCode(), e.getMessage());
        }

        try {
            JsonNode business = getJson(BUSINESS_URL + stock.getCode().toUpperCase());
            JsonNode rows = business.path("zygcfx");
            if (rows.isArray() && !rows.isEmpty()) {
                String latest = null;
                for (JsonNode row : rows) {
                    String date = text(row, "REPORT_DATE");
                    if (date != null && (latest == null || date.compareTo(latest) > 0)) {
                        latest = date;
                    }
                }
                if (latest != null) {
                    JsonNode top = null;
                    double topRatio = 0;
                    boolean hasProduct = false;
                    for (JsonNode row : rows) {
                        if (!latest.equals(text(row, "REPORT_DATE"))) {
                            continue;
                        }
                        if ("2".equals(text(row, "MAINOP_TYPE"))) {
                            hasProduct = true;
                            double ratio = dbl(row, "MBI_RATIO") == null ? 0 : dbl(row, "MBI_RATIO");
                            if (top == null || ratio > topRatio) {
                                top = row;
                                topRatio = ratio;
                            }
                        }
                    }
                    if (top == null) {
                        for (JsonNode row : rows) {
                            if (!latest.equals(text(row, "REPORT_DATE"))) {
                                continue;
                            }
                            double ratio = dbl(row, "MBI_RATIO") == null ? 0 : dbl(row, "MBI_RATIO");
                            if (top == null || ratio > topRatio) {
                                top = row;
                                topRatio = ratio;
                            }
                        }
                    }
                    if (top != null) {
                        item.setMainItem(text(top, "ITEM_NAME"));
                        item.setMainRatio(Math.round(topRatio * 10000) / 10000.0);
                        item.setMainBasis(hasProduct ? "product" : "industry");
                        item.setMainDate(LocalDate.parse(latest.substring(0, 10)));
                        changed = true;
                    }
                }
            }
        } catch (Exception e) {
            log.debug("{} 主营构成获取失败：{}", stock.getCode(), e.getMessage());
        }

        try {
            JsonNode finance = getJson(FINANCE_URL.replace("{code}", upper));
            JsonNode data = finance.path("result").path("data");
            if (data.isArray()) {
                List<Map<String, Object>> annual = new ArrayList<>();
                for (JsonNode row : data) {
                    String date = text(row, "REPORT_DATE");
                    if (date == null || date.length() < 10 || !date.substring(0, 10).endsWith("12-31")) {
                        continue;
                    }
                    Double yoy = dbl(row, "DEDUCT_PARENT_NETPROFIT_YOY");
                    Double value = dbl(row, "DEDUCT_PARENT_NETPROFIT");
                    if (yoy == null && value == null) {
                        continue;
                    }
                    Map<String, Object> point = new LinkedHashMap<>();
                    point.put("date", date.substring(0, 10));
                    point.put("yoy", yoy == null ? null : Math.round(yoy * 100) / 100.0);
                    point.put("value", value == null ? null : Math.round(value * 100) / 100.0);
                    annual.add(point);
                    if (annual.size() >= 6) {
                        break;
                    }
                }
                if (!annual.isEmpty()) {
                    item.setAnnualJson(JsonUtils.write(annual));
                    changed = true;
                }
            }
        } catch (Exception e) {
            log.debug("{} 扣非净利获取失败：{}", stock.getCode(), e.getMessage());
        }

        if (changed) {
            fundamentalRepository.save(item);
        }
    }

    static String ownerType(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        String text = name.replace(" ", "");
        String override = OWNER_OVERRIDES.get(text);
        if (override != null) {
            return override;
        }
        if (text.contains("国务院国有资产监督管理委员会") || text.contains("中华人民共和国财政部")) {
            return "central";
        }
        if (text.contains("中央") && (text.contains("企业") || text.contains("集团"))) {
            return "central";
        }
        if (text.startsWith("中国") || (text.length() >= 4 && text.substring(0, 4).contains("中国"))) {
            return "central";
        }
        if (text.contains("兵团")) {
            return "province";
        }
        if (text.contains("自治区") || text.contains("省")) {
            return "province";
        }
        for (String province : PROVINCES) {
            if (text.startsWith(province) && (text.contains("国资") || text.contains("财政")
                    || text.contains("人民政府") || text.contains("集团") || text.contains("控股"))) {
                return "province";
            }
        }
        if (text.contains("市") || text.contains("县") || text.contains("区")) {
            return "city";
        }
        if (text.contains("国资") || text.contains("财政")) {
            return "city";
        }
        return "other";
    }

    private JsonNode getJson(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20))
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        + "(KHTML, like Gecko) Chrome/124 Safari/537.36")
                .header("Referer", "https://emweb.securities.eastmoney.com/")
                .header("Accept", "application/json, text/plain, */*")
                .GET().build();
        HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("HTTP " + response.statusCode());
        }
        return JsonUtils.mapper().readTree(new String(response.body(), StandardCharsets.UTF_8));
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
}

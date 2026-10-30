package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.BusinessItem;
import com.jiangood.stockhelper.domain.CostInput;
import com.jiangood.stockhelper.repository.BusinessItemRepository;
import com.jiangood.stockhelper.repository.CostInputRepository;
import com.jiangood.stockhelper.support.CodeUtils;
import com.jiangood.stockhelper.support.JsonUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 产业链商品行情：
 * · 生意社现货/期货基差（100ppi）——纯碱、尿素、甲醇、电解铝、天然橡胶
 * · 东方财富现货与股票——产业链企业、近月价格快照、钛白粉/煤炭/稀土最新报价
 * · 东方财富期货库存——交易所仓单库存（非全行业库存）
 * 任一来源失败时保留上一次有效值，不生成模拟数据。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BusinessSyncService {

    private static final String SPOT_STOCK_URL = "https://data.eastmoney.com/ifdata/xhgp.html";
    private static final String SPOT_STOCK_SOURCE = "东方财富现货与股票数据";
    private static final String SPOT_STOCK_SOURCE_URL = "https://data.eastmoney.com/ifdata/xhgp.html";
    private static final String INVENTORY_SOURCE = "东方财富期货库存数据";
    private static final String INVENTORY_SOURCE_URL = "https://data.eastmoney.com/ifdata/kcsj.html";

    private record Product(String id, String name, String unit, String symbol, List<String> aliases,
                           List<String> stocks, String chain, String drivers, boolean core) {
    }

    private record CostMeta(String id, String name, String unit, List<String> aliases,
                            List<String> relatedProducts, String role) {
    }

    private static final List<Product> PRODUCTS = List.of(
            new Product("soda-ash", "纯碱", "元/吨", "SA", List.of("纯碱", "SA"),
                    List.of("双环科技", "中盐化工", "三友化工"),
                    "玻璃、光伏玻璃、日用玻璃、硅酸钠",
                    "重点看厂家库存、开工率、检修与新增产能；同时跟踪煤炭、合成氨成本。", true),
            new Product("urea", "尿素", "元/吨", "UR", List.of("尿素", "UR"),
                    List.of("四川美丰"), "煤头/气头生产 → 农业与工业需求",
                    "看农业需求季节性、出口政策、日产量、企业库存和煤气成本。", true),
            new Product("methanol", "甲醇", "元/吨", "MA", List.of("甲醇MA", "甲醇", "MA"),
                    List.of("双环科技"), "煤/天然气 → 甲醇 → 烯烃、甲醛等",
                    "看煤价、天然气、港口库存、装置检修和下游利润；公司实际业务暴露需核实。", true),
            new Product("tio2", "钛白粉", "元/吨", null, List.of("钛白粉", "金红石型钛白粉"),
                    List.of("安纳达"), "钛矿/硫酸 → 钛白粉 → 涂料、塑料、造纸",
                    "看钛矿和硫酸成本、行业开工率、出口、库存及企业调价。", false),
            new Product("aluminium", "电解铝", "元/吨", "AL", List.of("铝", "电解铝", "AL"),
                    List.of("中国铝业"), "氧化铝/电力 → 电解铝 → 加工材",
                    "看铝价与氧化铝、电力成本价差，关注产能约束、库存和下游需求。", true),
            new Product("coal", "煤炭", "元/吨", null, List.of("动力煤", "焦煤", "煤炭", "炼焦煤"),
                    List.of("华阳股份"), "矿山供给 → 电力、钢铁、化工",
                    "动力煤与焦煤用途不同；要区分煤种、产地和交货口径，不能混用价格。", false),
            new Product("rubber", "天然橡胶", "元/吨", "RU", List.of("天然橡胶", "RU"),
                    List.of("海南橡胶"), "天然橡胶 → 轮胎、汽车、工业制品",
                    "看主产区天气、割胶季、库存、轮胎开工和合成胶价差。", true),
            new Product("rare-earth", "稀土（氧化镨钕）", "元/吨", null, List.of("氧化镨钕"),
                    List.of("北方稀土", "盛和资源"), "稀土矿/分离 → 磁材 → 新能源车、风电、电机",
                    "关注配额、分离产量、磁材需求、出口政策和上下游库存。", false));

    private static final List<CostMeta> COSTS = List.of(
            new CostMeta("alumina", "氧化铝", "元/吨", List.of("氧化铝"),
                    List.of("电解铝"), "电解铝主要原料之一"),
            new CostMeta("synthetic-ammonia", "合成氨", "元/吨", List.of("合成氨", "液氨"),
                    List.of("纯碱", "尿素"), "化工原料参考价"),
            new CostMeta("sulfuric-acid", "硫酸", "元/吨", List.of("硫酸"),
                    List.of("钛白粉"), "硫酸法钛白粉成本参考"),
            new CostMeta("titanium-concentrate", "钛精矿", "元/吨", List.of("钛精矿", "钛矿"),
                    List.of("钛白粉"), "钛白粉主要原料参考"),
            new CostMeta("thermal-coal", "动力煤", "元/吨", List.of("动力煤"),
                    List.of("尿素", "甲醇", "纯碱"), "煤化工能源成本参考；煤种/地区口径需核对"));

    private final BusinessItemRepository businessItemRepository;
    private final CostInputRepository costInputRepository;
    private final SyncLogService syncLogService;

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public Map<String, Object> sync(boolean manual) {
        var syncLog = syncLogService.start("business", manual ? "manual" : "schedule");
        try {
            List<String> errors = new ArrayList<>();
            JsonNode spotStock = fetchSpotStock(errors);
            boolean fresh = false;
            int updated = 0;
            LocalDate today = CodeUtils.today();

            List<BusinessItem> items = new ArrayList<>();
            for (int i = 0; i < PRODUCTS.size(); i++) {
                Product meta = PRODUCTS.get(i);
                BusinessItem item = businessItemRepository.findByItemId(meta.id()).orElseGet(BusinessItem::new);
                item.setItemId(meta.id());
                item.setName(meta.name());
                item.setUnit(meta.unit());
                item.setSymbol(meta.symbol());
                item.setStocksJson(JsonUtils.write(meta.stocks()));
                item.setChain(meta.chain());
                item.setDrivers(meta.drivers());
                item.setSourceUrl(SPOT_STOCK_SOURCE_URL);
                item.setSortOrder(i);
                item.setUpdatedAt(Instant.now());

                List<Map<String, Object>> series = JsonUtils.readList(item.getSeriesJson());
                if (meta.core() && meta.symbol() != null) {
                    Map<String, Object> point = fetch100ppi(meta.aliases(), today, errors);
                    if (point != null) {
                        series = appendPoint(series, point);
                        item.setSeriesJson(JsonUtils.write(series));
                        item.setLatestSpot(toDouble(point.get("spot")));
                        item.setLatestFutures(toDouble(point.get("futures")));
                        item.setLatestDate(LocalDate.parse(String.valueOf(point.get("date"))));
                        item.setLatest(item.getLatestSpot() != null ? item.getLatestSpot() : item.getLatestFutures());
                        item.setSource("生意社现货/期货基差数据");
                        item.setSourceUrl("https://www.100ppi.com/");
                        item.setStatus("ok");
                        fresh = true;
                    }
                }

                JsonNode row = findSpotRow(spotStock, meta.aliases());
                if (row != null) {
                    item.setIndustryLinksJson(JsonUtils.write(industryLinks(row)));
                    List<Map<String, Object>> monthly = monthlyPrices(row, spotStock, today);
                    if (!monthly.isEmpty()) {
                        item.setMonthlyPricesJson(JsonUtils.write(Map.of(
                                "label", "来源提供的近月价格快照",
                                "series", monthly,
                                "source", SPOT_STOCK_SOURCE,
                                "sourceUrl", SPOT_STOCK_SOURCE_URL)));
                    }
                    if (!meta.core()) {
                        Double latest = dbl(row, "price");
                        if (latest != null) {
                            item.setName(text(row, "name") == null ? meta.name() : text(row, "name"));
                            item.setLatest(latest);
                            item.setLatestDate(today);
                            item.setLatestSpot(latest);
                            item.setChangePct(dbl(row, "zdf"));
                            item.setSource(SPOT_STOCK_SOURCE);
                            item.setSourceUrl(SPOT_STOCK_SOURCE_URL);
                            item.setStatus("latest-only");
                            fresh = true;
                        }
                    }
                }
                if (item.getStatus() == null) {
                    item.setStatus("pending");
                }
                if (item.getLatest() != null) {
                    updated++;
                }
                items.add(item);
            }

            // 期货仓单库存
            Map<String, String> inventorySymbols = Map.of(
                    "soda-ash", "纯碱", "urea", "尿素", "methanol", "甲醇",
                    "aluminium", "沪铝", "rubber", "橡胶");
            Map<String, String> tradeCodeMap = fetchInventoryCodes(errors);
            for (BusinessItem item : items) {
                String symbol = inventorySymbols.get(item.getItemId());
                if (symbol == null) {
                    continue;
                }
                String code = tradeCodeMap.get(symbol);
                if (code == null) {
                    continue;
                }
                Map<String, Object> inventory = fetchInventory(code, symbol, errors);
                if (inventory != null) {
                    item.setInventoryJson(JsonUtils.write(inventory));
                    fresh = true;
                }
            }

            // 成本原料
            List<CostInput> costs = new ArrayList<>();
            for (int i = 0; i < COSTS.size(); i++) {
                CostMeta meta = COSTS.get(i);
                CostInput item = costInputRepository.findByInputId(meta.id()).orElseGet(CostInput::new);
                item.setInputId(meta.id());
                item.setName(meta.name());
                item.setUnit(meta.unit());
                item.setRole(meta.role());
                item.setRelatedProductsJson(JsonUtils.write(meta.relatedProducts()));
                item.setSourceUrl(SPOT_STOCK_SOURCE_URL);
                item.setSortOrder(i);

                List<Map<String, Object>> series = JsonUtils.readList(item.getSeriesJson());
                if ("alumina".equals(meta.id())) {
                    Map<String, Object> point = fetch100ppi(List.of("氧化铝"), today, errors);
                    if (point != null) {
                        series = appendPoint(series, point);
                        item.setSeriesJson(JsonUtils.write(series));
                        item.setLatest(toDouble(point.get("spot") != null ? point.get("spot") : point.get("futures")));
                        item.setLatestDate(LocalDate.parse(String.valueOf(point.get("date"))));
                        item.setSource("生意社现货/期货参考价格");
                        item.setSourceUrl("https://www.100ppi.com/");
                        item.setStatus("ok");
                        fresh = true;
                    }
                }

                JsonNode row = findSpotRow(spotStock, meta.aliases());
                if (row != null) {
                    Double latest = dbl(row, "price");
                    if (latest != null) {
                        item.setLatest(latest);
                        item.setLatestDate(today);
                        item.setSource(SPOT_STOCK_SOURCE);
                        item.setSourceUrl(SPOT_STOCK_SOURCE_URL);
                        item.setStatus("latest-only");
                        List<Map<String, Object>> monthly = monthlyPrices(row, spotStock, today);
                        if (!monthly.isEmpty()) {
                            item.setMonthlyPricesJson(JsonUtils.write(Map.of(
                                    "label", "来源提供的近月价格快照",
                                    "series", monthly,
                                    "source", SPOT_STOCK_SOURCE,
                                    "sourceUrl", SPOT_STOCK_SOURCE_URL)));
                        }
                        fresh = true;
                    }
                }
                if (item.getStatus() == null) {
                    item.setStatus(item.getLatest() == null ? "pending" : "ok");
                }
                costs.add(item);
            }

            if (!fresh || updated == 0) {
                throw new IllegalStateException("没有获取到新的有效商品报价，保留上一次快照");
            }
            items.forEach(businessItemRepository::save);
            costs.forEach(costInputRepository::save);

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("products", updated);
            out.put("errors", errors);
            syncLogService.finish(syncLog, true, "产业链商品采集完成：" + updated + "/" + PRODUCTS.size()
                    + " 个品种有有效报价" + (errors.isEmpty() ? "" : "，失败 " + errors.size() + " 项"));
            return out;
        } catch (Exception e) {
            log.error("产业链商品采集失败", e);
            syncLogService.finish(syncLog, false, e.getMessage());
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    // ==================== 东方财富现货与股票 ====================

    private JsonNode fetchSpotStock(List<String> errors) {
        try {
            String html = get(SPOT_STOCK_URL, StandardCharsets.UTF_8);
            int start = html.indexOf("pagedata=");
            if (start < 0) {
                throw new IllegalStateException("页面缺少 pagedata");
            }
            int end = html.indexOf("/newstatic/js/common/emdataview.js", start);
            String json = (end > start ? html.substring(start + 9, end) : html.substring(start + 9)).trim();
            int semicolon = json.lastIndexOf(';');
            if (semicolon >= 0) {
                json = json.substring(0, semicolon);
            }
            return JsonUtils.mapper().readTree(json);
        } catch (Exception e) {
            errors.add("现货与股票: " + e.getMessage());
            return null;
        }
    }

    private JsonNode findSpotRow(JsonNode root, List<String> aliases) {
        if (root == null) {
            return null;
        }
        for (JsonNode category : root.path("datas")) {
            for (JsonNode row : category.path("list")) {
                String name = text(row, "name");
                if (name != null && aliases.stream().anyMatch(name::equals)) {
                    return row;
                }
            }
        }
        return null;
    }

    private Map<String, Object> industryLinks(JsonNode row) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("label", "数据源列示产业链企业");
        map.put("productName", text(row, "name"));
        map.put("producers", companyNames(row.path("scss"), 8));
        map.put("downstreamUsers", companyNames(row.path("xyyhs"), 8));
        map.put("source", SPOT_STOCK_SOURCE);
        map.put("sourceUrl", SPOT_STOCK_SOURCE_URL);
        return map;
    }

    private List<String> companyNames(JsonNode array, int limit) {
        List<String> names = new ArrayList<>();
        if (array.isArray()) {
            for (JsonNode node : array) {
                String name = text(node, "name");
                if (name != null && !names.contains(name)) {
                    names.add(name);
                }
                if (names.size() >= limit) {
                    break;
                }
            }
        }
        return names;
    }

    private List<Map<String, Object>> monthlyPrices(JsonNode row, JsonNode root, LocalDate today) {
        List<Map<String, Object>> points = new ArrayList<>();
        JsonNode dates = root.path("dates");
        for (int index = 1; index <= 5; index++) {
            Double value = dbl(row, "v" + index);
            if (value != null && value > 0) {
                String label = text(dates, "d" + index);
                Map<String, Object> point = new LinkedHashMap<>();
                point.put("label", label == null ? "近" + (6 - index) + "月" : label);
                String date = monthDay(label, today);
                if (date != null) {
                    point.put("date", date);
                }
                point.put("value", value);
                points.add(point);
            }
        }
        Double latest = dbl(row, "price");
        if (latest != null && latest > 0) {
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("label", "最新");
            point.put("date", today.toString());
            point.put("value", latest);
            points.add(point);
        }
        return points;
    }

    private String monthDay(String label, LocalDate today) {
        if (label == null || !label.matches("^\\d{2}-\\d{2}$")) {
            return null;
        }
        int month = Integer.parseInt(label.substring(0, 2));
        int day = Integer.parseInt(label.substring(3, 5));
        int year = today.getYear();
        try {
            LocalDate date = LocalDate.of(year, month, day);
            if (date.isAfter(today)) {
                date = LocalDate.of(year - 1, month, day);
            }
            return date.toString();
        } catch (Exception e) {
            return null;
        }
    }

    // ==================== 生意社 100ppi ====================

    private Map<String, Object> fetch100ppi(List<String> aliases, LocalDate today, List<String> errors) {
        for (int offset = 0; offset <= 8; offset++) {
            LocalDate day = today.minusDays(offset);
            if (day.getDayOfWeek().getValue() >= 6) {
                continue;
            }
            try {
                String url = "https://www.100ppi.com/sf2/day-" + day + ".html";
                String html = get(url, StandardCharsets.UTF_8);
                Document doc = Jsoup.parse(html);
                Element table = doc.selectFirst("table#fdata");
                if (table == null) {
                    continue;
                }
                for (Element tr : table.select("tr")) {
                    List<Element> cells = new ArrayList<>();
                    for (Element cell : tr.children()) {
                        if ("td".equals(cell.tagName())) {
                            cells.add(cell);
                        }
                    }
                    if (cells.size() < 4) {
                        continue;
                    }
                    String name = cells.get(0).text().trim();
                    if (aliases.stream().noneMatch(alias -> name.equals(alias) || name.startsWith(alias))) {
                        continue;
                    }
                    Double spot = parse(cells.get(1).text());
                    Double futures = parse(cells.get(3).text());
                    if (spot == null && futures == null) {
                        continue;
                    }
                    Map<String, Object> point = new LinkedHashMap<>();
                    point.put("date", day.toString());
                    point.put("spot", spot);
                    point.put("futures", futures);
                    return point;
                }
            } catch (Exception e) {
                errors.add("生意社 " + day + ": " + e.getMessage());
            }
        }
        return null;
    }

    private List<Map<String, Object>> appendPoint(List<Map<String, Object>> series,
                                                  Map<String, Object> point) {
        List<Map<String, Object>> list = new ArrayList<>(series);
        String date = String.valueOf(point.get("date"));
        list.removeIf(item -> date.equals(String.valueOf(item.get("date"))));
        list.add(point);
        list.sort(Comparator.comparing(item -> String.valueOf(item.get("date"))));
        if (list.size() > 180) {
            list = new ArrayList<>(list.subList(list.size() - 180, list.size()));
        }
        return list;
    }

    // ==================== 期货仓单库存 ====================

    private Map<String, String> fetchInventoryCodes(List<String> errors) {
        Map<String, String> map = new LinkedHashMap<>();
        try {
            String url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
                    + "?reportName=RPT_FUTU_POSITIONCODE&columns=TRADE_MARKET_CODE,TRADE_CODE,TRADE_TYPE"
                    + "&filter=(IS_MAINCODE%3D%221%22)&pageNumber=1&pageSize=500&source=WEB&client=WEB";
            JsonNode root = JsonUtils.mapper().readTree(get(url, StandardCharsets.UTF_8));
            for (JsonNode row : root.path("result").path("data")) {
                String type = text(row, "TRADE_TYPE");
                String code = text(row, "TRADE_CODE");
                if (type != null && code != null) {
                    map.put(type, code);
                }
            }
        } catch (Exception e) {
            errors.add("库存品种映射: " + e.getMessage());
        }
        return map;
    }

    private Map<String, Object> fetchInventory(String productCode, String symbol, List<String> errors) {
        try {
            String filter = "(SECURITY_CODE%3D%22" + productCode + "%22)(TRADE_DATE%3E%3D%272020-10-28%27)";
            String url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
                    + "?reportName=RPT_FUTU_STOCKDATA&columns=SECURITY_CODE,TRADE_DATE,ON_WARRANT_NUM,ADDCHANGE"
                    + "&filter=" + filter + "&pageNumber=1&pageSize=500&sortTypes=-1&sortColumns=TRADE_DATE"
                    + "&source=WEB&client=WEB";
            JsonNode root = JsonUtils.mapper().readTree(get(url, StandardCharsets.UTF_8));
            List<Map<String, Object>> series = new ArrayList<>();
            for (JsonNode row : root.path("result").path("data")) {
                String date = text(row, "TRADE_DATE");
                Double value = dbl(row, "ON_WARRANT_NUM");
                if (date == null || value == null || value <= 0) {
                    continue;
                }
                Map<String, Object> point = new LinkedHashMap<>();
                point.put("date", date.substring(0, 10));
                point.put("value", value);
                Double change = dbl(row, "ADDCHANGE");
                if (change != null) {
                    point.put("change", change);
                }
                series.add(point);
            }
            if (series.isEmpty()) {
                return null;
            }
            series.sort(Comparator.comparing(item -> String.valueOf(item.get("date"))));
            if (series.size() > 90) {
                series = new ArrayList<>(series.subList(series.size() - 90, series.size()));
            }
            Map<String, Object> last = series.get(series.size() - 1);
            Map<String, Object> inventory = new LinkedHashMap<>();
            inventory.put("label", "期货仓单库存（非全行业库存）");
            inventory.put("series", series);
            inventory.put("latest", last.get("value"));
            inventory.put("latestDate", last.get("date"));
            inventory.put("change", last.get("change"));
            inventory.put("source", INVENTORY_SOURCE);
            inventory.put("sourceUrl", INVENTORY_SOURCE_URL);
            return inventory;
        } catch (Exception e) {
            errors.add("库存 " + symbol + ": " + e.getMessage());
            return null;
        }
    }

    // ==================== HTTP / 解析 ====================

    private String get(String url, java.nio.charset.Charset charset) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(25))
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        + "(KHTML, like Gecko) Chrome/124 Safari/537.36")
                .header("Accept", "text/html,application/json,*/*")
                .header("Referer", "https://www.100ppi.com/")
                .GET().build();
        HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("HTTP " + response.statusCode());
        }
        return new String(response.body(), charset);
    }

    private static Double parse(String text) {
        if (text == null) {
            return null;
        }
        String cleaned = text.replace(",", "").replace("%", "").replace("&nbsp;", " ").trim();
        if (cleaned.isEmpty() || "-".equals(cleaned)) {
            return null;
        }
        try {
            double value = Double.parseDouble(cleaned);
            return Double.isFinite(value) && value > 0 ? value : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Double toDouble(Object value) {
        return StockDataService.asDouble(value);
    }

    private static String text(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static Double dbl(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (value.isNumber()) {
            return value.asDouble();
        }
        return parse(value.asText());
    }
}

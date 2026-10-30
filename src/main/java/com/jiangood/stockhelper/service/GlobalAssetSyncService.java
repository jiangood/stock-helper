package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.GlobalAsset;
import com.jiangood.stockhelper.repository.GlobalAssetRepository;
import com.jiangood.stockhelper.support.JsonUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 全球资产：Yahoo Finance 公共 chart 接口。单个品种失败时保留上一次有效快照。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GlobalAssetSyncService {

    private record AssetMeta(String id, String name, List<String> symbols, String currency,
                             String kind, String unit) {
    }

    private static final List<AssetMeta> ASSETS = List.of(
            new AssetMeta("gold", "黄金", List.of("XAUUSD=X", "GC=F"), "USD/盎司", "贵金属", "USD/盎司"),
            new AssetMeta("bitcoin", "比特币", List.of("BTC-USD"), "USD", "加密资产", "USD"),
            new AssetMeta("ethereum", "以太坊", List.of("ETH-USD"), "USD", "加密资产", "USD"),
            new AssetMeta("nikkei225", "日经 225", List.of("^N225"), "指数点", "海外指数", "指数点"),
            new AssetMeta("nasdaq100", "纳斯达克 100", List.of("^NDX"), "指数点", "海外指数", "指数点"),
            new AssetMeta("sp500", "标普 500", List.of("^GSPC"), "指数点", "海外指数", "指数点"),
            new AssetMeta("vix", "VIX 恐慌指数", List.of("^VIX"), "指数点", "波动率指标", "指数点"),
            new AssetMeta("usdcny", "美元兑人民币", List.of("CNY=X"), "CNY/USD", "外汇", "CNY/USD"));

    private final GlobalAssetRepository repository;
    private final SyncLogService syncLogService;

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public Map<String, Object> sync(boolean manual) {
        var syncLog = syncLogService.start("global-assets", manual ? "manual" : "schedule");
        try {
            int updated = 0;
            List<String> errors = new ArrayList<>();
            int order = 0;
            for (AssetMeta meta : ASSETS) {
                GlobalAsset item = repository.findByAssetId(meta.id()).orElseGet(GlobalAsset::new);
                item.setAssetId(meta.id());
                item.setName(meta.name());
                item.setKind(meta.kind());
                item.setUnit(meta.unit());
                item.setCurrency(meta.currency());
                item.setSortOrder(order++);

                boolean fetched = false;
                for (String symbol : meta.symbols()) {
                    try {
                        JsonNode result = fetchChart(symbol);
                        if (result != null) {
                            apply(item, result, symbol);
                            fetched = true;
                            updated++;
                            break;
                        }
                    } catch (Exception e) {
                        errors.add(meta.id() + " (" + symbol + "): " + e.getMessage());
                    }
                }
                if (!fetched) {
                    item.setStatus(item.getPrice() == null ? "等待可靠报价" : "缓存（本次未刷新）");
                }
                repository.save(item);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("assets", ASSETS.size());
            out.put("updated", updated);
            out.put("errors", errors);
            syncLogService.finish(syncLog, true, "全球资产采集完成：" + updated + "/" + ASSETS.size()
                    + " 个品种更新" + (errors.isEmpty() ? "" : "，失败 " + errors.size() + " 个"));
            return out;
        } catch (Exception e) {
            log.error("全球资产采集失败", e);
            syncLogService.finish(syncLog, false, e.getMessage());
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    private JsonNode fetchChart(String symbol) throws Exception {
        String encoded = URLEncoder.encode(symbol, StandardCharsets.UTF_8).replace("+", "%20");
        String url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encoded + "?range=1mo&interval=1d";
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20))
                .header("User-Agent", "Mozilla/5.0 (compatible; StockHelper/1.0; +https://github.com/jiangood/stock-helper)")
                .header("Accept", "application/json")
                .GET().build();
        HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("HTTP " + response.statusCode());
        }
        JsonNode root = JsonUtils.mapper().readTree(new String(response.body(), StandardCharsets.UTF_8));
        JsonNode chart = root.path("chart");
        if (!chart.path("error").isMissingNode() && !chart.path("error").isNull()) {
            throw new IllegalStateException(chart.path("error").asText());
        }
        JsonNode results = chart.path("result");
        if (!results.isArray() || results.isEmpty()) {
            throw new IllegalStateException("provider returned no chart result");
        }
        return results.get(0);
    }

    private void apply(GlobalAsset item, JsonNode result, String symbol) {
        JsonNode meta = result.path("meta");
        Double price = positive(meta.path("regularMarketPrice"));
        JsonNode timestamps = result.path("timestamp");
        JsonNode closes = result.path("indicators").path("quote").path(0).path("close");
        Long lastTimestamp = null;
        Double lastClose = null;
        if (timestamps.isArray() && closes.isArray()) {
            int size = Math.min(timestamps.size(), closes.size());
            for (int i = size - 1; i >= 0; i--) {
                Double close = positive(closes.get(i));
                if (close != null) {
                    if (price == null) {
                        price = close;
                    }
                    lastClose = close;
                    lastTimestamp = timestamps.get(i).asLong();
                    break;
                }
            }
        }
        if (price == null) {
            throw new IllegalStateException("provider returned no valid price");
        }
        Double previous = positive(meta.path("chartPreviousClose"));
        if (previous == null) {
            previous = positive(meta.path("previousClose"));
        }
        if (previous == null && lastClose != null) {
            // 用倒数第二个有效收盘兜底
            List<Double> valid = new ArrayList<>();
            if (closes.isArray()) {
                for (JsonNode node : closes) {
                    Double v = positive(node);
                    if (v != null) {
                        valid.add(v);
                    }
                }
            }
            if (valid.size() >= 2) {
                previous = valid.get(valid.size() - 2);
            }
        }
        Double change = previous == null ? null : price - previous;
        Double changePct = previous == null || previous == 0 || change == null ? null : change / previous * 100;

        List<Map<String, Object>> history = new ArrayList<>();
        if (timestamps.isArray() && closes.isArray()) {
            int size = Math.min(timestamps.size(), closes.size());
            for (int i = 0; i < size; i++) {
                Double close = positive(closes.get(i));
                if (close == null) {
                    continue;
                }
                LocalDate date = Instant.ofEpochSecond(timestamps.get(i).asLong()).atZone(ZoneOffset.UTC).toLocalDate();
                Map<String, Object> point = new LinkedHashMap<>();
                point.put("date", date.toString());
                point.put("close", Math.round(close * 10000) / 10000.0);
                history.add(point);
            }
        }
        if (history.size() > 22) {
            history = new ArrayList<>(history.subList(history.size() - 22, history.size()));
        }

        item.setPrice(price);
        item.setPrevClose(previous);
        item.setChange(change);
        item.setChangePct(changePct == null ? null : Math.round(changePct * 1000000) / 1000000.0);
        item.setQuoteTime(quoteTime(meta, lastTimestamp));
        item.setSourceSymbol(symbol);
        item.setSourceUrl("https://finance.yahoo.com/quote/" + URLEncoder.encode(symbol, StandardCharsets.UTF_8));
        item.setHistoryJson(history.isEmpty() ? null : JsonUtils.write(history));
        item.setStatus("已更新");
    }

    private static String quoteTime(JsonNode meta, Long lastTimestamp) {
        JsonNode marketTime = meta.path("regularMarketTime");
        long epoch = marketTime.isNumber() ? marketTime.asLong() : lastTimestamp == null ? 0 : lastTimestamp;
        return epoch <= 0 ? null : Instant.ofEpochSecond(epoch).toString();
    }

    private static Double positive(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        double v = node.isNumber() ? node.asDouble() : parse(node.asText());
        return Double.isFinite(v) && v > 0 ? v : null;
    }

    private static double parse(String value) {
        try {
            return Double.parseDouble(value);
        } catch (Exception e) {
            return Double.NaN;
        }
    }
}

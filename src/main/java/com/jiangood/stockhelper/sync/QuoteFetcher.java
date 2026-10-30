package com.jiangood.stockhelper.sync;

import com.jiangood.stockhelper.support.CodeUtils;
import com.jiangood.stockhelper.support.JsonUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A 股行情采集：东方财富 push2（JSON） + 腾讯财经（GBK）双源降级。
 * 只接受有效价格，缺失数据保持 null，不生成模拟行情。
 */
@Slf4j
@Component
public class QuoteFetcher {

    public static final String[] EASTMONEY_HOSTS = {"push2delay.eastmoney.com", "push2.eastmoney.com"};
    public static final String[] EASTMONEY_HISTORY_HOSTS = {"push2his.eastmoney.com", "push2delay.eastmoney.com"};
    public static final String[] TENCENT_HOSTS = {"qt.gtimg.cn"};
    public static final String[] TENCENT_APP_HOSTS = {"web.ifzq.gtimg.cn", "ifzq.gtimg.cn"};

    private static final DateTimeFormatter BAR_DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final int TIMEOUT_SECONDS = 15;

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(TIMEOUT_SECONDS))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public record Quote(String code, String name, Double price, Double prevClose, Double change,
                        Double todayChange, Double pe, Double pb, Double totalCap, Double floatCap,
                        Double divYield, Instant quoteTime) {
    }

    public record Detail(String code, String name, Double price, Double prevClose, Double change,
                         Double todayChange, Double open, Double high, Double low, Double avg,
                         Double volume, Double amount, Double turnover, Double volumeRatio,
                         Double amplitude, Double limitUp, Double limitDown, Double pe, Double peStatic,
                         Double peTtm, Double pb, Double roe, Double grossMargin, Double netMargin,
                         Double revenue, Double revenueYoY, Double profit, Double profitYoY,
                         Double navPerShare, Double high52, Double low52, String listedAt, String board,
                         Double totalShares, Double floatShares, Double totalCap, Double floatCap,
                         Instant quoteTime) {
    }

    public record BarRow(String time, Double open, Double close, Double high, Double low, Double volume) {
    }

    public record KlineResult(String code, String period, String adjust, List<BarRow> bars) {
    }

    public String toSecId(String code) {
        String c = CodeUtils.normalize(code);
        return c == null ? null : (c.startsWith("sh") ? "1." : "0.") + c.substring(2);
    }

    // ==================== 批量行情 ====================

    public Map<String, Quote> fetchQuotes(List<String> codes) {
        List<String> normalized = codes.stream().map(CodeUtils::normalize).filter(c -> c != null).distinct().toList();
        Map<String, Quote> out = new HashMap<>();
        if (normalized.isEmpty()) {
            return out;
        }
        List<List<String>> chunks = partition(normalized, 60);
        for (List<String> chunk : chunks) {
            Map<String, Quote> batch = fetchQuotesChunk(chunk);
            out.putAll(batch);
            List<String> missing = chunk.stream().filter(c -> !out.containsKey(c)).toList();
            if (!missing.isEmpty()) {
                out.putAll(fetchTencentQuotes(missing));
            }
        }
        return out;
    }

    private Map<String, Quote> fetchQuotesChunk(List<String> codes) {
        Map<String, Quote> out = new HashMap<>();
        String secids = codes.stream().map(this::toSecId).filter(s -> s != null).reduce((a, b) -> a + "," + b).orElse("");
        if (secids.isBlank()) {
            return out;
        }
        for (String host : EASTMONEY_HOSTS) {
            try {
                String path = "/api/qt/ulist.np/get?fltt=2&secids=" + secids
                        + "&fields=f2,f3,f4,f9,f12,f13,f14,f18,f20,f21,f23,f133&_=" + System.currentTimeMillis();
                String text = get("https://" + host + path, StandardCharsets.UTF_8, null);
                JsonNode root = JsonUtils.mapper().readTree(text);
                JsonNode diff = root.path("data").path("diff");
                if (!diff.isObject() && !diff.isArray()) {
                    continue;
                }
                List<JsonNode> items = new ArrayList<>();
                if (diff.isArray()) {
                    diff.forEach(items::add);
                } else {
                    diff.properties().forEach(e -> items.add(e.getValue()));
                }
                for (JsonNode item : items) {
                    Quote quote = parseEastmoneyQuote(item);
                    if (quote != null) {
                        out.put(quote.code(), quote);
                    }
                }
                if (!out.isEmpty()) {
                    return out;
                }
            } catch (Exception e) {
                log.debug("东方财富行情失败 {}: {}", host, e.getMessage());
            }
        }
        return out;
    }

    private Quote parseEastmoneyQuote(JsonNode item) {
        Double price = dbl(item, "f2");
        if (price == null || price <= 0) {
            return null;
        }
        String six = text(item, "f12");
        Integer market = item.has("f13") && item.get("f13").isNumber() ? item.get("f13").asInt() : null;
        String code = six == null ? null : (market != null ? (market == 1 ? "sh" : "sz") + six : CodeUtils.normalize(six));
        if (code == null) {
            return null;
        }
        return new Quote(code, text(item, "f14"), price, dbl(item, "f18"), dbl(item, "f4"), dbl(item, "f3"),
                dbl(item, "f9"), dbl(item, "f23"), dbl(item, "f20"), dbl(item, "f21"), dbl(item, "f133"),
                Instant.now());
    }

    private Map<String, Quote> fetchTencentQuotes(List<String> codes) {
        Map<String, Quote> out = new HashMap<>();
        for (String host : TENCENT_HOSTS) {
            try {
                String text = get("https://" + host + "/q=" + String.join(",", codes) + "&_=" + System.currentTimeMillis(),
                        Charset.forName("GBK"), null);
                java.util.regex.Matcher matcher = java.util.regex.Pattern
                        .compile("v_([a-z]{2}\\d{6})=\"([^\"]*)\"").matcher(text);
                while (matcher.find()) {
                    String code = matcher.group(1);
                    String[] f = matcher.group(2).split("~");
                    if (f.length < 33) {
                        continue;
                    }
                    Double price = num(f[3]);
                    if (price == null || price <= 0) {
                        continue;
                    }
                    Double totalCapYi = num(f.length > 45 ? f[45] : null);
                    Double floatCapYi = num(f.length > 44 ? f[44] : null);
                    out.put(code, new Quote(code, f[1], price, num(f[4]), num(f[31]), num(f[32]),
                            num(f.length > 39 ? f[39] : null), num(f.length > 46 ? f[46] : null),
                            totalCapYi == null ? null : totalCapYi * 1e8,
                            floatCapYi == null ? null : floatCapYi * 1e8,
                            num(f.length > 64 ? f[64] : null), Instant.now()));
                }
                if (!out.isEmpty()) {
                    return out;
                }
            } catch (Exception e) {
                log.debug("腾讯行情失败 {}: {}", host, e.getMessage());
            }
        }
        return out;
    }

    // ==================== 个股详情 ====================

    public Detail fetchDetail(String rawCode) {
        String code = CodeUtils.normalize(rawCode);
        if (code == null) {
            return null;
        }
        for (String host : EASTMONEY_HOSTS) {
            try {
                String path = "/api/qt/stock/get?fltt=2&secid=" + toSecId(code)
                        + "&fields=f43,f44,f45,f46,f47,f48,f50,f51,f52,f57,f58,f60,f71,f84,f85,f86,f92,f105,f107,"
                        + "f116,f117,f162,f163,f164,f167,f168,f169,f170,f171,f173,f174,f175,f183,f184,f185,f186,"
                        + "f187,f189,f198&_=" + System.currentTimeMillis();
                String text = get("https://" + host + path, StandardCharsets.UTF_8, null);
                JsonNode node = JsonUtils.mapper().readTree(text).path("data");
                Detail detail = parseEastmoneyDetail(node, code);
                if (detail != null && detail.price() != null && detail.price() > 0) {
                    return detail;
                }
            } catch (Exception e) {
                log.debug("东方财富详情失败 {}: {}", host, e.getMessage());
            }
        }
        return fetchTencentDetail(code);
    }

    private Detail parseEastmoneyDetail(JsonNode d, String fallbackCode) {
        if (d == null || d.isMissingNode() || d.isNull()) {
            return null;
        }
        Double price = dbl(d, "f43");
        if (price == null || price <= 0) {
            return null;
        }
        Integer market = d.has("f107") && d.get("f107").isNumber() ? d.get("f107").asInt() : null;
        String six = text(d, "f57");
        String code = six == null ? fallbackCode : (market != null ? (market == 1 ? "sh" : "sz") + six : CodeUtils.normalize(six));
        if (code == null) {
            code = fallbackCode;
        }
        Long time = d.has("f86") && d.get("f86").isNumber() ? d.get("f86").asLong() : null;
        return new Detail(code, text(d, "f58"), price, dbl(d, "f60"), dbl(d, "f169"), dbl(d, "f170"),
                dbl(d, "f46"), dbl(d, "f44"), dbl(d, "f45"), dbl(d, "f71"), dbl(d, "f47"), dbl(d, "f48"),
                dbl(d, "f168"), dbl(d, "f50"), dbl(d, "f171"), dbl(d, "f51"), dbl(d, "f52"),
                dbl(d, "f162"), dbl(d, "f163"), dbl(d, "f164"), dbl(d, "f167"), dbl(d, "f173"),
                dbl(d, "f186"), dbl(d, "f187"), dbl(d, "f183"), dbl(d, "f184"), dbl(d, "f105"),
                dbl(d, "f185"), dbl(d, "f92"), dbl(d, "f174"), dbl(d, "f175"), text(d, "f189"),
                text(d, "f198"), dbl(d, "f84"), dbl(d, "f85"), dbl(d, "f116"), dbl(d, "f117"),
                time == null ? Instant.now() : Instant.ofEpochSecond(time));
    }

    private Detail fetchTencentDetail(String code) {
        for (String host : TENCENT_HOSTS) {
            try {
                String text = get("https://" + host + "/q=" + code + "&_=" + System.currentTimeMillis(),
                        Charset.forName("GBK"), null);
                java.util.regex.Matcher matcher = java.util.regex.Pattern
                        .compile("v_([a-z]{2}\\d{6})=\"([^\"]*)\"").matcher(text);
                if (!matcher.find()) {
                    continue;
                }
                String[] f = matcher.group(2).split("~");
                if (f.length < 50) {
                    continue;
                }
                Double price = num(f[3]);
                if (price == null || price <= 0) {
                    continue;
                }
                Double amountWan = num(f.length > 37 ? f[37] : null);
                Double totalCapYi = num(f.length > 45 ? f[45] : null);
                Double floatCapYi = num(f.length > 44 ? f[44] : null);
                Double avg = amountWan != null && num(f[6]) != null && num(f[6]) > 0
                        ? amountWan * 1e4 / (num(f[6]) * 100) : null;
                return new Detail(code, f[1], price, num(f[4]), num(f[31]), num(f[32]), num(f[5]),
                        num(f[33]), num(f[34]), avg, num(f[6]), amountWan == null ? null : amountWan * 1e4,
                        num(f.length > 38 ? f[38] : null), num(f.length > 49 ? f[49] : null),
                        num(f.length > 43 ? f[43] : null), num(f.length > 47 ? f[47] : null),
                        num(f.length > 48 ? f[48] : null), null, null, num(f.length > 39 ? f[39] : null),
                        num(f.length > 46 ? f[46] : null), null, null, null, null, null, null, null,
                        null, null, null, null, null, null, null,
                        totalCapYi == null ? null : totalCapYi * 1e8,
                        floatCapYi == null ? null : floatCapYi * 1e8, tencentTime(f.length > 30 ? f[30] : null));
            } catch (Exception e) {
                log.debug("腾讯详情失败 {}: {}", host, e.getMessage());
            }
        }
        return null;
    }

    private Instant tencentTime(String raw) {
        if (raw == null || !raw.matches("^\\d{14}$")) {
            return Instant.now();
        }
        try {
            return java.time.LocalDateTime.parse(raw, DateTimeFormatter.ofPattern("yyyyMMddHHmmss"))
                    .atZone(CodeUtils.CHINA).toInstant();
        } catch (Exception e) {
            return Instant.now();
        }
    }

    // ==================== K 线 ====================

    public KlineResult fetchKline(String rawCode, String period, int count, String adjust) {
        String code = CodeUtils.normalize(rawCode);
        if (code == null) {
            return null;
        }
        String p = "week".equals(period) || "month".equals(period) ? period : "day";
        String a = "none".equals(adjust) || "".equals(adjust) ? "" : ("hfq".equals(adjust) ? "hfq" : "qfq");
        int n = Math.min(1000, Math.max(10, count));
        KlineResult tencent = fetchTencentKline(code, p, a, n);
        if (tencent != null && !tencent.bars().isEmpty()) {
            return tencent;
        }
        return fetchEastmoneyKline(code, p, a, n);
    }

    private KlineResult fetchTencentKline(String code, String period, String adjust, int count) {
        String adjustKey = adjust.isBlank() ? "" : adjust;
        for (String host : TENCENT_APP_HOSTS) {
            try {
                String path = "/appstock/app/fqkline/get?param=" + code + "," + period + ",,," + count + ","
                        + adjustKey + "&_=" + System.currentTimeMillis();
                String text = get("https://" + host + path, StandardCharsets.UTF_8, null);
                JsonNode root = JsonUtils.mapper().readTree(text);
                JsonNode data = root.path("data").path(code);
                JsonNode rows = data.path(adjustKey + period);
                if (!rows.isArray() || rows.isEmpty()) {
                    rows = data.path(period);
                }
                if (!rows.isArray() || rows.isEmpty()) {
                    continue;
                }
                List<BarRow> bars = new ArrayList<>();
                for (JsonNode row : rows) {
                    if (!row.isArray() || row.size() < 6) {
                        continue;
                    }
                    String time = barTime(row.get(0).asText());
                    Double open = num(row.get(1));
                    Double close = num(row.get(2));
                    Double high = num(row.get(3));
                    Double low = num(row.get(4));
                    if (time == null || open == null || close == null || high == null || low == null) {
                        continue;
                    }
                    bars.add(new BarRow(time, open, close, high, low, num(row.get(5))));
                }
                if (!bars.isEmpty()) {
                    return new KlineResult(code, period, adjust, bars);
                }
            } catch (Exception e) {
                log.debug("腾讯K线失败 {} {}: {}", host, code, e.getMessage());
            }
        }
        return null;
    }

    private KlineResult fetchEastmoneyKline(String code, String period, String adjust, int count) {
        int klt = switch (period) {
            case "week" -> 102;
            case "month" -> 103;
            default -> 101;
        };
        int fqt = adjust.isBlank() ? 0 : "hfq".equals(adjust) ? 2 : 1;
        for (String host : EASTMONEY_HISTORY_HOSTS) {
            try {
                String path = "/api/qt/stock/kline/get?secid=" + toSecId(code)
                        + "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57"
                        + "&klt=" + klt + "&fqt=" + fqt + "&end=20500101&lmt=" + count
                        + "&_=" + System.currentTimeMillis();
                String text = get("https://" + host + path, StandardCharsets.UTF_8, null);
                JsonNode klines = JsonUtils.mapper().readTree(text).path("data").path("klines");
                if (!klines.isArray() || klines.isEmpty()) {
                    continue;
                }
                List<BarRow> bars = new ArrayList<>();
                for (JsonNode node : klines) {
                    String[] f = node.asText().split(",");
                    if (f.length < 6) {
                        continue;
                    }
                    Double open = num(f[1]);
                    Double close = num(f[2]);
                    Double high = num(f[3]);
                    Double low = num(f[4]);
                    if (open == null || close == null || high == null || low == null) {
                        continue;
                    }
                    bars.add(new BarRow(barTime(f[0]), open, close, high, low, num(f[5])));
                }
                if (!bars.isEmpty()) {
                    return new KlineResult(code, period, adjust, bars);
                }
            } catch (Exception e) {
                log.debug("东方财富K线失败 {} {}: {}", host, code, e.getMessage());
            }
        }
        return null;
    }

    // ==================== HTTP / 工具 ====================

    private String get(String url, Charset charset, Map<String, String> extraHeaders) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(TIMEOUT_SECONDS))
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        + "(KHTML, like Gecko) Chrome/124 Safari/537.36")
                .header("Accept", "application/json, text/plain, */*")
                .header("Referer", "https://quote.eastmoney.com/");
        if (extraHeaders != null) {
            extraHeaders.forEach(builder::header);
        }
        HttpResponse<byte[]> response = client.send(builder.GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IllegalStateException("HTTP " + response.statusCode());
        }
        return new String(response.body(), charset);
    }

    private static List<List<String>> partition(List<String> list, int size) {
        List<List<String>> out = new ArrayList<>();
        for (int i = 0; i < list.size(); i += size) {
            out.add(list.subList(i, Math.min(list.size(), i + size)));
        }
        return out;
    }

    private static Double num(Object value) {
        if (value == null) {
            return null;
        }
        String s = String.valueOf(value).trim();
        if (s.isEmpty() || "-".equals(s) || "null".equalsIgnoreCase(s)) {
            return null;
        }
        try {
            double d = Double.parseDouble(s);
            return Double.isFinite(d) ? d : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Double dbl(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        if (value.isNumber()) {
            double d = value.asDouble();
            return Double.isFinite(d) ? d : null;
        }
        return num(value.asText());
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static String barTime(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.matches("^\\d{8}$")) {
            return s.substring(0, 4) + "-" + s.substring(4, 6) + "-" + s.substring(6, 8);
        }
        if (s.length() >= 10) {
            String date = s.substring(0, 10);
            try {
                LocalDate.parse(date, BAR_DATE);
                return date;
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }
}

package com.jiangood.stockhelper.indicator;

import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.domain.StockQuote;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 鳄鱼纪律：估值锚、买入资格、5 项自动筛选、连续涨停与历史分位。
 * 规则与原 croc.js 完全一致，缺失数据返回 null，不做 0 值填充。
 */
public final class CrocEvaluator {

    public static final double SMALL_CAP = 2e10;
    public static final double PB_GOLDEN = 0.8;
    public static final double PE_HIGH = 30;

    private static final Pattern ST_PATTERN = Pattern.compile("^(S\\*?)?\\*?ST", Pattern.CASE_INSENSITIVE);

    private CrocEvaluator() {
    }

    public record Eval(String code, String name, Double price, Double pb, Double pe, Double cap, Double nav,
                       String zone, boolean st, boolean loss, boolean pbUnder1, boolean pbGolden,
                       boolean smallCap, Double navGolden, Double toEntry, Double toHeavy) {
    }

    public record Check(String key, String label, boolean ok, boolean known) {
    }

    public record Screen(List<Check> checks, int passed, int total, int known, boolean complete,
                         boolean allPass, List<Check> failed, List<Check> pending, Eval eval) {
    }

    public record Eligibility(boolean eligible, String reason) {
    }

    public record LimitUpInfo(int count, double pct, boolean opened, String lastDate, Double limitPrice) {
    }

    public static Double num(Double v) {
        return v == null || !Double.isFinite(v) ? null : v;
    }

    public static boolean isST(String name) {
        return name != null && ST_PATTERN.matcher(name.trim()).find();
    }

    /** 买入区间：heavy（重仓区） < entry（入场区） < above（偏高）。 */
    public static String zoneOf(Stock stock, Double priceValue) {
        Double p = num(priceValue);
        if (p == null || p <= 0 || stock == null) {
            return "unknown";
        }
        Double heavy = num(stock.getHeavy());
        Double entry = num(stock.getEntry());
        if (heavy != null && entry != null && heavy > entry) {
            return p <= entry ? "entry" : "above";
        }
        if (heavy != null && p <= heavy) {
            return "heavy";
        }
        if (entry != null && p <= entry) {
            return "entry";
        }
        if (entry != null) {
            return "above";
        }
        return "unknown";
    }

    public static Eval evaluate(Stock stock, StockQuote quote) {
        Stock s = stock == null ? new Stock() : stock;
        StockQuote q = quote == null ? new StockQuote() : quote;
        Double price = num(q.getPrice());
        Double pb = num(q.getPb());
        Double pe = num(q.getPe());
        Double cap = num(q.getTotalCap());
        Double entry = num(s.getEntry());
        Double heavy = num(s.getHeavy());
        boolean st = isST(s.getName()) || isST(q.getName());
        return new Eval(s.getCode(), q.getName() != null ? q.getName() : s.getName(), price, pb, pe, cap, null,
                zoneOf(s, price), st, pe != null && pe < 0,
                pb != null && pb > 0 && pb < 1, pb != null && pb > 0 && pb <= PB_GOLDEN,
                cap != null && cap > 0 && cap <= SMALL_CAP, null,
                price != null && entry != null && entry > 0 ? (price / entry - 1) * 100 : null,
                price != null && heavy != null && heavy > 0 ? (price / heavy - 1) * 100 : null);
    }

    public static Eligibility buyEligibility(Stock stock, StockQuote quote) {
        Eval e = evaluate(stock, quote);
        if (e.st()) {
            return new Eligibility(false, "ST 风险股，不买");
        }
        if (e.pe() == null) {
            return new Eligibility(false, "盈利数据缺失，暂不判断买点");
        }
        if (e.pe() <= 0) {
            return new Eligibility(false, "亏损或无有效盈利，不买");
        }
        return new Eligibility(true, "");
    }

    public static Screen screen(Stock stock, StockQuote quote) {
        Eval e = evaluate(stock, quote);
        List<Check> checks = new ArrayList<>();
        checks.add(new Check("st", "ST", !e.st(), true));
        checks.add(new Check("loss", "亏损", e.pe() != null && e.pe() > 0, e.pe() != null));
        checks.add(new Check("pe", "PE30", e.pe() != null && e.pe() > 0 && e.pe() <= PE_HIGH, e.pe() != null));
        checks.add(new Check("cap", "市值", e.cap() != null && e.cap() > 0 && e.cap() <= SMALL_CAP, e.cap() != null));
        checks.add(new Check("pb", "破净", e.pb() != null && e.pb() > 0 && e.pb() < 1, e.pb() != null));

        List<Check> failed = checks.stream().filter(c -> c.known() && !c.ok()).toList();
        List<Check> pending = checks.stream().filter(c -> !c.known()).toList();
        int known = checks.size() - pending.size();
        int passed = (int) checks.stream().filter(Check::ok).count();
        return new Screen(checks, passed, checks.size(), known, pending.isEmpty(),
                pending.isEmpty() && failed.isEmpty(), failed, pending, e);
    }

    public static boolean matchStatus(Stock stock, StockQuote quote, String key) {
        if (key == null || key.isBlank()) {
            return true;
        }
        Eval e = evaluate(stock, quote);
        Stock s = stock == null ? new Stock() : stock;
        Double heavy = num(s.getHeavy());
        Double entry = num(s.getEntry());
        boolean heavyUsable = heavy != null && (entry == null || heavy <= entry);
        return switch (key) {
            case "heavy" -> "heavy".equals(e.zone());
            case "near" -> heavyUsable && e.price() != null && e.price() > heavy && e.price() <= heavy * 1.03;
            case "entry" -> "heavy".equals(e.zone()) || "entry".equals(e.zone());
            case "pb" -> e.pbUnder1();
            case "pb80" -> e.pbGolden();
            case "small" -> e.smallCap();
            case "risk" -> e.st() || e.loss();
            case "above" -> "above".equals(e.zone());
            case "screen" -> screen(stock, quote).allPass();
            case "screenbuy" -> screen(stock, quote).allPass()
                    && buyEligibility(stock, quote).eligible()
                    && ("heavy".equals(e.zone()) || "entry".equals(e.zone()));
            default -> true;
        };
    }

    /** 涨跌停幅度（%）：创业板/科创板 20，北交所 30，ST 5，其余 10。 */
    public static double limitUpPct(String code, String name) {
        String c = code == null ? "" : code;
        String six = c.length() > 6 ? c.substring(c.length() - 6) : c;
        if (six.matches("^(300|301|688|689).*")) {
            return 20;
        }
        if (six.matches("^(8|4|92).*")) {
            return 30;
        }
        return isST(name) ? 5 : 10;
    }

    public static LimitUpInfo limitUpInfo(List<Bar> bars, String code, String name) {
        if (bars == null || bars.size() < 2) {
            return null;
        }
        double pct = limitUpPct(code, name);
        double threshold = pct - 0.2;
        int count = 0;
        for (int i = bars.size() - 1; i > 0; i--) {
            Double prev = num(bars.get(i - 1).close());
            Double cur = num(bars.get(i).close());
            if (prev == null || cur == null || prev <= 0) {
                break;
            }
            if ((cur / prev - 1) * 100 >= threshold) {
                count++;
            } else {
                break;
            }
        }
        Bar last = bars.get(bars.size() - 1);
        Bar prev = bars.get(bars.size() - 2);
        Double prevClose = num(prev.close());
        Double limitPrice = prevClose != null && prevClose > 0
                ? Math.round(prevClose * (1 + pct / 100) * 100) / 100.0 : null;
        boolean opened = limitPrice != null && num(last.high()) != null
                && last.high() >= limitPrice - 0.005 && num(last.close()) != null
                && last.close() < limitPrice - 0.005;
        return new LimitUpInfo(count, pct, opened, last.time() == null ? "" : last.time(), limitPrice);
    }

    public static Double percentile(List<Double> values, Double current) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        List<Double> list = new ArrayList<>();
        for (Double value : values) {
            Double v = num(value);
            if (v != null) {
                list.add(v);
            }
        }
        Double cur = num(current);
        if (list.isEmpty() || cur == null) {
            return null;
        }
        int below = 0;
        for (Double v : list) {
            if (v <= cur) {
                below++;
            }
        }
        return below * 100.0 / list.size();
    }

    public static String normalizeCode(String raw) {
        if (raw == null) {
            return null;
        }
        String c = raw.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
        if (c.matches("^(sh|sz)\\d{6}$")) {
            return c;
        }
        if (c.matches("^\\d{6}$")) {
            return (c.charAt(0) == '5' || c.charAt(0) == '6' || c.charAt(0) == '8' || c.charAt(0) == '9'
                    ? "sh" : "sz") + c;
        }
        return null;
    }
}

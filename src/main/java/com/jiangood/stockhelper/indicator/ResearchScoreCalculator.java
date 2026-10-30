package com.jiangood.stockhelper.indicator;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 研报评分（7 项可复算指标，合计 65 分，折算百分制）。
 * 阈值与原 research-score.js 的 CONFIG 保持一致。
 */
public final class ResearchScoreCalculator {

    public static final Map<String, Double> WEIGHTS = Map.of(
            "owner", 10.0, "cap", 8.0, "focus", 9.0, "profit", 14.0,
            "consolidation", 9.0, "bottom", 9.0, "volume", 6.0);

    public static final double TOTAL_MAX = 65;

    public record Annual(String date, Double yoy, Double value) {
    }

    public record Input(Double cap, List<Bar> monthly, List<Bar> weekly, List<Bar> daily,
                        Double price, Double high52, Double low52, String ownerType,
                        Double mainRatio, List<Annual> annual, String asOf) {
    }

    public record ItemResult(Double score, Map<String, Object> metrics) {
    }

    public record Result(Map<String, Double> items, Double points, Double max, double totalMax,
                         Double percent, int known, boolean complete, String band,
                         Map<String, Object> metrics) {
    }

    private ResearchScoreCalculator() {
    }

    public static Double clamp(Double v, double min, double max) {
        if (v == null) {
            return null;
        }
        return Math.max(min, Math.min(max, v));
    }

    public static Double percentile(List<Double> values, Double current) {
        List<Double> list = new ArrayList<>();
        if (values != null) {
            for (Double v : values) {
                if (v != null && Double.isFinite(v)) {
                    list.add(v);
                }
            }
        }
        if (list.isEmpty() || current == null || !Double.isFinite(current)) {
            return null;
        }
        int below = 0;
        for (Double v : list) {
            if (v <= current) {
                below++;
            }
        }
        return below * 100.0 / list.size();
    }

    private static List<Double> closesOf(List<Bar> bars) {
        List<Double> out = new ArrayList<>();
        if (bars != null) {
            for (Bar bar : bars) {
                if (bar != null && bar.close() != null && bar.close() > 0) {
                    out.add(bar.close());
                }
            }
        }
        return out;
    }

    /** 周 K 合成月 K：每月取最后一根收盘，成交量累加。 */
    public static List<Bar> deriveMonthly(List<Bar> weekly) {
        List<Bar> bars = weekly == null ? List.of() : weekly;
        List<Bar> months = new ArrayList<>();
        String currentKey = null;
        Bar current = null;
        for (Bar bar : bars) {
            if (bar == null) {
                continue;
            }
            Double close = bar.close();
            String time = bar.time() == null ? "" : bar.time();
            if (close == null || close <= 0 || time.length() < 7) {
                continue;
            }
            String key = time.substring(0, 7);
            if (current == null || !key.equals(currentKey)) {
                currentKey = key;
                current = new Bar(time, bar.open(), close, bar.high(), bar.low(),
                        bar.volume() == null ? 0.0 : bar.volume());
                months.add(current);
            } else {
                current = new Bar(current.time(), current.open(), close,
                        bar.high() != null ? bar.high() : current.high(),
                        bar.low() != null ? bar.low() : current.low(),
                        (current.volume() == null ? 0 : current.volume()) + (bar.volume() == null ? 0 : bar.volume()));
                months.set(months.size() - 1, current);
            }
        }
        return months;
    }

    private static String lastTime(List<Bar> bars) {
        if (bars == null) {
            return "";
        }
        for (int i = bars.size() - 1; i >= 0; i--) {
            if (bars.get(i) != null && bars.get(i).time() != null && !bars.get(i).time().isBlank()) {
                return bars.get(i).time();
            }
        }
        return "";
    }

    private static List<Bar> dropPartialMonth(List<Bar> monthly, String asOfTime) {
        if (monthly == null) {
            return List.of();
        }
        List<Bar> list = new ArrayList<>(monthly);
        String month = asOfTime == null ? "" : asOfTime.substring(0, Math.min(7, asOfTime.length()));
        if (month.isBlank() || list.isEmpty()) {
            return list;
        }
        while (!list.isEmpty() && list.get(list.size() - 1).time() != null
                && list.get(list.size() - 1).time().length() >= 7
                && list.get(list.size() - 1).time().substring(0, 7).equals(month)) {
            list.remove(list.size() - 1);
        }
        return list;
    }

    public static Double scoreOwner(String type) {
        if (type == null || type.isBlank()) {
            return null;
        }
        return switch (type.toLowerCase()) {
            case "central" -> 10.0;
            case "province" -> 9.5;
            case "city" -> 7.5;
            case "other" -> 5.5;
            default -> null;
        };
    }

    public static Double scoreFocus(Double ratio) {
        if (ratio == null || ratio < 0 || ratio > 1) {
            return null;
        }
        return clamp(ratio * 10 + 1.5, 2, 10);
    }

    public static Map<String, Object> scoreProfit(List<Annual> annual, String asOf) {
        List<Annual> list = new ArrayList<>();
        if (annual != null) {
            for (Annual item : annual) {
                if (item != null && item.date() != null && (asOf == null || item.date().compareTo(asOf) <= 0)) {
                    list.add(item);
                }
            }
        }
        list.sort(Comparator.comparing(Annual::date).reversed());
        Map<String, Object> out = new LinkedHashMap<>();
        if (list.isEmpty()) {
            out.put("score", null);
            out.put("yoy", null);
            out.put("priorYoy", null);
            return out;
        }
        Annual latest = list.get(0);
        Annual prior = list.size() > 1 ? list.get(1) : null;
        Double yoy = latest.yoy();
        Double priorYoy = prior == null ? null : prior.yoy();
        Double value = latest.value();
        Double score;
        if (value != null && value <= 0) {
            score = 2.0;
        } else if (yoy == null) {
            score = null;
        } else if (yoy >= 100 && (priorYoy == null || priorYoy >= 100)) {
            score = 10.0;
        } else if (yoy >= 100) {
            score = 8.5;
        } else if (yoy >= 60) {
            score = 7.5;
        } else if (yoy >= 20) {
            score = 6.0;
        } else if (yoy >= 0) {
            score = 5.5;
        } else if (yoy >= -30) {
            score = 4.5;
        } else {
            score = 3.0;
        }
        out.put("score", score);
        out.put("yoy", yoy);
        out.put("priorYoy", priorYoy);
        return out;
    }

    public static Double scoreCap(Double cap) {
        if (cap == null || cap <= 0) {
            return null;
        }
        double yi = cap / 1e8;
        if (yi <= 100) {
            return 10.0;
        }
        if (yi <= 200) {
            return 6.5;
        }
        return clamp(6.5 - 3 * Math.log10(yi / 200), 3, 6.5);
    }

    public static ItemResult scoreConsolidation(List<Bar> monthly) {
        List<Bar> bars = monthly == null ? List.of() : monthly;
        int from = Math.max(0, bars.size() - 36);
        List<Bar> window = bars.subList(from, bars.size());
        List<Double> closes = closesOf(window);
        Map<String, Object> metrics = new LinkedHashMap<>();
        if (closes.size() < 12) {
            metrics.put("boxHeight", null);
            metrics.put("months", null);
            return new ItemResult(null, metrics);
        }
        double max = -Double.MAX_VALUE;
        double min = Double.MAX_VALUE;
        int peakIndex = 0;
        for (int i = 0; i < closes.size(); i++) {
            double v = closes.get(i);
            if (v > max) {
                max = v;
                peakIndex = i;
            }
            if (v < min) {
                min = v;
            }
        }
        if (!(min > 0)) {
            metrics.put("boxHeight", null);
            metrics.put("months", null);
            return new ItemResult(null, metrics);
        }
        double boxHeight = (max - min) / min;
        int monthsAgo = closes.size() - 1 - peakIndex;
        double horizontal = Math.max(0, Math.min(1, (0.80 - boxHeight) / (0.80 - 0.20)));
        double duration = Math.max(0, Math.min(1, (monthsAgo - 6.0) / (24.0 - 6.0)));
        Double score = clamp(10 * (0.5 * horizontal + 0.5 * duration), 4, 9);
        metrics.put("boxHeight", boxHeight);
        metrics.put("months", monthsAgo);
        return new ItemResult(score, metrics);
    }

    public static ItemResult scoreBottom(List<Bar> monthly, Double price, Double high52, Double low52) {
        List<Double> closes = closesOf(monthly);
        Map<String, Object> metrics = new LinkedHashMap<>();
        if (price == null || price <= 0 || closes.size() < 6) {
            return new ItemResult(null, metrics);
        }
        Double pAll = percentile(closes, price);
        Double p52 = null;
        if (high52 != null && low52 != null && high52 > low52) {
            p52 = (price - low52) / (high52 - low52) * 100;
        }
        double weightSum = 0;
        double acc = 0;
        if (pAll != null) {
            weightSum += 0.6;
            acc += Math.max(0, Math.min(100, pAll)) * 0.6;
        }
        if (p52 != null) {
            weightSum += 0.4;
            acc += Math.max(0, Math.min(100, p52)) * 0.4;
        }
        if (!(weightSum > 0)) {
            return new ItemResult(null, metrics);
        }
        double position = acc / weightSum / 100;
        Double score = clamp(10 * Math.pow(1 - position, 0.8), 4, 10);
        metrics.put("pAll", pAll);
        metrics.put("p52", p52);
        metrics.put("position", position);
        return new ItemResult(score, metrics);
    }

    private static Double volumeRatio(List<Double> values, int recent, int base) {
        List<Double> list = new ArrayList<>();
        if (values != null) {
            for (Double v : values) {
                if (v != null && Double.isFinite(v) && v > 0) {
                    list.add(v);
                }
            }
        }
        if (list.size() < recent + 12) {
            return null;
        }
        Double now = mean(list.subList(list.size() - recent, list.size()));
        Double before = mean(list.subList(Math.max(0, list.size() - (recent + base)), list.size() - recent));
        if (now == null || before == null || before <= 0) {
            return null;
        }
        return now / before;
    }

    private static Double mean(List<Double> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        double sum = 0;
        for (Double v : values) {
            sum += v;
        }
        return sum / values.size();
    }

    public static ItemResult scoreVolume(List<Bar> monthly, List<Bar> weekly, String asOfTime) {
        List<Bar> bars = dropPartialMonth(monthly, asOfTime);
        List<Double> volumes = new ArrayList<>();
        for (Bar bar : bars) {
            if (bar != null && bar.volume() != null && bar.volume() > 0) {
                volumes.add(bar.volume());
            }
        }
        Double ratio = volumeRatio(volumes, 6, 36);
        Map<String, Object> metrics = new LinkedHashMap<>();
        Map<String, Object> window = new LinkedHashMap<>();
        window.put("recent", 6);
        window.put("base", 36);
        window.put("period", "month");
        if (ratio == null) {
            List<Double> weekVolumes = new ArrayList<>();
            if (weekly != null) {
                for (Bar bar : weekly) {
                    if (bar != null && bar.volume() != null && bar.volume() > 0) {
                        weekVolumes.add(bar.volume());
                    }
                }
            }
            ratio = volumeRatio(weekVolumes, 4, 24);
            window.put("recent", 4);
            window.put("base", 24);
            window.put("period", "week");
        }
        if (ratio == null) {
            metrics.put("volRatio", null);
            return new ItemResult(null, metrics);
        }
        Double score = clamp(10 * (ratio - 0.6) / (3.0 - 0.6), 0, 9);
        metrics.put("volRatio", ratio);
        metrics.put("volumeWindow", window);
        return new ItemResult(score, metrics);
    }

    public static String bandOf(Double points) {
        if (points == null) {
            return null;
        }
        if (points >= 75) {
            return "good";
        }
        if (points >= 56) {
            return "mid";
        }
        return "high";
    }

    public static String bandLabel(String band) {
        if (band == null) {
            return "";
        }
        return switch (band) {
            case "good" -> "位置优秀";
            case "mid" -> "位置中性";
            default -> "位置偏高";
        };
    }

    public static Result compute(Input input) {
        Input src = input == null ? new Input(null, null, null, null, null, null, null, null, null, null, null)
                : input;
        List<Bar> daily = src.daily() == null ? List.of() : src.daily();
        List<Bar> weekly = src.weekly() == null ? List.of() : src.weekly();
        List<Bar> monthly = src.monthly() == null ? List.of() : src.monthly();
        if (monthly.size() < 12 && weekly.size() >= 12) {
            monthly = deriveMonthly(weekly);
        }
        String asOf = !lastTime(daily).isBlank() ? lastTime(daily)
                : !lastTime(weekly).isBlank() ? lastTime(weekly) : lastTime(monthly);

        Double ownerScore = scoreOwner(src.ownerType());
        Double cap = scoreCap(src.cap());
        Double focus = scoreFocus(src.mainRatio());
        Map<String, Object> profit = scoreProfit(src.annual(), src.asOf());
        ItemResult consolidation = scoreConsolidation(monthly);
        ItemResult bottom = scoreBottom(monthly, src.price(), src.high52(), src.low52());
        ItemResult volume = scoreVolume(monthly, weekly, asOf);

        Map<String, Double> items = new LinkedHashMap<>();
        items.put("owner", ownerScore);
        items.put("cap", cap);
        items.put("focus", focus);
        items.put("profit", (Double) profit.get("score"));
        items.put("consolidation", consolidation.score());
        items.put("bottom", bottom.score());
        items.put("volume", volume.score());

        double points = 0;
        double max = 0;
        int known = 0;
        for (Map.Entry<String, Double> entry : items.entrySet()) {
            Double score = entry.getValue();
            if (score == null) {
                continue;
            }
            max += WEIGHTS.get(entry.getKey());
            points += WEIGHTS.get(entry.getKey()) * score / 10;
            known++;
        }
        double rounded = Math.round(points * 10) / 10.0;
        boolean complete = known == WEIGHTS.size();
        Double percent = complete ? Math.round(rounded / TOTAL_MAX * 1000) / 10.0 : null;
        String band = complete ? bandOf(percent) : null;

        Map<String, Object> metrics = new LinkedHashMap<>();
        metrics.put("ownerType", src.ownerType());
        metrics.put("capYi", src.cap() == null ? null : src.cap() / 1e8);
        metrics.put("mainRatio", src.mainRatio());
        metrics.put("profitYoy", profit.get("yoy"));
        metrics.put("priorProfitYoy", profit.get("priorYoy"));
        metrics.put("boxHeight", consolidation.metrics().get("boxHeight"));
        metrics.put("months", consolidation.metrics().get("months"));
        metrics.put("position", bottom.metrics().get("position"));
        metrics.put("pAll", bottom.metrics().get("pAll"));
        metrics.put("p52", bottom.metrics().get("p52"));
        metrics.put("volRatio", volume.metrics().get("volRatio"));
        metrics.put("volumeWindow", volume.metrics().get("volumeWindow"));

        return new Result(items, known > 0 ? rounded : null, known > 0 ? max : null, TOTAL_MAX,
                percent, known, complete, band, metrics);
    }
}

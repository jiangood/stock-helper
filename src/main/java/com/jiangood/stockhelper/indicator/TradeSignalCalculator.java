package com.jiangood.stockhelper.indicator;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 交易信号：买入四项评分与止盈跟踪。规则参数来自 2026-10 回测，与原 trade-signals.js 一致。
 */
public final class TradeSignalCalculator {

    public static final int MIN_BARS = 60;
    public static final int MA_PERIOD = 20;
    public static final int MA_LONG = 60;
    public static final int RSI_PERIOD = 14;
    public static final int MFI_PERIOD = 14;
    public static final double DEEP_DEV = 12;
    public static final double DEEP_DRAWDOWN = 35;
    public static final double SHALLOW_DEV = 8;
    public static final double SHALLOW_DRAWDOWN = 25;
    public static final double RSI_DOWN = 30;
    public static final double RSI_PULLBACK_LOW = 25;
    public static final double RSI_PULLBACK_HIGH = 35;
    public static final double RSI_UP = 45;
    public static final double MFI_DOWN_OK = 30;
    public static final double MFI_OTHER_OK = 25;
    public static final double MFI_VETO = 20;
    public static final int SCORE_READY = 3;
    public static final double EXIT_ARM = 1.2;
    public static final double EXIT_TRAIL = 0.05;
    public static final int EXIT_COOLDOWN = 60;

    private TradeSignalCalculator() {
    }

    public record AddResult(String status, String kind, int score, int scoreMax, boolean dataReady,
                            boolean inZone, Double entry, Double gapPct, String regime, String regimeLabel,
                            boolean veto, Map<String, Boolean> parts, List<String> reasons,
                            Map<String, Object> details) {
    }

    public record ExitResult(String state, String kind, boolean armed, Double armLine, Double exitLine,
                             Double peak, Double low60, Double drawdown, Double distanceToExit,
                             int barsSinceTrigger, int cooldownDays, String peakDate, String triggerDate,
                             List<String> reasons) {
    }

    private static Double n(Double v) {
        return v == null || !Double.isFinite(v) ? null : v;
    }

    private static List<Double> closeSeries(List<Bar> bars) {
        List<Double> out = new ArrayList<>();
        for (Bar bar : bars) {
            out.add(bar == null ? null : n(bar.close()));
        }
        return out;
    }

    private static String pctText(Double v) {
        if (v == null) {
            return "—";
        }
        return (v > 0 ? "+" : "") + String.format("%.1f", v) + "%";
    }

    private static Double lowestClose(List<Double> closes, int end, int period) {
        int from = Math.max(0, end - period + 1);
        double lo = Double.MAX_VALUE;
        for (int i = from; i <= end; i++) {
            Double v = closes.get(i);
            if (v != null && v < lo) {
                lo = v;
            }
        }
        return lo == Double.MAX_VALUE ? null : lo;
    }

    private static String regimeOf(Double price, Double ma20, Double ma60) {
        if (ma20 == null || ma60 == null) {
            return null;
        }
        if (price >= ma20) {
            return "up";
        }
        return ma20 >= ma60 ? "below" : "down";
    }

    private static String regimeLabel(String regime) {
        if (regime == null) {
            return "状态未知";
        }
        return switch (regime) {
            case "up" -> "上涨趋势";
            case "below" -> "上升趋势回调";
            default -> "下跌趋势";
        };
    }

    public static AddResult evaluateAdd(Double price, Double entry, List<Bar> bars) {
        if (price == null || price <= 0 || bars == null || bars.size() < MIN_BARS) {
            return new AddResult("数据不足", "data", 0, 4, false, false, entry, null, null, null,
                    false, Map.of(), List.of("日 K 不足 " + MIN_BARS + " 根，无法计算买入条件"), Map.of());
        }
        List<Double> closes = closeSeries(bars);
        int last = bars.size() - 1;

        Double ma20 = TechIndicators.ma(bars, MA_PERIOD).latest();
        Double ma60 = TechIndicators.ma(bars, MA_LONG).latest();
        TechIndicators.Series rsiRes = TechIndicators.rsi(bars, RSI_PERIOD);
        TechIndicators.Series mfiRes = TechIndicators.mfi(bars, MFI_PERIOD);
        TechIndicators.MacdResult macdRes = TechIndicators.macd(bars, 12, 26, 9);
        TechIndicators.Series obvRes = TechIndicators.obv(bars);

        Double rsi = rsiRes.latest();
        Double mfi = mfiRes.latest();
        Double hist = macdRes.histogram().isEmpty() ? null : macdRes.histogram().get(last);
        Double histPrev = macdRes.histogram().size() > 1 ? macdRes.histogram().get(last - 1) : null;
        Double obvNow = obvRes.series().isEmpty() ? null : obvRes.series().get(last);
        Double obvPrev = obvRes.series().size() > 20 ? obvRes.series().get(last - 20) : null;

        String regime = regimeOf(price, ma20, ma60);
        Double dev20 = ma20 != null && ma20 != 0 ? (price / ma20 - 1) * 100 : null;
        Double low60 = lowestClose(closes, last, MIN_BARS);
        Double peak60 = null;
        for (int i = Math.max(0, last - MIN_BARS + 1); i <= last; i++) {
            Double c = closes.get(i);
            if (c != null && (peak60 == null || c > peak60)) {
                peak60 = c;
            }
        }
        Double dd60 = peak60 != null && peak60 != 0 ? (price / peak60 - 1) * 100 : null;

        boolean macdImproving = hist != null && histPrev != null && hist > histPrev;
        boolean obvUp = obvNow != null && obvPrev != null && obvNow >= obvPrev;

        Map<String, Boolean> parts = new LinkedHashMap<>();
        parts.put("depth", false);
        parts.put("rsi", false);
        parts.put("mfi", false);
        parts.put("mom", macdImproving || obvUp);
        if ("down".equals(regime)) {
            parts.put("depth", (dev20 != null && dev20 <= -DEEP_DEV)
                    || (dd60 != null && dd60 <= -DEEP_DRAWDOWN));
            parts.put("rsi", rsi != null && rsi <= RSI_DOWN);
            parts.put("mfi", mfi != null && mfi >= MFI_DOWN_OK);
        } else if ("below".equals(regime)) {
            parts.put("depth", (dev20 != null && dev20 <= -SHALLOW_DEV)
                    || (dd60 != null && dd60 <= -SHALLOW_DRAWDOWN));
            parts.put("rsi", rsi != null && rsi >= RSI_PULLBACK_LOW && rsi < RSI_PULLBACK_HIGH);
            parts.put("mfi", mfi != null && mfi < MFI_OTHER_OK);
        } else {
            parts.put("depth", dev20 != null && dev20 <= -SHALLOW_DEV);
            parts.put("rsi", rsi != null && rsi <= RSI_UP);
            parts.put("mfi", mfi != null && mfi < MFI_OTHER_OK);
        }
        int score = 0;
        for (Boolean value : parts.values()) {
            if (Boolean.TRUE.equals(value)) {
                score++;
            }
        }
        boolean veto = "down".equals(regime) && mfi != null && mfi < MFI_VETO;
        boolean inZone = entry != null && entry > 0 && price < entry;
        Double gapPct = entry != null && entry > 0 ? (price / entry - 1) * 100 : null;

        List<String> reasons = new ArrayList<>();
        if (entry == null || !(entry > 0)) {
            reasons.add("未配置计划入场价，不生成买入信号");
        } else if (inZone) {
            reasons.add("现价 " + String.format("%.2f", price) + " < 入场价 " + String.format("%.2f", entry)
                    + "（" + pctText(gapPct) + "）");
        } else {
            reasons.add("现价 " + String.format("%.2f", price) + " ≥ 入场价 " + String.format("%.2f", entry)
                    + "（" + pctText(gapPct) + "），不追高");
        }
        reasons.add((parts.get("depth") ? "✓" : "✗") + " 超跌深度：偏离 MA20 "
                + (dev20 == null ? "—" : String.format("%.1f", dev20) + "%")
                + "，60 日回撤 " + (dd60 == null ? "—" : String.format("%.1f", dd60) + "%"));
        reasons.add((parts.get("rsi") ? "✓" : "✗") + " RSI(14) "
                + (rsi == null ? "—" : String.format("%.1f", rsi)));
        reasons.add((parts.get("mfi") ? "✓" : "✗") + " MFI(14) "
                + (mfi == null ? "—" : String.format("%.1f", mfi))
                + ("down".equals(regime) ? "（下跌趋势需 ≥" + (int) MFI_DOWN_OK + "）"
                : "（需 <" + (int) MFI_OTHER_OK + "）"));
        reasons.add((parts.get("mom") ? "✓" : "✗") + " 动能：MACD 柱 "
                + (hist == null ? "—" : String.format("%.3f", hist))
                + (macdImproving ? "（改善）" : "（未改善）") + "；OBV " + (obvUp ? "未创新低" : "走弱"));
        if (veto) {
            reasons.add("！下跌趋势 + MFI<" + (int) MFI_VETO + "：资金持续流出，一票否决");
        }

        String status;
        String kind;
        if (entry == null || !(entry > 0)) {
            status = "未配置入场价";
            kind = "data";
        } else if (!inZone) {
            status = "高于入场价";
            kind = "watch";
        } else if (veto) {
            status = "观望 · 资金流出";
            kind = "watch";
        } else if (score >= SCORE_READY) {
            status = "买入条件较齐备";
            kind = "add-ready";
        } else if (score == SCORE_READY - 1) {
            status = "买入条件部分满足";
            kind = "add-watch";
        } else {
            status = "观望";
            kind = "watch";
        }

        Map<String, Object> details = new LinkedHashMap<>();
        details.put("dev20", dev20);
        details.put("dd60", dd60);
        details.put("rsi", rsi);
        details.put("mfi", mfi);
        details.put("ma20", ma20);
        details.put("ma60", ma60);
        details.put("low60", low60);
        details.put("peak60", peak60);
        details.put("macdHist", hist);
        details.put("macdImproving", macdImproving);
        details.put("obvUp", obvUp);

        return new AddResult(status, kind, score, 4, true, inZone, entry, gapPct, regime,
                regimeLabel(regime), veto, parts, reasons, details);
    }

    public static ExitResult evaluateExit(Double price, List<Bar> bars) {
        if (price == null || price <= 0 || bars == null || bars.size() < MIN_BARS) {
            return new ExitResult("数据不足", "data", false, null, null, null, null, null, null,
                    -1, 0, "", "", List.of("日 K 不足 " + MIN_BARS + " 根，无法计算止盈线"));
        }
        List<Double> closes = closeSeries(bars);
        int last = bars.size() - 1;
        int start = Math.max(0, last - 120);

        boolean armed = false;
        Double peak = null;
        int peakIdx = -1;
        int triggerIdx = -1;
        Double low60 = null;

        for (int i = start; i <= last; i++) {
            if (closes.get(i) == null) {
                continue;
            }
            low60 = lowestClose(closes, i, MIN_BARS);
            if (!armed) {
                if (low60 != null && closes.get(i) >= low60 * EXIT_ARM) {
                    armed = true;
                    peak = closes.get(i);
                    peakIdx = i;
                }
            } else {
                if (closes.get(i) > peak) {
                    peak = closes.get(i);
                    peakIdx = i;
                    triggerIdx = -1;
                } else if (triggerIdx < 0 && closes.get(i) <= peak * (1 - EXIT_TRAIL)) {
                    triggerIdx = i;
                }
            }
        }

        Double armLine = low60 != null ? low60 * EXIT_ARM : null;
        Double exitLine = peak != null ? peak * (1 - EXIT_TRAIL) : null;
        Double drawdown = peak != null && peak != 0 ? (price / peak - 1) * 100 : null;
        Double distanceToExit = exitLine != null && exitLine != 0 ? (price / exitLine - 1) * 100 : null;
        int barsSinceTrigger = triggerIdx >= 0 ? last - triggerIdx : -1;
        int cooldownDays = barsSinceTrigger >= 0 && barsSinceTrigger < EXIT_COOLDOWN
                ? EXIT_COOLDOWN - barsSinceTrigger : 0;

        String state;
        String kind;
        if (!armed) {
            state = "未启动";
            kind = "exit-idle";
        } else if (barsSinceTrigger < 0) {
            state = "跟踪中";
            kind = "exit-armed";
        } else if (barsSinceTrigger <= 2) {
            state = "已触发";
            kind = "exit-triggered";
        } else {
            state = "已离场";
            kind = "exit-closed";
        }

        List<String> reasons = new ArrayList<>();
        if (!armed) {
            reasons.add("未启动：现价 " + String.format("%.2f", price) + "，启动线 "
                    + (armLine == null ? "—" : String.format("%.2f", armLine))
                    + "（近 60 日最低收盘 " + (low60 == null ? "—" : String.format("%.2f", low60)) + " × 1.2）");
        } else {
            reasons.add("已启动：启动线 " + (armLine == null ? "—" : String.format("%.2f", armLine))
                    + "，启动后最高收盘 " + String.format("%.2f", peak)
                    + "（" + (peakIdx >= 0 && peakIdx < bars.size() ? bars.get(peakIdx).time() : "") + "）");
            reasons.add("离场线 " + String.format("%.2f", exitLine) + "（最高收盘 × 0.95），现价距线 "
                    + pctText(distanceToExit));
            if ("已触发".equals(state)) {
                reasons.add("已触发：收盘低于离场线，按规则次日收盘确认后卖出");
            } else if ("已离场".equals(state)) {
                reasons.add("已离场：" + Math.max(barsSinceTrigger, 0) + " 个交易日前触发，本轮跟踪结束"
                        + (cooldownDays > 0 ? "，冷却剩余 " + cooldownDays + " 个交易日" : ""));
            } else {
                reasons.add("跟踪中：回撤 " + (drawdown == null ? "—" : String.format("%.1f", drawdown))
                        + "%，未达 5% 阈值");
            }
        }
        if (triggerIdx >= 0) {
            reasons.add("触发日 " + bars.get(triggerIdx).time() + "，收盘 "
                    + String.format("%.2f", bars.get(triggerIdx).close()));
        }

        return new ExitResult(state, kind, armed, armLine, exitLine, peak, low60, drawdown,
                distanceToExit, barsSinceTrigger, cooldownDays,
                peakIdx >= 0 && peakIdx < bars.size() ? bars.get(peakIdx).time() : "",
                triggerIdx >= 0 ? bars.get(triggerIdx).time() : "", reasons);
    }
}

package com.jiangood.stockhelper.indicator;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 量价指标纯函数，口径与原浏览器实现保持一致；数据不足返回 null，不返回 0。
 */
public final class TechIndicators {

    public static final int MFI_PERIOD = 14;
    public static final int PIVOT_K = 2;
    public static final int DIV_LOOKBACK = 120;
    public static final double DIV_MIN_IND_DIFF = 1.5;
    public static final double VALUE_AREA = 0.7;
    public static final int PROFILE_BINS = 30;
    public static final int PROFILE_LOOKBACK = 120;

    private TechIndicators() {
    }

    public record Series(List<Double> series, Double latest, int period) {
    }

    public record MacdResult(List<Double> dif, List<Double> dea, List<Double> histogram,
                             MacdValue latest, int fast, int slow, int signal) {
    }

    public record MacdValue(double dif, double dea, double histogram) {
    }

    public record Divergence(String type, int barsAgo, int index, double priceFrom, double priceTo,
                             double indFrom, double indTo, double indDelta) {
    }

    public record ProfileBin(double price, double volume) {
    }

    public record VolumeProfile(double poc, double val, double vah, double lo, double hi, double step,
                                int count, List<ProfileBin> bins) {
    }

    private static Double num(Double v) {
        return v == null || !Double.isFinite(v) ? null : v;
    }

    private static Double typical(Bar bar) {
        if (bar == null) {
            return null;
        }
        Double h = num(bar.high());
        Double l = num(bar.low());
        Double c = num(bar.close());
        return h == null || l == null || c == null ? null : (h + l + c) / 3;
    }

    private static double clamp100(double v) {
        return Math.max(0, Math.min(100, v));
    }

    public static Series mfi(List<Bar> bars, Integer requestedPeriod) {
        int p = Math.max(1, requestedPeriod == null ? MFI_PERIOD : requestedPeriod);
        List<Bar> list = bars == null ? List.of() : bars;
        if (list.size() < p + 1) {
            return new Series(List.of(), null, p);
        }
        List<Double> tp = new ArrayList<>(list.size());
        List<Double> flow = new ArrayList<>(list.size());
        for (Bar bar : list) {
            Double typical = typical(bar);
            tp.add(typical);
            Double volume = bar == null ? null : num(bar.volume());
            flow.add(typical == null || volume == null ? null : typical * volume);
        }
        List<Double> series = new ArrayList<>(Collections.nCopies(list.size(), null));
        for (int i = p; i < list.size(); i++) {
            double pos = 0;
            double neg = 0;
            boolean complete = true;
            for (int k = i - p + 1; k <= i; k++) {
                if (tp.get(k) == null || tp.get(k - 1) == null || flow.get(k) == null) {
                    complete = false;
                    break;
                }
                double diff = tp.get(k) - tp.get(k - 1);
                if (diff > 0) {
                    pos += flow.get(k);
                } else if (diff < 0) {
                    neg += flow.get(k);
                }
            }
            if (!complete) {
                continue;
            }
            double value;
            if (neg <= 0) {
                value = pos > 0 ? 100 : 50;
            } else {
                value = clamp100(100 - 100 / (1 + pos / neg));
            }
            series.set(i, value);
        }
        return new Series(series, series.isEmpty() ? null : series.get(series.size() - 1), p);
    }

    public static Series rsi(List<Bar> bars, Integer requestedPeriod) {
        int p = Math.max(1, requestedPeriod == null ? 14 : requestedPeriod);
        List<Bar> list = bars == null ? List.of() : bars;
        List<Double> closes = new ArrayList<>(list.size());
        boolean missing = false;
        for (Bar bar : list) {
            Double value = bar == null ? null : num(bar.close());
            closes.add(value);
            if (value == null) {
                missing = true;
            }
        }
        List<Double> series = new ArrayList<>(Collections.nCopies(list.size(), null));
        if (list.size() <= p || missing) {
            return new Series(series, null, p);
        }
        double gain = 0;
        double loss = 0;
        for (int i = 1; i <= p; i++) {
            double d = closes.get(i) - closes.get(i - 1);
            gain += Math.max(0, d);
            loss += Math.max(0, -d);
        }
        gain /= p;
        loss /= p;
        series.set(p, loss == 0 ? (gain == 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
        for (int i = p + 1; i < closes.size(); i++) {
            double d = closes.get(i) - closes.get(i - 1);
            gain = (gain * (p - 1) + Math.max(0, d)) / p;
            loss = (loss * (p - 1) + Math.max(0, -d)) / p;
            series.set(i, loss == 0 ? (gain == 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
        }
        return new Series(series, series.get(series.size() - 1), p);
    }

    public static MacdResult macd(List<Bar> bars, Integer fast, Integer slow, Integer signal) {
        int f = Math.max(1, fast == null ? 12 : fast);
        int s = Math.max(f + 1, slow == null ? 26 : slow);
        int sig = Math.max(1, signal == null ? 9 : signal);
        List<Bar> list = bars == null ? List.of() : bars;
        List<Double> closes = new ArrayList<>(list.size());
        boolean missing = false;
        for (Bar bar : list) {
            Double value = bar == null ? null : num(bar.close());
            closes.add(value);
            if (value == null) {
                missing = true;
            }
        }
        List<Double> dif = new ArrayList<>(Collections.nCopies(list.size(), null));
        List<Double> dea = new ArrayList<>(Collections.nCopies(list.size(), null));
        List<Double> histogram = new ArrayList<>(Collections.nCopies(list.size(), null));
        if (list.size() < s + sig - 1 || missing) {
            return new MacdResult(dif, dea, histogram, null, f, s, sig);
        }
        List<Double> fastEma = ema(closes, f);
        List<Double> slowEma = ema(closes, s);
        for (int i = s - 1; i < list.size(); i++) {
            dif.set(i, fastEma.get(i) - slowEma.get(i));
        }
        int first = -1;
        for (int i = 0; i < dif.size(); i++) {
            if (dif.get(i) != null) {
                first = i;
                break;
            }
        }
        List<Double> compact = new ArrayList<>();
        for (int i = first; i < dif.size(); i++) {
            compact.add(dif.get(i) == null ? 0.0 : dif.get(i));
        }
        List<Double> signalEma = ema(compact, sig);
        for (int i = first; i < list.size(); i++) {
            Double v = signalEma.get(i - first);
            if (v == null) {
                continue;
            }
            dea.set(i, v);
            histogram.set(i, 2 * (dif.get(i) - v));
        }
        int last = list.size() - 1;
        MacdValue latest = dif.get(last) == null || dea.get(last) == null
                ? null : new MacdValue(dif.get(last), dea.get(last), histogram.get(last));
        return new MacdResult(dif, dea, histogram, latest, f, s, sig);
    }

    private static List<Double> ema(List<Double> values, int period) {
        List<Double> out = new ArrayList<>(Collections.nCopies(values.size(), null));
        if (values.size() < period) {
            return out;
        }
        double seed = 0;
        for (int i = 0; i < period; i++) {
            seed += values.get(i);
        }
        double prev = seed / period;
        out.set(period - 1, prev);
        double alpha = 2.0 / (period + 1);
        for (int i = period; i < values.size(); i++) {
            prev = values.get(i) * alpha + prev * (1 - alpha);
            out.set(i, prev);
        }
        return out;
    }

    public static Series obv(List<Bar> bars) {
        List<Bar> list = bars == null ? List.of() : bars;
        if (list.size() < 2) {
            return new Series(List.of(), null, 0);
        }
        List<Double> series = new ArrayList<>(Collections.nCopies(list.size(), null));
        double acc = 0;
        series.set(0, 0.0);
        for (int i = 1; i < list.size(); i++) {
            Double c = num(list.get(i).close());
            Double prev = num(list.get(i - 1).close());
            Double v = num(list.get(i).volume());
            if (c == null || prev == null) {
                continue;
            }
            double vol = v == null ? 0 : v;
            if (c > prev) {
                acc += vol;
            } else if (c < prev) {
                acc -= vol;
            }
            series.set(i, acc);
        }
        return new Series(series, series.get(series.size() - 1), 0);
    }

    public static Series adLine(List<Bar> bars) {
        List<Bar> list = bars == null ? List.of() : bars;
        if (list.isEmpty()) {
            return new Series(List.of(), null, 0);
        }
        List<Double> series = new ArrayList<>(Collections.nCopies(list.size(), null));
        double acc = 0;
        for (int i = 0; i < list.size(); i++) {
            Bar bar = list.get(i);
            Double h = num(bar.high());
            Double l = num(bar.low());
            Double c = num(bar.close());
            Double v = num(bar.volume());
            if (h == null || l == null || c == null || v == null) {
                continue;
            }
            double mfm = h > l ? ((c - l) - (h - c)) / (h - l) : 0;
            acc += mfm * v;
            series.set(i, acc);
        }
        return new Series(series, series.get(series.size() - 1), 0);
    }

    public static Series ma(List<Bar> bars, Integer requestedPeriod) {
        int period = Math.max(1, requestedPeriod == null ? 20 : requestedPeriod);
        List<Bar> list = bars == null ? List.of() : bars;
        List<Double> closes = new ArrayList<>(list.size());
        for (Bar bar : list) {
            closes.add(bar == null ? null : num(bar.close()));
        }
        List<Double> series = new ArrayList<>(Collections.nCopies(closes.size(), null));
        if (closes.size() < period) {
            return new Series(series, null, period);
        }
        double sum = 0;
        int count = 0;
        for (int i = 0; i < closes.size(); i++) {
            Double v = closes.get(i);
            if (v != null) {
                sum += v;
                count++;
            }
            if (i >= period) {
                Double old = closes.get(i - period);
                if (old != null) {
                    sum -= old;
                    count--;
                }
            }
            if (i >= period - 1 && count == period) {
                series.set(i, sum / period);
            }
        }
        return new Series(series, series.get(series.size() - 1), period);
    }

    private static List<Integer> pivots(List<Double> series, int k, boolean low) {
        List<Double> list = series == null ? List.of() : series;
        int w = Math.max(1, k);
        List<Integer> out = new ArrayList<>();
        for (int i = w; i < list.size() - w; i++) {
            Double v = num(list.get(i));
            if (v == null) {
                continue;
            }
            boolean ok = true;
            boolean strict = false;
            for (int j = i - w; j <= i + w; j++) {
                if (j == i) {
                    continue;
                }
                Double x = num(list.get(j));
                if (x == null) {
                    continue;
                }
                if (low ? x < v : x > v) {
                    ok = false;
                    break;
                }
                if (low ? x > v : x < v) {
                    strict = true;
                }
            }
            if (ok && strict) {
                out.add(i);
            }
        }
        return out;
    }

    public static List<Integer> pivotLows(List<Double> series, Integer k) {
        return pivots(series, k == null ? PIVOT_K : k, true);
    }

    public static List<Integer> pivotHighs(List<Double> series, Integer k) {
        return pivots(series, k == null ? PIVOT_K : k, false);
    }

    /**
     * 价格与指标背离：扫描窗口内所有相邻枢轴对，返回最近一次有效背离。
     */
    public static Divergence detectDivergence(List<Bar> priceBars, List<Double> indicator,
                                              Integer kOpt, Integer lookbackOpt, Double minIndDiffOpt) {
        List<Double> p = new ArrayList<>();
        if (priceBars != null) {
            for (Bar bar : priceBars) {
                p.add(bar == null ? null : num(bar.close()));
            }
        }
        List<Double> x = new ArrayList<>();
        if (indicator != null) {
            for (Double value : indicator) {
                x.add(num(value));
            }
        }
        int n = Math.min(p.size(), x.size());
        if (n < 5) {
            return null;
        }
        int k = kOpt == null ? PIVOT_K : Math.max(1, kOpt);
        int lookback = Math.max(k * 4, lookbackOpt == null ? DIV_LOOKBACK : lookbackOpt);
        double minDiff = minIndDiffOpt == null ? DIV_MIN_IND_DIFF : minIndDiffOpt;
        int from = Math.max(0, n - lookback);

        List<Double> ps = new ArrayList<>(p.subList(0, n));
        List<Double> xs = new ArrayList<>(x.subList(0, n));

        List<Integer> lows = new ArrayList<>();
        for (Integer i : pivotLows(ps, k)) {
            if (i >= from && ps.get(i) != null && xs.get(i) != null) {
                lows.add(i);
            }
        }
        List<Integer> highs = new ArrayList<>();
        for (Integer i : pivotHighs(ps, k)) {
            if (i >= from && ps.get(i) != null && xs.get(i) != null) {
                highs.add(i);
            }
        }

        List<Divergence> candidates = new ArrayList<>();
        for (int j = 1; j < lows.size(); j++) {
            int i1 = lows.get(j - 1);
            int i2 = lows.get(j);
            double dInd = xs.get(i2) - xs.get(i1);
            if (ps.get(i2) < ps.get(i1) && dInd >= minDiff) {
                candidates.add(new Divergence("bottom", n - 1 - i2, i2, ps.get(i1), ps.get(i2),
                        xs.get(i1), xs.get(i2), dInd));
            }
        }
        for (int j = 1; j < highs.size(); j++) {
            int i1 = highs.get(j - 1);
            int i2 = highs.get(j);
            double dInd = xs.get(i1) - xs.get(i2);
            if (ps.get(i2) > ps.get(i1) && dInd >= minDiff) {
                candidates.add(new Divergence("top", n - 1 - i2, i2, ps.get(i1), ps.get(i2),
                        xs.get(i1), xs.get(i2), dInd));
            }
        }
        if (candidates.isEmpty()) {
            return null;
        }
        candidates.sort((a, b) -> Integer.compare(b.index(), a.index()));
        return candidates.get(0);
    }

    public record VolumeProfileOptions(Integer bins, Integer lookback, Double valueArea) {
    }

    public static VolumeProfile volumeProfile(List<Bar> bars) {
        return volumeProfile(bars, PROFILE_BINS, PROFILE_LOOKBACK, VALUE_AREA);
    }

    public static VolumeProfile volumeProfile(List<Bar> bars, int bins, int lookback, double valueArea) {
        List<Bar> list = bars == null ? List.of() : bars;
        int from = Math.max(0, list.size() - Math.max(1, lookback));
        List<Bar> rows = new ArrayList<>();
        for (int i = from; i < list.size(); i++) {
            Bar bar = list.get(i);
            if (bar == null) {
                continue;
            }
            Double low = num(bar.low());
            Double high = num(bar.high());
            if (low != null && high != null && high >= low) {
                rows.add(bar);
            }
        }
        if (rows.size() < 2) {
            return null;
        }
        int binCount = Math.max(3, bins);
        double lo = Double.MAX_VALUE;
        double hi = -Double.MAX_VALUE;
        for (Bar bar : rows) {
            lo = Math.min(lo, num(bar.low()));
            hi = Math.max(hi, num(bar.high()));
        }
        if (!(hi > lo)) {
            return null;
        }
        double step = (hi - lo) / binCount;
        double[] vols = new double[binCount];
        double total = 0;
        for (Bar bar : rows) {
            double l = num(bar.low());
            double h = num(bar.high());
            Double volumeValue = num(bar.volume());
            double v = volumeValue == null ? 0 : volumeValue;
            int a = (int) Math.floor((l - lo) / step);
            int c = (int) Math.floor((h - lo) / step);
            a = Math.max(0, Math.min(binCount - 1, a));
            c = Math.max(0, Math.min(binCount - 1, c));
            if (c < a) {
                int t = a;
                a = c;
                c = t;
            }
            double per = v / (c - a + 1);
            for (int i = a; i <= c; i++) {
                vols[i] += per;
            }
            total += v;
        }
        if (total <= 0) {
            for (Bar bar : rows) {
                double l = num(bar.low());
                double h = num(bar.high());
                int a = Math.max(0, Math.min(binCount - 1, (int) Math.floor((l - lo) / step)));
                int c = Math.max(0, Math.min(binCount - 1, (int) Math.floor((h - lo) / step)));
                if (c < a) {
                    int t = a;
                    a = c;
                    c = t;
                }
                double per = 1.0 / (c - a + 1);
                for (int i = a; i <= c; i++) {
                    vols[i] += per;
                }
                total += 1;
            }
        }
        int pocIdx = 0;
        for (int i = 1; i < binCount; i++) {
            if (vols[i] > vols[pocIdx]) {
                pocIdx = i;
            }
        }
        double target = total * valueArea;
        int left = pocIdx;
        int right = pocIdx;
        double acc = vols[pocIdx];
        while (acc < target && (left > 0 || right < binCount - 1)) {
            double lv = left > 0 ? vols[left - 1] : -1;
            double rv = right < binCount - 1 ? vols[right + 1] : -1;
            if (lv >= rv) {
                left--;
                acc += vols[left];
            } else {
                right++;
                acc += vols[right];
            }
        }
        List<ProfileBin> binsList = new ArrayList<>();
        for (int i = 0; i < binCount; i++) {
            binsList.add(new ProfileBin(lo + (i + 0.5) * step, vols[i]));
        }
        return new VolumeProfile(lo + (pocIdx + 0.5) * step, lo + left * step,
                lo + (right + 1) * step, lo, hi, step, rows.size(), binsList);
    }

    public static Double volumeRatio(List<Bar> bars, Integer recentOpt, Integer baseOpt) {
        List<Bar> list = bars == null ? List.of() : bars;
        int r = Math.max(1, recentOpt == null ? 3 : recentOpt);
        int b = Math.max(1, baseOpt == null ? 12 : baseOpt);
        if (list.size() < r + b) {
            return null;
        }
        Double a = averageVolume(list.subList(list.size() - r, list.size()));
        Double p = averageVolume(list.subList(list.size() - (r + b), list.size() - r));
        if (a == null || p == null || p <= 0) {
            return null;
        }
        return a / p;
    }

    private static Double averageVolume(List<Bar> bars) {
        double sum = 0;
        int count = 0;
        for (Bar bar : bars) {
            Double v = bar == null ? null : num(bar.volume());
            if (v != null) {
                sum += v;
                count++;
            }
        }
        return count == 0 ? null : sum / count;
    }
}

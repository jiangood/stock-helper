package com.jiangood.stockhelper.indicator;

/**
 * 单根 K 线。time 为 yyyy-MM-dd；缺失字段允许为 null。
 */
public record Bar(String time, Double open, Double close, Double high, Double low, Double volume) {

    public static Bar of(String time, Double open, Double close, Double high, Double low, Double volume) {
        return new Bar(time, open, close, high, low, volume);
    }

    public boolean complete() {
        return open != null && open > 0 && close != null && close > 0
                && high != null && high > 0 && low != null && low > 0;
    }
}

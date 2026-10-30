package com.jiangood.stockhelper.indicator;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TradeSignalCalculatorTest {

    private static List<Bar> bars(List<Double> series) {
        List<Bar> bars = new ArrayList<>();
        for (int i = 0; i < series.size(); i++) {
            double close = series.get(i);
            bars.add(new Bar("2026-01-" + String.format("%02d", i + 1), close, close,
                    close * 1.01, close * 0.99, 1000.0 + i));
        }
        return bars;
    }

    @Test
    void addScoreHasFourPartsAndRequiresPriceBelowEntry() {
        List<Double> series = new ArrayList<>();
        for (int i = 0; i < 120; i++) {
            series.add(20 + i * 0.02);
        }
        List<Bar> list = bars(series);
        double price = list.get(list.size() - 1).close();

        TradeSignalCalculator.AddResult above = TradeSignalCalculator.evaluateAdd(price, price - 1, list);
        assertEquals(4, above.scoreMax());
        assertFalse(above.inZone());
        assertEquals("高于入场价", above.status());
        assertTrue(above.reasons().get(0).contains("不追高"));

        TradeSignalCalculator.AddResult inside = TradeSignalCalculator.evaluateAdd(price, price + 1, list);
        assertTrue(inside.inZone());
        assertTrue(inside.score() >= 0 && inside.score() <= 4);
        assertTrue(inside.reasons().stream().anyMatch(r -> r.contains("RSI(14)")));
        assertTrue(inside.reasons().stream().anyMatch(r -> r.contains("MFI(14)")));
        assertTrue(inside.reasons().stream().anyMatch(r -> r.contains("动能")));
        assertTrue(inside.reasons().stream().anyMatch(r -> r.contains("超跌深度")));
    }

    @Test
    void missingEntryProducesNoBuySignal() {
        List<Double> series = new ArrayList<>();
        for (int i = 0; i < 120; i++) {
            series.add(10 + Math.sin(i / 4.0));
        }
        List<Bar> list = bars(series);
        TradeSignalCalculator.AddResult result = TradeSignalCalculator.evaluateAdd(
                list.get(list.size() - 1).close(), 0.0, list);
        assertFalse(result.inZone());
        assertEquals("未配置入场价", result.status());
        assertTrue(result.reasons().get(0).contains("未配置"));
    }

    @Test
    void downTrendWithLowMfiIsVetoed() {
        List<Double> series = new ArrayList<>();
        for (int i = 0; i < 120; i++) {
            series.add(30 - i * 0.12);
        }
        List<Bar> list = bars(series);
        TradeSignalCalculator.AddResult result = TradeSignalCalculator.evaluateAdd(
                list.get(list.size() - 1).close(), 40.0, list);
        assertEquals("down", result.regime());
        assertTrue(result.veto());
        assertEquals("观望 · 资金流出", result.status());
        assertTrue(result.reasons().stream().anyMatch(r -> r.contains("一票否决")));
    }

    @Test
    void exitArmsAndTriggers() {
        List<Double> series = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            series.add(10.0);
        }
        series.addAll(List.of(10.5, 11.0, 11.5, 12.0, 12.5, 13.0));
        series.addAll(List.of(12.8, 12.3));
        List<Bar> list = bars(series);
        TradeSignalCalculator.ExitResult result = TradeSignalCalculator.evaluateExit(
                list.get(list.size() - 1).close(), list);
        assertTrue(result.armed());
        assertEquals(13.0, result.peak());
        assertEquals(12.35, result.exitLine(), 1e-9);
        assertEquals("已触发", result.state());
        assertEquals(list.get(list.size() - 1).time(), result.triggerDate());
        assertEquals(60, result.cooldownDays());
    }

    @Test
    void exitIdleBeforeArmLine() {
        List<Double> series = new ArrayList<>();
        for (int i = 0; i < 80; i++) {
            series.add(10 + (i % 5) * 0.1);
        }
        List<Bar> list = bars(series);
        TradeSignalCalculator.ExitResult result = TradeSignalCalculator.evaluateExit(
                list.get(list.size() - 1).close(), list);
        assertFalse(result.armed());
        assertEquals("未启动", result.state());
        assertNull(result.exitLine());
        assertEquals(0, result.cooldownDays());
    }

    @Test
    void exitClosedAfterCooldownStarts() {
        List<Double> series = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            series.add(10.0);
        }
        series.addAll(List.of(10.5, 11.0, 11.5, 12.0, 12.5, 13.0));
        series.addAll(List.of(12.8, 12.3, 12.2, 12.1, 12.0, 11.9));
        List<Bar> list = bars(series);
        TradeSignalCalculator.ExitResult result = TradeSignalCalculator.evaluateExit(
                list.get(list.size() - 1).close(), list);
        assertEquals("已离场", result.state());
        assertEquals(4, result.barsSinceTrigger());
        assertEquals(56, result.cooldownDays());
    }

    @Test
    void exitResetsAfterNewHigh() {
        List<Double> series = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            series.add(10.0);
        }
        series.addAll(List.of(10.5, 11.0, 11.5, 12.0, 12.5, 13.0));
        series.addAll(List.of(12.8, 12.4));
        series.addAll(List.of(13.2, 13.6));
        List<Bar> list = bars(series);
        TradeSignalCalculator.ExitResult result = TradeSignalCalculator.evaluateExit(
                list.get(list.size() - 1).close(), list);
        assertEquals(13.6, result.peak());
        assertEquals("跟踪中", result.state());
        assertEquals("", result.triggerDate());
    }
}

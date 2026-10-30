package com.jiangood.stockhelper.indicator;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ResearchScoreCalculatorTest {

    private static List<Bar> monthlyBars(List<Double> closes, List<Double> volumes) {
        List<Bar> bars = new ArrayList<>();
        for (int i = 0; i < closes.size(); i++) {
            double close = closes.get(i);
            String time = (2020 + i / 12) + "-" + String.format("%02d", i % 12 + 1) + "-01";
            bars.add(new Bar(time, close, close, close * 1.05, close * 0.95,
                    volumes == null ? 1000.0 : volumes.get(i)));
        }
        return bars;
    }

    @Test
    void ownerScores() {
        assertEquals(10.0, ResearchScoreCalculator.scoreOwner("central"));
        assertEquals(9.5, ResearchScoreCalculator.scoreOwner("province"));
        assertEquals(7.5, ResearchScoreCalculator.scoreOwner("city"));
        assertEquals(5.5, ResearchScoreCalculator.scoreOwner("other"));
        assertNull(ResearchScoreCalculator.scoreOwner(null));
        assertNull(ResearchScoreCalculator.scoreOwner("unknown-type"));
    }

    @Test
    void focusScores() {
        assertEquals(10.0, ResearchScoreCalculator.scoreFocus(1.0));
        assertEquals(9.0, ResearchScoreCalculator.scoreFocus(0.75));
        assertEquals(4.5, ResearchScoreCalculator.scoreFocus(0.3));
        assertEquals(2.0, ResearchScoreCalculator.scoreFocus(0.05));
        assertNull(ResearchScoreCalculator.scoreFocus(null));
        assertNull(ResearchScoreCalculator.scoreFocus(1.4));
    }

    @Test
    void profitScoresAndAsOfTruncation() {
        List<ResearchScoreCalculator.Annual> annual = List.of(
                new ResearchScoreCalculator.Annual("2025-12-31", 120.0, 5e8),
                new ResearchScoreCalculator.Annual("2024-12-31", 150.0, 3e8),
                new ResearchScoreCalculator.Annual("2023-12-31", 10.0, 2e8));
        assertEquals(10.0, ResearchScoreCalculator.scoreProfit(annual, null).get("score"));
        assertEquals(8.5, ResearchScoreCalculator.scoreProfit(annual, "2025-06-30").get("score"));
        assertEquals(5.5, ResearchScoreCalculator.scoreProfit(annual, "2024-06-30").get("score"));

        assertEquals(2.0, ResearchScoreCalculator.scoreProfit(List.of(
                new ResearchScoreCalculator.Annual("2025-12-31", -80.0, -1e8)), null).get("score"));
        assertEquals(7.5, ResearchScoreCalculator.scoreProfit(List.of(
                new ResearchScoreCalculator.Annual("2025-12-31", 80.0, 1e8)), null).get("score"));
        assertEquals(6.0, ResearchScoreCalculator.scoreProfit(List.of(
                new ResearchScoreCalculator.Annual("2025-12-31", 30.0, 1e8)), null).get("score"));
        assertEquals(5.5, ResearchScoreCalculator.scoreProfit(List.of(
                new ResearchScoreCalculator.Annual("2025-12-31", 5.0, 1e8)), null).get("score"));
        assertEquals(4.5, ResearchScoreCalculator.scoreProfit(List.of(
                new ResearchScoreCalculator.Annual("2025-12-31", -10.0, 1e8)), null).get("score"));
        assertEquals(3.0, ResearchScoreCalculator.scoreProfit(List.of(
                new ResearchScoreCalculator.Annual("2025-12-31", -60.0, 1e8)), null).get("score"));
        assertNull(ResearchScoreCalculator.scoreProfit(List.of(), null).get("score"));
    }

    @Test
    void capScores() {
        assertEquals(10.0, ResearchScoreCalculator.scoreCap(50e8));
        assertEquals(10.0, ResearchScoreCalculator.scoreCap(100e8));
        assertEquals(6.5, ResearchScoreCalculator.scoreCap(150e8));
        assertEquals(6.5, ResearchScoreCalculator.scoreCap(200e8));
        assertTrue(ResearchScoreCalculator.scoreCap(600e8) < 6.5);
        assertTrue(ResearchScoreCalculator.scoreCap(600e8) > 4);
        assertTrue(ResearchScoreCalculator.scoreCap(20000e8) >= 3);
        assertNull(ResearchScoreCalculator.scoreCap(null));
    }

    @Test
    void consolidationPrefersFlatLongBase() {
        List<Double> flatCloses = new ArrayList<>();
        List<Double> trendCloses = new ArrayList<>();
        for (int i = 0; i < 36; i++) {
            flatCloses.add(10 + Math.sin(i) * 0.3);
            trendCloses.add(5 + i * 0.6);
        }
        Double flat = ResearchScoreCalculator.scoreConsolidation(monthlyBars(flatCloses, null)).score();
        Double trend = ResearchScoreCalculator.scoreConsolidation(monthlyBars(trendCloses, null)).score();
        assertTrue(flat > trend);
        assertTrue(flat <= 9 && flat >= 4);
    }

    @Test
    void bottomPrefersLowPosition() {
        List<Double> closes = new ArrayList<>();
        for (int i = 0; i < 120; i++) {
            closes.add(10 + i * 0.5);
        }
        ResearchScoreCalculator.ItemResult low = ResearchScoreCalculator.scoreBottom(
                monthlyBars(closes, null), 10.0, 12.0, 9.0);
        ResearchScoreCalculator.ItemResult high = ResearchScoreCalculator.scoreBottom(
                monthlyBars(closes, null), 69.0, 70.0, 60.0);
        assertTrue(low.score() > high.score());
        assertTrue((Double) low.metrics().get("position") < (Double) high.metrics().get("position"));
    }

    @Test
    void volumePrefersRecentExpansionAndDropsPartialMonth() {
        List<Double> closes = new ArrayList<>();
        List<Double> volumes = new ArrayList<>();
        for (int i = 0; i < 42; i++) {
            closes.add(10 + i * 0.01);
            volumes.add(i >= 36 ? 3000.0 : 1000.0);
        }
        List<Bar> bars = monthlyBars(closes, volumes);
        bars.add(new Bar("2026-10-01", 10.0, 10.0, 10.0, 10.0, 10.0));
        ResearchScoreCalculator.ItemResult result = ResearchScoreCalculator.scoreVolume(bars, List.of(), "2026-10-29");
        assertTrue(result.score() > 7);
        assertTrue((Double) result.metrics().get("volRatio") > 2.5);
    }

    @Test
    void computeProducesSevenItemsAndBand() {
        List<Double> closes = new ArrayList<>();
        List<Double> volumes = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            closes.add(8 + Math.sin(i / 3.0));
            volumes.add(1000.0);
        }
        List<ResearchScoreCalculator.Annual> annual = List.of(
                new ResearchScoreCalculator.Annual("2025-12-31", 120.0, 5e8),
                new ResearchScoreCalculator.Annual("2024-12-31", 150.0, 3e8));
        ResearchScoreCalculator.Result full = ResearchScoreCalculator.compute(
                new ResearchScoreCalculator.Input(60e8, monthlyBars(closes, volumes), List.of(), List.of(),
                        8.0, 12.0, 7.0, "central", 0.9, annual, null));
        assertEquals(65.0, full.totalMax());
        assertEquals(65.0, full.max());
        assertTrue(full.complete());
        assertTrue(full.points() > 0 && full.points() <= 65);
        assertTrue(full.percent() > 0 && full.percent() <= 100);
        assertEquals(Math.round(full.points() / 65 * 1000) / 10.0, full.percent());
        assertNotNull(full.band());

        ResearchScoreCalculator.Result partial = ResearchScoreCalculator.compute(
                new ResearchScoreCalculator.Input(60e8, null, null, null, null, null, null,
                        null, null, null, null));
        assertEquals(10.0, partial.items().get("cap"));
        assertNull(partial.items().get("owner"));
        assertNull(partial.items().get("consolidation"));
        assertEquals(8.0, partial.max());
        assertFalse(partial.complete());
        assertNull(partial.percent());
        assertNull(partial.band());

        ResearchScoreCalculator.Result empty = ResearchScoreCalculator.compute(
                new ResearchScoreCalculator.Input(null, null, null, null, null, null, null,
                        null, null, null, null));
        assertNull(empty.points());
        assertNull(empty.percent());
    }

    @Test
    void deriveMonthlyFromWeekly() {
        List<Bar> weekly = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            String time = (2019 + i / 52) + "-" + String.format("%02d", (i % 52) / 4 + 1) + "-15";
            weekly.add(new Bar(time, 10.0, 10 + i * 0.1, 11.0, 9.0, 100.0));
        }
        List<Bar> months = ResearchScoreCalculator.deriveMonthly(weekly);
        assertTrue(months.size() >= 12);
        assertTrue(months.size() < weekly.size());
        ResearchScoreCalculator.Result result = ResearchScoreCalculator.compute(
                new ResearchScoreCalculator.Input(60e8, null, weekly, null, 15.0, 16.0, 9.0,
                        null, null, null, null));
        assertNotNull(result.items().get("consolidation"));
    }

    @Test
    void bandLabels() {
        assertEquals("good", ResearchScoreCalculator.bandOf(80.0));
        assertEquals("mid", ResearchScoreCalculator.bandOf(60.0));
        assertEquals("high", ResearchScoreCalculator.bandOf(40.0));
        assertEquals("位置优秀", ResearchScoreCalculator.bandLabel("good"));
    }
}

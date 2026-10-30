package com.jiangood.stockhelper.indicator;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TechIndicatorsTest {

    private static List<Bar> barsFromPrices(List<Double> prices, List<Double> volumes) {
        List<Bar> bars = new ArrayList<>();
        for (int i = 0; i < prices.size(); i++) {
            double price = prices.get(i);
            double volume = volumes == null || i >= volumes.size() ? 1 : volumes.get(i);
            bars.add(new Bar("2026-01-01", price, price, price, price, volume));
        }
        return bars;
    }

    @Test
    void mfiUsesExactlyPeriodPriceChanges() {
        TechIndicators.Series result = TechIndicators.mfi(
                barsFromPrices(List.of(10.0, 11.0, 10.0, 12.0), null), 2);
        assertEquals(2, result.period());
        assertEquals(4, result.series().size());
        assertNull(result.series().get(0));
        assertNull(result.series().get(1));
        assertEquals(100 * 11.0 / 21, result.series().get(2), 1e-10);
        assertEquals(100 * 12.0 / 22, result.series().get(3), 1e-10);
        assertEquals(result.series().get(3), result.latest());
    }

    @Test
    void mfiEdgeCases() {
        assertEquals(100.0, TechIndicators.mfi(
                barsFromPrices(List.of(10.0, 11.0, 12.0, 13.0), null), 2).latest());
        assertEquals(50.0, TechIndicators.mfi(
                barsFromPrices(List.of(10.0, 10.0, 10.0, 10.0), null), 2).latest());
        TechIndicators.Series shortSeries = TechIndicators.mfi(
                barsFromPrices(List.of(10.0, 11.0), null), 2);
        assertNull(shortSeries.latest());
        assertTrue(shortSeries.series().isEmpty());
    }

    @Test
    void rsiUsesWilderSmoothing() {
        List<Double> flat = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            flat.add(10.0);
        }
        assertEquals(50.0, TechIndicators.rsi(barsFromPrices(flat, null), 14).latest());
        List<Double> rising = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            rising.add(10.0 + i);
        }
        assertEquals(100.0, TechIndicators.rsi(barsFromPrices(rising, null), 14).latest());
        assertNull(TechIndicators.rsi(barsFromPrices(List.of(10.0, 11.0, 12.0), null), 14).latest());
    }

    @Test
    void macdHasValuesAfterEnoughBars() {
        List<Double> prices = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            prices.add(10 + i * 0.2 + Math.sin(i / 3.0));
        }
        TechIndicators.MacdResult result = TechIndicators.macd(barsFromPrices(prices, null), 12, 26, 9);
        assertNotNull(result.latest());
        assertTrue(Double.isFinite(result.latest().dif()));
        assertTrue(Double.isFinite(result.latest().dea()));
        assertTrue(Double.isFinite(result.latest().histogram()));
        assertNull(TechIndicators.macd(barsFromPrices(List.of(10.0, 11.0, 12.0), null), 12, 26, 9).latest());
    }

    @Test
    void volumeProfileAndDivergenceReturnNullWhenDataIsInsufficient() {
        assertNull(TechIndicators.volumeProfile(List.of()));
        assertNull(TechIndicators.detectDivergence(List.of(), List.of(), null, null, null));
        assertEquals(2.0, TechIndicators.volumeRatio(
                barsFromPrices(List.of(1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                        1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0),
                        List.of(1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                                1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0)), 3, 12), 0.0001);
    }
}

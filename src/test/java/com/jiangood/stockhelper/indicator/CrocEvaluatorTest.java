package com.jiangood.stockhelper.indicator;

import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.domain.StockQuote;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CrocEvaluatorTest {

    private static Stock stock(String name, String code, Double entry, Double heavy) {
        Stock stock = new Stock();
        stock.setName(name);
        stock.setCode(code);
        stock.setEntry(entry);
        stock.setHeavy(heavy);
        return stock;
    }

    private static StockQuote quote(double price, double pe, double pb, double cap) {
        StockQuote quote = new StockQuote();
        quote.setPrice(price);
        quote.setPe(pe);
        quote.setPb(pb);
        quote.setTotalCap(cap);
        return quote;
    }

    @Test
    void capBoundaryIsConsistent() {
        Stock stock = stock("测试股", "sz000001", 5.0, 4.0);
        StockQuote quote = quote(5, 10, 0.9, 2e10);
        assertTrue(CrocEvaluator.evaluate(stock, quote).smallCap());
        CrocEvaluator.Check cap = CrocEvaluator.screen(stock, quote).checks().stream()
                .filter(c -> "cap".equals(c.key())).findFirst().orElseThrow();
        assertTrue(cap.ok());
    }

    @Test
    void stCannotPassScreen() {
        CrocEvaluator.Screen screen = CrocEvaluator.screen(
                stock("ST 测试股", "sz000001", null, null), quote(5, 10, 0.9, 2e10));
        assertFalse(screen.allPass());
        assertTrue(screen.failed().stream().anyMatch(c -> "st".equals(c.key())));
    }

    @Test
    void lossCannotPassScreen() {
        CrocEvaluator.Screen screen = CrocEvaluator.screen(
                stock("测试亏损股", "sz000001", null, null), quote(5, -3, 0.9, 2e10));
        assertFalse(screen.allPass());
        assertTrue(screen.failed().stream().anyMatch(c -> "loss".equals(c.key())));
    }

    @Test
    void buyEligibilityGate() {
        assertFalse(CrocEvaluator.buyEligibility(stock("ST 测试股", null, null, null),
                quote(5, 8, 1, 1e10)).eligible());
        assertTrue(CrocEvaluator.buyEligibility(stock("测试亏损股", null, null, null),
                quote(5, -1, 1, 1e10)).reason().contains("亏损"));
        assertTrue(CrocEvaluator.buyEligibility(stock("盈利未知股", null, null, null),
                new StockQuote()).reason().contains("缺失"));
        assertTrue(CrocEvaluator.buyEligibility(stock("正常测试股", null, null, null),
                quote(5, 8, 1, 1e10)).eligible());
    }

    @Test
    void screenBuyExcludesStAndUnknownProfit() {
        StockQuote quote = quote(4, 10, 0.8, 1e10);
        assertFalse(CrocEvaluator.matchStatus(stock("ST 测试股", "sz000001", 5.0, 4.0), quote, "screenbuy"));
        StockQuote unknown = quote(4, 10, 0.8, 1e10);
        unknown.setPe(null);
        assertFalse(CrocEvaluator.matchStatus(stock("未知盈利股", "sz000002", 5.0, 4.0), unknown, "screenbuy"));
    }

    @Test
    void limitUpInfoCountsConsecutiveBoards() {
        java.util.List<Bar> bars = java.util.List.of(
                new Bar("2026-01-01", 10.0, 10.0, 10.0, 10.0, 1.0),
                new Bar("2026-01-02", 10.0, 11.0, 11.0, 10.0, 1.0),
                new Bar("2026-01-03", 11.0, 12.1, 12.1, 11.0, 1.0));
        CrocEvaluator.LimitUpInfo info = CrocEvaluator.limitUpInfo(bars, "sz000001", "测试股");
        assertEquals(2, info.count());
        assertEquals(10.0, info.pct());
        assertEquals(12.1, info.limitPrice());
    }

    @Test
    void percentileUsesInclusiveRank() {
        assertEquals(50.0, CrocEvaluator.percentile(java.util.List.of(1.0, 2.0, 3.0, 4.0), 2.5));
        assertEquals(null, CrocEvaluator.percentile(java.util.List.of(), 1.0));
    }
}

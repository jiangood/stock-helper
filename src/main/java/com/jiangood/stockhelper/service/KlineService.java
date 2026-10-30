package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.StockKline;
import com.jiangood.stockhelper.indicator.Bar;
import com.jiangood.stockhelper.repository.StockKlineRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class KlineService {

    private final StockKlineRepository repository;

    public List<Bar> bars(String code, String period, String adjust) {
        List<StockKline> rows = repository.findByCodeAndPeriodAndAdjustOrderByTradeDateAsc(code, period, adjust);
        return toBars(rows);
    }

    public List<Bar> bars(String code, String period, String adjust, int lastCount) {
        List<Bar> bars = bars(code, period, adjust);
        if (lastCount <= 0 || bars.size() <= lastCount) {
            return bars;
        }
        return new ArrayList<>(bars.subList(bars.size() - lastCount, bars.size()));
    }

    public static List<Bar> toBars(List<StockKline> rows) {
        List<Bar> bars = new ArrayList<>(rows.size());
        for (StockKline row : rows) {
            bars.add(new Bar(row.getTradeDate() == null ? "" : row.getTradeDate().toString(),
                    row.getOpen(), row.getClose(), row.getHigh(), row.getLow(), row.getVolume()));
        }
        return bars;
    }
}

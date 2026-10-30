package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.StockKline;
import io.github.jiangood.openadmin.framework.data.BaseRepository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface StockKlineRepository extends BaseRepository<StockKline, String> {

    List<StockKline> findByCodeAndPeriodAndAdjustOrderByTradeDateAsc(String code, String period, String adjust);

    List<StockKline> findByCodeAndPeriodAndAdjustAndTradeDateGreaterThanEqualOrderByTradeDateAsc(
            String code, String period, String adjust, LocalDate from);

    Optional<StockKline> findByCodeAndPeriodAndAdjustAndTradeDate(String code, String period, String adjust, LocalDate tradeDate);

    @Transactional
    void deleteByCodeAndPeriodAndAdjust(String code, String period, String adjust);

    List<StockKline> findByPeriodAndAdjust(String period, String adjust);
}

package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.Stock;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.List;
import java.util.Optional;

public interface StockRepository extends BaseRepository<Stock, String> {
    Optional<Stock> findByCode(String code);

    List<Stock> findAllByOrderBySortOrderAsc();

    boolean existsByCode(String code);
}

package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.StockQuote;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface StockQuoteRepository extends BaseRepository<StockQuote, String> {
    Optional<StockQuote> findByCode(String code);

    List<StockQuote> findAllByCodeIn(Collection<String> codes);
}

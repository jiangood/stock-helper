package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.StockDetail;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface StockDetailRepository extends BaseRepository<StockDetail, String> {
    Optional<StockDetail> findByCode(String code);

    List<StockDetail> findAllByCodeIn(Collection<String> codes);
}

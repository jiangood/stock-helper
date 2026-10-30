package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.CostInput;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.List;
import java.util.Optional;

public interface CostInputRepository extends BaseRepository<CostInput, String> {
    Optional<CostInput> findByInputId(String inputId);

    List<CostInput> findAllByOrderBySortOrderAsc();
}

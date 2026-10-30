package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.BusinessItem;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.List;
import java.util.Optional;

public interface BusinessItemRepository extends BaseRepository<BusinessItem, String> {
    Optional<BusinessItem> findByItemId(String itemId);

    List<BusinessItem> findAllByOrderBySortOrderAsc();
}

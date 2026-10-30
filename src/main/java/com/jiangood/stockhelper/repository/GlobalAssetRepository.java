package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.GlobalAsset;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.List;
import java.util.Optional;

public interface GlobalAssetRepository extends BaseRepository<GlobalAsset, String> {
    Optional<GlobalAsset> findByAssetId(String assetId);

    List<GlobalAsset> findAllByOrderBySortOrderAsc();
}

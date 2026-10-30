package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.Fundamental;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.Optional;

public interface FundamentalRepository extends BaseRepository<Fundamental, String> {
    Optional<Fundamental> findByCode(String code);
}

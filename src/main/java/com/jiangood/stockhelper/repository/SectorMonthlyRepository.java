package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.SectorMonthly;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.Optional;

public interface SectorMonthlyRepository extends BaseRepository<SectorMonthly, String> {
    Optional<SectorMonthly> findByCode(String code);
}

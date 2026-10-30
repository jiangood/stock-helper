package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.ResearchReport;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.Optional;

public interface ResearchReportRepository extends BaseRepository<ResearchReport, String> {
    Optional<ResearchReport> findByCode(String code);
}

package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.ResearchScoreRecord;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.Optional;

public interface ResearchScoreRecordRepository extends BaseRepository<ResearchScoreRecord, String> {
    Optional<ResearchScoreRecord> findByCode(String code);
}

package com.jiangood.stockhelper.repository;

import com.jiangood.stockhelper.domain.SyncLog;
import io.github.jiangood.openadmin.framework.data.BaseRepository;

import java.util.List;

public interface SyncLogRepository extends BaseRepository<SyncLog, String> {
    List<SyncLog> findTop20ByOrderByStartedAtDesc();
}

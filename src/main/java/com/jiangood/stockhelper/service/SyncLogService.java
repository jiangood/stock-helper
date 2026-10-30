package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.SyncLog;
import com.jiangood.stockhelper.repository.SyncLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

@Service
@RequiredArgsConstructor
public class SyncLogService {

    private final SyncLogRepository repository;

    public SyncLog start(String type, String trigger) {
        SyncLog log = new SyncLog();
        log.setSyncType(type);
        log.setTriggerType(trigger);
        log.setStatus("running");
        log.setStartedAt(Instant.now());
        log.setMessage("开始采集");
        return repository.save(log);
    }

    public void finish(SyncLog log, boolean success, String message) {
        if (log == null) {
            return;
        }
        Instant now = Instant.now();
        log.setStatus(success ? "success" : "failed");
        log.setMessage(message);
        log.setFinishedAt(now);
        log.setDurationMs(log.getStartedAt() == null ? null : Duration.between(log.getStartedAt(), now).toMillis());
        repository.save(log);
    }

    public List<SyncLog> recent() {
        return repository.findTop20ByOrderByStartedAtDesc();
    }
}

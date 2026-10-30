package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.SyncLog;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 数据采集总入口：串行执行，避免多个任务并发写同一批行情与派生数据。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SyncService {

    private final QuoteSyncService quoteSyncService;
    private final FundamentalSyncService fundamentalSyncService;
    private final GlobalAssetSyncService globalAssetSyncService;
    private final BusinessSyncService businessSyncService;
    private final SyncLogService syncLogService;
    private final StockDataService stockDataService;

    private final AtomicReference<String> runningType = new AtomicReference<>();

    @Async
    public void runAsync(String type, boolean manual) {
        run(type, manual);
    }

    public Map<String, Object> run(String type, boolean manual) {
        String task = normalizeType(type);
        if (!runningType.compareAndSet(null, task)) {
            return Map.of("started", false, "message", "已有采集任务在运行：" + runningType.get());
        }
        try {
            Map<String, Object> result = new LinkedHashMap<>();
            if ("all".equals(task)) {
                result.put("quotes", quoteSyncService.sync(manual));
                result.put("fundamentals", fundamentalSyncService.sync(manual));
                result.put("global-assets", globalAssetSyncService.sync(manual));
                result.put("business", businessSyncService.sync(manual));
            } else {
                result.put(task, switch (task) {
                    case "quotes" -> quoteSyncService.sync(manual);
                    case "fundamentals" -> fundamentalSyncService.sync(manual);
                    case "global-assets" -> globalAssetSyncService.sync(manual);
                    case "business" -> businessSyncService.sync(manual);
                    default -> throw new IllegalArgumentException("未知的采集类型：" + type);
                });
            }
            result.put("started", true);
            result.put("type", task);
            result.put("finishedAt", Instant.now().toString());
            return result;
        } finally {
            runningType.compareAndSet(task, null);
        }
    }

    private String normalizeType(String type) {
        if (type == null || type.isBlank()) {
            return "all";
        }
        return switch (type) {
            case "globalAssets", "global_assets" -> "global-assets";
            case "quote", "stock" -> "quotes";
            case "fundamental" -> "fundamentals";
            case "all" -> "all";
            default -> type;
        };
    }

    public boolean isRunning() {
        return runningType.get() != null;
    }

    public String runningType() {
        return runningType.get();
    }

    public Map<String, Object> status() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("running", isRunning());
        map.put("runningType", runningType());
        List<SyncLog> logs = syncLogService.recent();
        map.put("logs", logs);
        map.put("counts", Map.of(
                "stocks", stockDataService.quotes().size(),
                "quotes", stockDataService.quotes().size(),
                "scores", stockDataService.scores().size(),
                "sectors", stockDataService.sectors().size()));
        Map<String, Object> lastSuccess = new LinkedHashMap<>();
        for (SyncLog log : logs) {
            if ("success".equals(log.getStatus()) && !lastSuccess.containsKey(log.getSyncType())) {
                lastSuccess.put(log.getSyncType(), log.getFinishedAt());
            }
        }
        map.put("lastSuccess", lastSuccess);
        map.put("generatedAt", Instant.now().toString());
        return map;
    }
}

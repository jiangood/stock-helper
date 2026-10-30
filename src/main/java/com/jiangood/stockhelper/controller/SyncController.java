package com.jiangood.stockhelper.controller;

import com.jiangood.stockhelper.service.SyncService;
import io.github.jiangood.openadmin.framework.perm.HasPermission;
import io.github.jiangood.openadmin.util.dto.AjaxResult;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("admin/sync")
@RequiredArgsConstructor
public class SyncController {

    private final SyncService syncService;

    @HasPermission("sync:read")
    @GetMapping("status")
    public AjaxResult status() {
        return AjaxResult.ok().data(syncService.status());
    }

    @HasPermission("sync:run")
    @PostMapping("run")
    public AjaxResult run(@RequestParam(defaultValue = "all") String type) {
        if (syncService.isRunning()) {
            return AjaxResult.err("已有采集任务在运行：" + syncService.runningType());
        }
        syncService.runAsync(type, true);
        return AjaxResult.ok().msg("采集任务已启动：" + type);
    }
}

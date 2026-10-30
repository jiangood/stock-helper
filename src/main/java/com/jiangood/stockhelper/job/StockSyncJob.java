package com.jiangood.stockhelper.job;

import com.jiangood.stockhelper.service.SyncService;
import io.github.jiangood.openadmin.modules.job.BaseJob;
import io.github.jiangood.openadmin.modules.job.JobDescription;
import io.github.jiangood.openadmin.util.field.FieldDescription;
import io.github.jiangood.openadmin.util.field.ValueType;
import jakarta.annotation.Resource;
import org.quartz.JobDataMap;
import org.slf4j.Logger;

import java.util.Map;

/**
 * 股票数据采集任务，由 open-admin 的 Quartz 调度。
 * 在「数据管理 → 数据同步」中也可手动触发同一套采集逻辑。
 */
@JobDescription(label = "股票数据采集", params = {
        @FieldDescription(name = "type", label = "采集类型", required = true, defaultValue = "all",
                placeholder = "all / quotes / fundamentals / global-assets / business",
                type = ValueType.STRING)
})
public class StockSyncJob extends BaseJob {

    @Resource
    private SyncService syncService;

    @Override
    public String execute(JobDataMap data, Logger logger) {
        String type = data == null ? null : data.getString("type");
        if (type == null || type.isBlank()) {
            type = "all";
        }
        progress("开始采集：" + type);
        logger.info("股票数据采集开始：{}", type);
        Map<String, Object> result = syncService.run(type, false);
        logger.info("股票数据采集完成：{}", result);
        progress("采集完成：" + type);
        return "采集完成：" + result;
    }
}

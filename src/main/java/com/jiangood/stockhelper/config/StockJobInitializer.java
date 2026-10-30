package com.jiangood.stockhelper.config;

import com.jiangood.stockhelper.job.StockSyncJob;
import io.github.jiangood.openadmin.modules.job.entity.JobLogAggregation;
import io.github.jiangood.openadmin.modules.job.entity.SysJob;
import io.github.jiangood.openadmin.modules.job.quartz.QuartzManager;
import io.github.jiangood.openadmin.modules.job.repository.SysJobRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 首次启动把股票采集任务注册到 open-admin 的 sys_job，并交给 Quartz 调度。
 * 已存在的任务不覆盖，用户可在「系统管理 → 定时任务」中调整 cron、启停或查看执行记录。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StockJobInitializer {

    private static final String JOB_CLASS = StockSyncJob.class.getName();

    private final SysJobRepository jobRepository;
    private final QuartzManager quartzManager;
    private final StockProperties properties;

    @EventListener(ApplicationReadyEvent.class)
    public void registerJobs() {
        if (!properties.getSync().isEnabled()) {
            return;
        }
        List<JobSpec> specs = List.of(
                new JobSpec("股票行情采集", properties.getSync().getQuoteCron(), "quotes", JobLogAggregation.PER_RUN),
                new JobSpec("股票基本面采集", properties.getSync().getFundamentalsCron(), "fundamentals", JobLogAggregation.PER_RUN),
                new JobSpec("全球资产采集", properties.getSync().getGlobalAssetsCron(), "global-assets", JobLogAggregation.DAILY),
                new JobSpec("产业链商品采集", properties.getSync().getBusinessCron(), "business", JobLogAggregation.HOURLY));
        for (JobSpec spec : specs) {
            try {
                register(spec);
            } catch (Exception e) {
                log.error("注册定时任务失败：{}", spec.name(), e);
            }
        }
    }

    private void register(JobSpec spec) throws Exception {
        SysJob existing = jobRepository.findByName(spec.name());
        if (existing != null) {
            if (Boolean.FALSE.equals(existing.getEnabled())) {
                return;
            }
            try {
                quartzManager.scheduleJob(existing);
            } catch (Exception e) {
                // 兼容旧版本或手工改坏的 cron：回退到配置默认值后重试
                log.warn("定时任务 {} 调度失败，使用默认 cron 重建：{}", spec.name(), e.getMessage());
                existing.setCron(spec.cron());
                existing.setJobClass(JOB_CLASS);
                existing.setJobData(Map.of("type", spec.type()));
                existing.setLogAggregation(spec.aggregation());
                SysJob saved = jobRepository.save(existing);
                quartzManager.scheduleJob(saved);
            }
            return;
        }
        SysJob job = new SysJob();
        job.setName(spec.name());
        job.setCron(spec.cron());
        job.setEnabled(true);
        job.setJobClass(JOB_CLASS);
        job.setJobData(Map.of("type", spec.type()));
        job.setLogAggregation(spec.aggregation());
        SysJob saved = jobRepository.save(job);
        quartzManager.scheduleJob(saved);
        log.info("已注册定时任务：{} [{}] cron={}", saved.getName(), spec.type(), spec.cron());
    }

    private record JobSpec(String name, String cron, String type, JobLogAggregation aggregation) {
    }
}

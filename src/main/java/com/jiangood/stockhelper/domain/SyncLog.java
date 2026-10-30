package com.jiangood.stockhelper.domain;

import io.github.jiangood.openadmin.framework.data.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/**
 * 数据采集运行记录，供「数据同步」页面展示最近状态。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_sync_log")
public class SyncLog extends BaseEntity {

    /** quotes / fundamentals / global-assets / business / all */
    @Column(length = 40)
    private String syncType;

    /** running / success / failed */
    @Column(length = 20)
    private String status;

    @Column(columnDefinition = "TEXT")
    private String message;

    private Instant startedAt;
    private Instant finishedAt;
    private Long durationMs;

    /** 触发方式：manual / schedule */
    @Column(length = 20)
    private String triggerType;
}

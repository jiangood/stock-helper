package com.jiangood.stockhelper.domain;

import io.github.jiangood.openadmin.framework.data.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

/**
 * 机器复算的研报评分（7 项可量化指标，合计 65 分，折算百分制）。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_research_score", indexes = @Index(name = "uk_sh_score_code", columnList = "code", unique = true))
public class ResearchScoreRecord extends BaseEntity {

    @Column(nullable = false, length = 12)
    private String code;

    private Double points;
    private Double max;
    private Double percent;
    private Boolean complete;
    private String band;

    @Column(columnDefinition = "TEXT")
    private String itemsJson;

    @Column(columnDefinition = "TEXT")
    private String metricsJson;

    private LocalDate scoreDate;
}

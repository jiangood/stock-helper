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
 * 研报原始总分摘录（人工维护，保留来源、日期与其他版本分数）。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_research_report", indexes = @Index(name = "uk_sh_report_code", columnList = "code", unique = true))
public class ResearchReport extends BaseEntity {

    @Column(nullable = false, length = 12)
    private String code;

    private String name;
    private Double score;
    private LocalDate reportDate;
    private String source;

    /** 其他版本：[{date, score, source}] */
    @Column(columnDefinition = "TEXT")
    private String alternatesJson;
}

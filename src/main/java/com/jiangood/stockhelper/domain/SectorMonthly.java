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
 * 单只股票的月线涨跌幅汇总（近 1/3/6/12 个月），供板块强弱页面使用。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_sector_monthly", indexes = @Index(name = "uk_sh_sector_code", columnList = "code", unique = true))
public class SectorMonthly extends BaseEntity {

    @Column(nullable = false, length = 12)
    private String code;

    /** monthly / weekly / none */
    @Column(length = 12)
    private String source;

    @Column(name = "month_key", length = 7)
    private String monthKey;

    private Double close;
    private Double m1;
    private Double m3;
    private Double m6;
    private Double m12;
    private Integer months;

    private LocalDate marketDate;
}

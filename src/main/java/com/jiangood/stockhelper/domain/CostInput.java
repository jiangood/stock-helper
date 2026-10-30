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
 * 产业链成本原料参考价（氧化铝 / 合成氨 / 硫酸 / 钛精矿 / 动力煤）。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_cost_input", indexes = @Index(name = "uk_sh_cost_input_id", columnList = "input_id", unique = true))
public class CostInput extends BaseEntity {

    @Column(name = "input_id", nullable = false, length = 40)
    private String inputId;

    private String name;
    private String unit;
    private String role;

    @Column(columnDefinition = "TEXT")
    private String relatedProductsJson;

    private Double latest;
    private LocalDate latestDate;

    @Column(columnDefinition = "TEXT")
    private String seriesJson;

    @Column(columnDefinition = "TEXT")
    private String monthlyPricesJson;

    private String source;
    private String sourceUrl;
    private String status;

    private Integer sortOrder;
}

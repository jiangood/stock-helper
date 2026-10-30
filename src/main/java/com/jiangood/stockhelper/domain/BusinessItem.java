package com.jiangood.stockhelper.domain;

import io.github.jiangood.openadmin.framework.data.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 产业链商品观察项（纯碱 / 尿素 / 甲醇 / 钛白粉 / 电解铝 / 煤炭 / 天然橡胶 / 稀土）。
 * 复杂子结构以 JSON 保存，页面只读展示，缺失数据保持 null。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_business_item", indexes = @Index(name = "uk_sh_business_id", columnList = "item_id", unique = true))
public class BusinessItem extends BaseEntity {

    @Column(name = "item_id", nullable = false, length = 40)
    private String itemId;

    private String name;
    private String unit;
    private String symbol;

    @Column(columnDefinition = "TEXT")
    private String seriesJson;

    private Double latest;
    private LocalDate latestDate;
    private Double latestSpot;
    private Double latestFutures;
    private LocalDate futuresDate;
    private String futuresTime;
    private String futuresSource;
    private String futuresSourceUrl;
    private Double changePct;

    @Column(columnDefinition = "TEXT")
    private String inventoryJson;

    @Column(columnDefinition = "TEXT")
    private String monthlyPricesJson;

    @Column(columnDefinition = "TEXT")
    private String industryLinksJson;

    @Column(columnDefinition = "TEXT")
    private String stocksJson;

    @Column(columnDefinition = "TEXT")
    private String chain;

    @Column(columnDefinition = "TEXT")
    private String drivers;

    private String source;
    private String sourceUrl;
    private String status;
    private Instant updatedAt;

    private Integer sortOrder;
}

package com.jiangood.stockhelper.domain;

import io.github.jiangood.openadmin.framework.data.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/**
 * 个股行情详情（来自东方财富/腾讯详情接口）。金额单位为元，比例为百分比。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_stock_detail", indexes = @Index(name = "uk_sh_detail_code", columnList = "code", unique = true))
public class StockDetail extends BaseEntity {

    @Column(nullable = false, length = 12)
    private String code;

    private String name;
    private Double price;
    private Double prevClose;
    private Double change;
    private Double todayChange;
    private Double open;
    private Double high;
    private Double low;
    private Double avg;
    private Double volume;
    private Double amount;
    private Double turnover;
    private Double volumeRatio;
    private Double amplitude;
    private Double limitUp;
    private Double limitDown;
    private Double pe;
    private Double peStatic;
    private Double peTtm;
    private Double pb;
    private Double roe;
    private Double grossMargin;
    private Double netMargin;
    private Double revenue;
    private Double revenueYoY;
    private Double profit;
    private Double profitYoY;
    private Double navPerShare;
    private Double high52;
    private Double low52;
    private String listedAt;
    private String board;
    private Double totalShares;
    private Double floatShares;
    private Double totalCap;
    private Double floatCap;
    private Instant quoteTime;
}

package com.jiangood.stockhelper.domain;

import io.github.jiangood.openadmin.framework.data.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 全球资产报价与近一个月历史（history 为 [{date, close}] JSON）。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_global_asset", indexes = @Index(name = "uk_sh_global_id", columnList = "asset_id", unique = true))
public class GlobalAsset extends BaseEntity {

    @Column(name = "asset_id", nullable = false, length = 30)
    private String assetId;

    private String name;
    private String kind;
    private String unit;
    private String currency;
    private String status;

    private Double price;
    private Double prevClose;
    private Double change;
    private Double changePct;
    private String quoteTime;
    private String sourceSymbol;
    private String sourceUrl;

    @Column(columnDefinition = "TEXT")
    private String historyJson;

    private Integer sortOrder;
}

package com.jiangood.stockhelper.domain;

import io.github.jiangood.openadmin.framework.data.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.FieldNameConstants;

import java.time.LocalDate;

/**
 * 股票池标的与人工交易计划。code 为业务唯一键（如 sz002408）。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_stock", indexes = @Index(name = "uk_sh_stock_code", columnList = "code", unique = true))
@FieldNameConstants
public class Stock extends BaseEntity {

    @NotBlank
    @Column(nullable = false, length = 12)
    private String code;

    @NotBlank
    @Column(nullable = false, length = 40)
    private String name;

    @Column(length = 120)
    private String alias;

    @Column(name = "group_name", length = 20)
    private String groupName;

    /** 年初价 */
    private Double yearInit;

    /** 计划入场价 */
    private Double entry;

    /** 计划重仓价 */
    private Double heavy;

    /** 止盈价 1 */
    private Double tp1;

    /** 止盈价 2 */
    private Double tp2;

    /** 昨日涨幅（%） */
    private Double prevChg;

    /** 计划复核日期 */
    private LocalDate updDate;

    @Column(nullable = false)
    private Boolean pool = true;

    private Integer sortOrder;

    /** 名称 + 别名的拼音首字母，供搜索使用 */
    @Column(length = 120)
    private String pinyinInitials;

    /** 名称 + 别名的全拼，供搜索使用 */
    @Column(length = 240)
    private String pinyinFull;

    public String getDisplayCode() {
        return code == null ? "" : code.toUpperCase();
    }
}

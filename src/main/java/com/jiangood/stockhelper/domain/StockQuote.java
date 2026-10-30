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
 * 股票池与指数的最近有效行情快照。同一个 code 只保留最新一条。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_quote", indexes = @Index(name = "uk_sh_quote_code", columnList = "code", unique = true))
public class StockQuote extends BaseEntity {

    @Column(nullable = false, length = 12)
    private String code;

    @Column(length = 40)
    private String name;

    private Double price;
    private Double prevClose;
    private Double change;
    private Double todayChange;
    private Double pe;
    private Double pb;
    private Double totalCap;
    private Double floatCap;
    private Double divYield;

    /** 行情源报价时间 */
    private Instant quoteTime;

    /** 行情日（北京时间） */
    private LocalDate marketDate;
}

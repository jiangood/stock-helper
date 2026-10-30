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
 * 个股 / 指数的日、周、月 K 线。adjust: qfq / hfq / none。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_kline",
        indexes = {
                @Index(name = "uk_sh_kline", columnList = "code,period,adjust,trade_date", unique = true),
                @Index(name = "idx_sh_kline_lookup", columnList = "code,period,adjust,trade_date")
        })
public class StockKline extends BaseEntity {

    @Column(nullable = false, length = 12)
    private String code;

    /** day / week / month */
    @Column(nullable = false, length = 8)
    private String period;

    /** qfq / hfq / none */
    @Column(nullable = false, length = 6)
    private String adjust;

    @Column(name = "trade_date", nullable = false)
    private LocalDate tradeDate;

    private Double open;
    private Double high;
    private Double low;
    private Double close;
    private Double volume;
}

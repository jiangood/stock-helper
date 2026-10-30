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
 * 基本面快照：实控人性质、主营构成、历年年报扣非净利（JSON）。
 */
@Getter
@Setter
@Entity
@Table(name = "sh_fundamental", indexes = @Index(name = "uk_sh_fundamental_code", columnList = "code", unique = true))
public class Fundamental extends BaseEntity {

    @Column(nullable = false, length = 12)
    private String code;

    private String name;
    private String owner;

    /** central / province / city / other */
    @Column(length = 20)
    private String ownerType;

    private String mainItem;
    private Double mainRatio;
    private String mainBasis;
    private LocalDate mainDate;

    /** [{date, yoy, value}]，新到旧 */
    @Column(columnDefinition = "TEXT")
    private String annualJson;
}

package com.jiangood.stockhelper.support;

import com.jiangood.stockhelper.indicator.CrocEvaluator;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

public final class CodeUtils {

    public static final ZoneId CHINA = ZoneId.of("Asia/Shanghai");
    public static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private CodeUtils() {
    }

    public static String normalize(String raw) {
        return CrocEvaluator.normalizeCode(raw);
    }

    public static String code6(String code) {
        return code == null || code.length() < 6 ? "" : code.substring(code.length() - 6);
    }

    public static LocalDate chinaDate(Instant instant) {
        return instant == null ? null : instant.atZone(CHINA).toLocalDate();
    }

    public static LocalDate today() {
        return LocalDate.now(CHINA);
    }

    /** 中文字符串拼音首字母；非中文原样保留并小写。 */
    public static String initials(String text) {
        return PinyinUtils.initials(text);
    }

    public static String fullPinyin(String text) {
        return PinyinUtils.full(text);
    }
}

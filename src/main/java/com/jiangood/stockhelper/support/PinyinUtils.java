package com.jiangood.stockhelper.support;

import net.sourceforge.pinyin4j.PinyinHelper;
import net.sourceforge.pinyin4j.format.HanyuPinyinCaseType;
import net.sourceforge.pinyin4j.format.HanyuPinyinOutputFormat;
import net.sourceforge.pinyin4j.format.HanyuPinyinToneType;
import net.sourceforge.pinyin4j.format.HanyuPinyinVCharType;
import net.sourceforge.pinyin4j.format.exception.BadHanyuPinyinOutputFormatCombination;

import java.util.Locale;

/**
 * 拼音索引。首字母用于快速检索，全拼用于完整匹配；ü 统一记作 v。
 */
public final class PinyinUtils {

    private static final HanyuPinyinOutputFormat FORMAT = new HanyuPinyinOutputFormat();

    static {
        FORMAT.setCaseType(HanyuPinyinCaseType.LOWERCASE);
        FORMAT.setToneType(HanyuPinyinToneType.WITHOUT_TONE);
        FORMAT.setVCharType(HanyuPinyinVCharType.WITH_V);
    }

    private PinyinUtils() {
    }

    private static String syllable(char ch) {
        try {
            String[] values = PinyinHelper.toHanyuPinyinStringArray(ch, FORMAT);
            if (values != null && values.length > 0 && values[0] != null) {
                return values[0].replace("u:", "v");
            }
        } catch (BadHanyuPinyinOutputFormatCombination ignored) {
            // 非汉字或无法转换时按原字符保留
        }
        return null;
    }

    public static String initials(String text) {
        if (text == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (char ch : text.toCharArray()) {
            String py = syllable(ch);
            if (py != null) {
                sb.append(py.charAt(0));
            } else if (Character.isLetterOrDigit(ch)) {
                sb.append(Character.toLowerCase(ch));
            }
        }
        return sb.toString();
    }

    public static String full(String text) {
        if (text == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (char ch : text.toCharArray()) {
            String py = syllable(ch);
            if (py != null) {
                sb.append(py);
            } else if (Character.isLetterOrDigit(ch)) {
                sb.append(Character.toLowerCase(ch));
            }
        }
        return sb.toString().toLowerCase(Locale.ROOT);
    }
}

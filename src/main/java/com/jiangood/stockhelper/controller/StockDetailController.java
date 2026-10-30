package com.jiangood.stockhelper.controller;

import com.jiangood.stockhelper.domain.StockKline;
import com.jiangood.stockhelper.indicator.Bar;
import com.jiangood.stockhelper.repository.StockKlineRepository;
import com.jiangood.stockhelper.service.KlineService;
import com.jiangood.stockhelper.service.StockDataService;
import com.jiangood.stockhelper.support.CodeUtils;
import io.github.jiangood.openadmin.framework.perm.HasPermission;
import io.github.jiangood.openadmin.util.dto.AjaxResult;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("admin/stock-detail")
@RequiredArgsConstructor
public class StockDetailController {

    private final StockDataService stockDataService;
    private final KlineService klineService;
    private final StockKlineRepository klineRepository;

    @HasPermission("stock:read")
    @GetMapping("info")
    public AjaxResult info(@RequestParam String code) {
        Map<String, Object> data = stockDataService.detail(code);
        if (data == null) {
            return AjaxResult.err("股票不在股票池中：" + code);
        }
        return AjaxResult.ok().data(data);
    }

    @HasPermission("stock:read")
    @GetMapping("kline")
    public AjaxResult kline(@RequestParam String code,
                            @RequestParam(defaultValue = "day") String period,
                            @RequestParam(defaultValue = "qfq") String adjust,
                            @RequestParam(defaultValue = "0") int count) {
        String normalized = CodeUtils.normalize(code);
        if (normalized == null) {
            return AjaxResult.err("股票代码格式不正确");
        }
        String p = "week".equals(period) || "month".equals(period) ? period : "day";
        String a = "none".equals(adjust) || "raw".equals(adjust) || "".equals(adjust) ? "none"
                : "hfq".equals(adjust) ? "hfq" : "qfq";
        List<Bar> bars = klineService.bars(normalized, p, a, count);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", normalized);
        data.put("period", p);
        data.put("adjust", a);
        data.put("bars", bars);
        return AjaxResult.ok().data(data);
    }

    @HasPermission("stock:read")
    @GetMapping("kline-dates")
    public AjaxResult klineDates(@RequestParam String code) {
        String normalized = CodeUtils.normalize(code);
        List<Map<String, Object>> result = new ArrayList<>();
        for (StockKline row : klineRepository.findByCodeAndPeriodAndAdjustOrderByTradeDateAsc(normalized, "day", "qfq")) {
            result.add(Map.of("time", row.getTradeDate().toString(), "close", row.getClose()));
        }
        return AjaxResult.ok().data(result);
    }
}

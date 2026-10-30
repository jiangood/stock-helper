package com.jiangood.stockhelper.controller;

import com.jiangood.stockhelper.service.StockDataService;
import io.github.jiangood.openadmin.framework.perm.HasPermission;
import io.github.jiangood.openadmin.util.dto.AjaxResult;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("admin/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final StockDataService stockDataService;

    @HasPermission("stock:read")
    @GetMapping("list")
    public AjaxResult list(@RequestParam(required = false) String search,
                           @RequestParam(required = false) String group,
                           @RequestParam(required = false) String status) {
        return AjaxResult.ok().data(stockDataService.dashboard(search, group, status));
    }

    @HasPermission("stock:read")
    @GetMapping("search")
    public AjaxResult search(@RequestParam(required = false) String keyword) {
        return AjaxResult.ok().data(stockDataService.searchStocks(keyword));
    }
}

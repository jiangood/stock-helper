package com.jiangood.stockhelper.controller;

import com.jiangood.stockhelper.service.StockDataService;
import io.github.jiangood.openadmin.framework.perm.HasPermission;
import io.github.jiangood.openadmin.util.dto.AjaxResult;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("admin/global-assets")
@RequiredArgsConstructor
public class GlobalAssetsController {

    private final StockDataService stockDataService;

    @HasPermission("global-assets:read")
    @GetMapping("list")
    public AjaxResult list() {
        return AjaxResult.ok().data(stockDataService.globalAssets());
    }
}

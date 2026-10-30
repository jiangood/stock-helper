package com.jiangood.stockhelper.controller;

import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.service.StockService;
import io.github.jiangood.openadmin.framework.data.specification.Spec;
import io.github.jiangood.openadmin.framework.perm.HasPermission;
import io.github.jiangood.openadmin.util.dto.AjaxResult;
import io.github.jiangood.openadmin.util.dto.IdReq;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("admin/stock")
@RequiredArgsConstructor
public class StockController {

    private final StockService service;

    @HasPermission("stock:read")
    @GetMapping("page")
    public AjaxResult page(@RequestParam(required = false) String name,
                           @RequestParam(required = false) String group,
                           @PageableDefault(sort = "sortOrder", direction = Sort.Direction.ASC) Pageable pageable) {
        Spec<Stock> spec = Spec.of();
        spec.like(Stock.Fields.name, name);
        spec.eq(Stock.Fields.groupName, group);
        Page<Stock> page = service.findAll(spec, pageable);
        return AjaxResult.ok().data(page);
    }

    @HasPermission("stock:read")
    @GetMapping("info/{id}")
    public AjaxResult info(@PathVariable String id) {
        return AjaxResult.ok().data(service.findById(id).orElse(null));
    }

    @HasPermission("stock:create")
    @PostMapping("create")
    public AjaxResult create(@RequestBody Stock input) {
        return AjaxResult.ok().msg("创建成功").data(service.createPlan(input));
    }

    @HasPermission("stock:update")
    @PostMapping("update")
    public AjaxResult update(@RequestBody Stock input, @RequestHeader("X-Body-Fields") List<String> updateFields) {
        return AjaxResult.ok().msg("更新成功").data(service.updatePlan(input, updateFields));
    }

    @HasPermission("stock:delete")
    @PostMapping("delete")
    public AjaxResult delete(@Valid @RequestBody IdReq req) {
        service.deleteById(req.getId());
        return AjaxResult.ok().msg("删除成功");
    }
}

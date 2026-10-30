package com.jiangood.stockhelper.service;

import com.jiangood.stockhelper.domain.Stock;
import com.jiangood.stockhelper.repository.StockRepository;
import com.jiangood.stockhelper.support.CodeUtils;
import io.github.jiangood.openadmin.framework.data.BaseService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
public class StockService extends BaseService<Stock> {

    private final StockRepository stockRepository;

    public StockService(StockRepository stockRepository) {
        this.stockRepository = stockRepository;
    }

    @Transactional
    public Stock createPlan(Stock input) {
        String code = CodeUtils.normalize(input.getCode());
        if (code == null) {
            throw new IllegalArgumentException("股票代码格式不正确，应为 6 位数字或 sh/sz 前缀");
        }
        if (stockRepository.existsByCode(code)) {
            throw new IllegalArgumentException("股票代码已存在：" + code);
        }
        input.setId(null);
        input.setCode(code);
        input.setSortOrder((int) stockRepository.count());
        if (input.getPool() == null) {
            input.setPool(true);
        }
        fillPinyin(input);
        return create(input);
    }

    @Transactional
    public Stock updatePlan(Stock input, List<String> fields) {
        Stock old = findById(input.getId()).orElseThrow(() -> new IllegalArgumentException("股票不存在"));
        String code = CodeUtils.normalize(input.getCode());
        if (code != null && !code.equals(old.getCode())) {
            if (stockRepository.existsByCode(code)) {
                throw new IllegalArgumentException("股票代码已存在：" + code);
            }
            input.setCode(code);
            fields = new ArrayList<>(fields);
            if (!fields.contains(Stock.Fields.code)) {
                fields.add(Stock.Fields.code);
            }
        } else {
            input.setCode(old.getCode());
        }
        String name = input.getName() != null ? input.getName() : old.getName();
        String alias = input.getAlias() != null ? input.getAlias() : old.getAlias();
        input.setPinyinInitials(CodeUtils.initials((name == null ? "" : name) + (alias == null ? "" : alias)));
        input.setPinyinFull(CodeUtils.fullPinyin((name == null ? "" : name) + (alias == null ? "" : alias)));
        List<String> updateFields = new ArrayList<>(fields);
        if (!updateFields.contains(Stock.Fields.pinyinInitials)) {
            updateFields.add(Stock.Fields.pinyinInitials);
        }
        if (!updateFields.contains(Stock.Fields.pinyinFull)) {
            updateFields.add(Stock.Fields.pinyinFull);
        }
        return update(input, updateFields);
    }

    private void fillPinyin(Stock stock) {
        String name = stock.getName() == null ? "" : stock.getName();
        String alias = stock.getAlias() == null ? "" : stock.getAlias();
        stock.setPinyinInitials(CodeUtils.initials(name + alias));
        stock.setPinyinFull(CodeUtils.fullPinyin(name + alias));
    }
}

package com.jiangood.stockhelper.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 股票助手业务配置。采集任务默认按 A 股收盘后执行，可通过 application.yml 覆盖。
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "stock")
public class StockProperties {

    /** 首次启动导入 JSON 种子的目录。 */
    private String seedDir = "./data";

    private Sync sync = new Sync();

    @Getter
    @Setter
    public static class Sync {
        private boolean enabled = true;
        private String quoteCron = "0 30 15 ? * MON-FRI";
        private String fundamentalsCron = "0 10 9 ? * MON";
        private String globalAssetsCron = "0 40 6 * * ?";
        private String businessCron = "0 20 7,12,17,22 * * ?";
        private String zone = "Asia/Shanghai";
    }
}

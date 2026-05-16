每次修改代码后，执行提交和推送（git add、git commit、git push），确保修改立即部署到 GitHub Pages。

## 架构说明

两个独立 HTML 页面：
- `docs/index.html` — 公开页，价值投资理念展示，全静态
- `docs/ce8aec697ee6.html` — 私密页，股票跟踪看板，自包含（内联 CSS/JS）
  - 私密页通过随机长文件名访问，无密码参数
  - 数据来源：`stocks.json`（股票列表）、东方财富 API（实时价格）
  - 自动刷新：每 60 秒

每次修改代码后，执行提交和推送（git add、git commit、git push），确保修改立即部署到 GitHub Pages。

## 架构说明

两个独立 HTML 页面（均为公开页面，无密码）：

- `docs/index.html` — 首页，股票跟踪看板，自包含（内联 CSS/JS）
  - 默认访问根路径即可查看：https://jiangood.github.io/stock-helper/
  - 数据来源：`stocks.json`（股票列表）、东方财富 API（实时价格）
  - 自动刷新：每 60 秒
- `docs/principles.html` — 价值投资理念展示，全静态（`style.css` + `public.css`）

两页之间通过顶部/底部链接互相跳转。

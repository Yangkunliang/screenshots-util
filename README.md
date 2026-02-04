# OmniFlow

全能自动化工具流集合（OmniFlow）。旨在打造像 Hutool 一样的自动化脚本工具箱，聚合各类实用的自动化流程。

目前支持的功能模块：
- **Grafana/网页长截图**：支持滚动长图拼接、批量任务、Cookie 复用。
- **小红书自动发布**：支持内容生成、多账号/多笔记自动发布。

## 模块导航


## Grafana 长截图
支持：
- YAML 配置多个链接/多目录输出
- 需要登录的页面通过浏览器 Profile 复用登录态
- 内部滚动容器的“滚动 + 拼接”长图

使用教程：见 [apps/grafana/docs/GRAFANA_AUTO.md](./apps/grafana/docs/GRAFANA_AUTO.md)

## 小红书内容生成
使用教程：见 [apps/xhs/docs/XHS_AUTO.md](./apps/xhs/docs/XHS_AUTO.md)

## 开源发布注意事项
- 不要提交真实 Grafana 地址、账号、Cookie、Token
- 不要提交小红书账号信息、Cookie、登录态目录
- 本地私有配置：`grafana_auto.yaml`、`xhs_auto.yaml`（已被 .gitignore 忽略）

## 发布到 GitHub（示例）
在推送前，建议先确认本地没有敏感信息被纳入提交：

```bash
git status
git diff
```

初始化并推送到你的仓库（按需修改远端地址）：

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/Yangkunliang/OmniFlow.git
git push -u origin main
```

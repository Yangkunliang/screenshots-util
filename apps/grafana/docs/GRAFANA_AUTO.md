# Grafana 自动截图工具使用教程

## 功能概览
- 自动打开并渲染页面后截图保存（截图内容为网页渲染结果，不包含桌面/工具栏）
- 支持长截图
  - 若页面是整页滚动：直接输出 fullPage 长图
  - 若页面内容在内部滚动容器里滚动：自动滚动并拼接成长图
- 支持登录态复用（适用于需要登录的 Grafana）
- 支持 YAML 批量配置多个链接，并把每个链接输出到不同目录
- 支持对单个链接启用/禁用截图（enabled 开关）

## 环境依赖
- macOS
- Node.js（需要 node + npm）
- 本机安装任意一个 Chromium 内核浏览器（推荐 Google Chrome）

## 快速开始
1. 推荐使用本地私有配置文件：`grafana_auto.yaml`（不要提交到 Git）
2. 参考模板配置文件：`apps/grafana/configs/grafana_auto.demo.yaml`
3. 执行：

```bash
cp ./apps/grafana/configs/grafana_auto.demo.yaml ./grafana_auto.yaml
./grafana_auto.sh
```

## YAML 配置说明
配置文件默认读取顺序：
1. `grafana_auto.yaml`（优先，本地私有配置）
2. `grafana_auto.local.yaml`（可选：另一份本地私有配置文件）
3. `apps/grafana/configs/grafana_auto.demo.yaml`（模板示例，适合提交到 GitHub）

## 需要登录的 Grafana 怎么处理
首次用可视模式登录一次：

```bash
./grafana_auto.sh --headful --target your_target_name --wait 120
```

后续无界面自动截图：

```bash
./grafana_auto.sh --target your_target_name
```


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
2. 参考模板配置文件：`grafana_auto.demo.yaml`
2. 执行：

```bash
cp ./grafana_auto.demo.yaml ./grafana_auto.yaml
# 编辑 grafana_auto.yaml，把 url/outDir/enabled 改成你自己的

./grafana_auto.sh
```

运行后会按 `targets` 列表依次生成截图。

## YAML 配置说明
配置文件默认读取顺序：
1. `grafana_auto.yaml`（优先，本地私有配置，建议放真实 Grafana 链接/目录）
2. `grafana_auto.local.yaml`（可选：另一份本地私有配置文件）
3. `grafana_auto.demo.yaml`（模板示例，适合提交到 GitHub）

结构如下：

```yaml
defaults:
  waitSeconds: 60
  width: 1600
  height: 900
  scrollWaitMs: 250
  stitch: true
  headless: true
  profileDir: ./.grafana_auto_profile
  outDir: ./screenshots/${name}
  filename: ${name}_${timestamp}.png
  enabled: true

targets:
  - name: grafana_project_a
    url: https://grafana.example.com/d/xxxx/project-a?orgId=1
    waitSeconds: 60
    outDir: ./screenshots/project_a
    enabled: true
```

### defaults（全局默认）
- `waitSeconds`：打开页面后等待多少秒再截图（Grafana 拉数据慢时调大）
- `width` / `height`：浏览器视口大小（影响布局与截图宽度）
- `scrollWaitMs`：内部滚动容器滚动到下一屏后，等待渲染稳定的毫秒数
- `stitch`：是否对内部滚动容器做“滚动+拼接”（true/false）
- `headless`：默认是否无界面运行（true/false）
- `profileDir`：登录态（Cookie/LocalStorage）保存目录
- `outDir`：输出目录模板（支持变量）
- `filename`：文件名模板（支持变量）
- `enabled`：默认是否启用截图（true/false）

### targets（任务列表）
每个 target 都会生成一张截图（或被 enabled 跳过）。
- `name`：唯一名称（会参与目录与文件名模板）
- `url`：要截图的页面 URL
- `enabled`：是否启用该条截图（false 会跳过）
- `outDir`：该条的输出目录（可覆盖 defaults）
- `filename`：该条的文件名模板（可覆盖 defaults）
- 其它参数（如 `waitSeconds/width/height/profileDir/profileName/stitch/scrollWaitMs`）也可逐条覆盖 defaults

### 模板变量
`outDir` / `filename` 支持这些变量：
- `${name}`：target 的 name
- `${date}`：日期（YYYYMMDD）
- `${timestamp}`：时间戳（YYYYMMDD_HHMMSS）

示例：
- `outDir: ./screenshots/${date}/${name}`
- `filename: ${name}_${timestamp}.png`

## 需要登录的 Grafana 怎么处理
本工具通过 “持久化浏览器 Profile” 来保存登录态。流程如下：

### 1）首次：用可视模式登录一次
对需要登录的 target 执行：

```bash
./grafana_auto.sh --headful --target grafana_project_a --wait 120
```

说明：
- `--headful`：打开可见浏览器窗口，方便你手动登录
- `--wait 120`：给你 120 秒时间完成登录与页面加载（不够就加大）
- 登录成功后，登录态会写入该 target 使用的 `profileDir`（默认是 `./.grafana_auto_profile`，也可在 YAML 中为不同 target 指定不同 profileDir）

### 2）后续：无界面自动截图（复用登录态）

```bash
./grafana_auto.sh --target grafana_project_a
```

如果你要批量跑多个 target，直接：

```bash
./grafana_auto.sh
```

## 常用命令
- 执行全部启用的 targets：

```bash
./grafana_auto.sh
```

- 只执行某一个 target：

```bash
./grafana_auto.sh --target grafana_project_a
```

- 指定配置文件路径：

```bash
./grafana_auto.sh --config /path/to/grafana_auto.yaml
```

## 常见问题
### 1）截图不是长图 / 只截到一屏
- 先确认页面到底是不是“整页滚动”，还是“内部容器滚动”。内部容器滚动需要拼接逻辑，建议保留 `stitch: true`
- Grafana 有虚拟列表/懒加载时，滚动后需要更多时间渲染，建议把：
  - `waitSeconds` 调大（首次等待）
  - `scrollWaitMs` 调大（每次滚动后等待）

### 2）截图变成登录页
- 先用 `--headful` 登录一次，确认登录完成后再跑 headless
- 确认该 target 的 `profileDir` 没变（变了相当于新浏览器 Profile，需要重新登录）

# screenshots-util

用于批量生成 Grafana（或任意网页）的长截图，支持：
- YAML 配置多个链接/多目录输出
- 需要登录的页面通过浏览器 Profile 复用登录态
- 内部滚动容器的“滚动 + 拼接”长图

## 使用教程
详见：[GRAFANA_AUTO.md](./GRAFANA_AUTO.md)

## 开源发布注意事项
- 不要提交真实 Grafana 地址、账号、Cookie、Token
- 把真实链接放在 `grafana_auto.yaml`（已被 .gitignore 忽略）
- 仓库内提交 `grafana_auto.demo.yaml` 作为可公开的模板示例

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
git remote add origin https://github.com/xxx/screenshots-util.git
git push -u origin main
```

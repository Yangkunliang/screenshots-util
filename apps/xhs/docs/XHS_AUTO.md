# 小红书文章自动生成与发布

## 能做什么
- 自动生成 100~200 字左右的 Java 小知识点内容（由浅入深，按序轮换）
- 生成后保存到 `posts/xhs/` 目录
- 可选：尝试通过网页端自动填充并点击发布（需要你已登录小红书创作平台）

## 生成内容

```bash
./xhs_auto.sh
./xhs_auto.sh write
./xhs_auto.sh write --topic 0
./xhs_auto.sh write --topic volatile
```

## 长文（文章）模式
长文发布入口（你提供的链接）：
- https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=article

生成一篇长文（article）并保存到 `posts/xhs/`：

```bash
./xhs_auto.sh write --target article
```

发布长文（需要提前登录一次）：

```bash
./xhs_auto.sh login --target article
./xhs_auto.sh publish --target article --headful --unattended --images-dir xhs_images --image-count 1
```

说明：长文在点击“下一步”后，可能会进入“图片编辑/封面预览”页面（你截图里的那种）。此时需要提供至少 1 张图片作为封面/卡片，否则页面可能没有“发布/下一步”。
推荐准备 `xhs_images/` 并带上参数：

```bash
./xhs_auto.sh publish --target article --headful --unattended --images-dir xhs_images --image-count 1
```

如果你发现 headless 模式下经常进不去编辑器（no_editor），大概率是平台风控对 headless/自动化更敏感。替代方案：
- 用可视模式但无人值守（会弹窗，但不需要你操作）。脚本会默认在退出前停留约 15 秒，方便你肉眼确认；也可用 `--linger-ms` 调整：

```bash
./xhs_auto.sh publish --target article --headful --unattended --linger-ms 60000
```

- 如果你希望窗口一直保留到你确认（手动按回车才退出），不要加 `--unattended`：

```bash
./xhs_auto.sh publish --target article --headful
```

- 或者在一台专门机器/专门账号上跑，降低频繁登录与验证触发概率

## 准备图片（建议）
把图片放到项目根目录的 `xhs_images/`（已在 .gitignore 忽略，不会提交）。脚本会从该目录挑选图片用于发布。

示例：

```bash
./xhs_auto.sh write --images-dir xhs_images --image-count 1
./xhs_auto.sh publish --images-dir xhs_images --image-count 3
```

## 使用小红书“文生图/AI配图”（实验）
如果你不想用本地图片，可以尝试让脚本在网页端寻找并触发“小红书自带的 AI 配图/文生图”入口：

```bash
./xhs_auto.sh publish --ai-image
```

限制：
- 该入口并非所有账号/所有页面都有，且 UI 经常变化，属于 best-effort
- 可能会弹验证码/风控，需要人工
- 如果平台强制要求上传本地图片，此模式会失败

## 发布（可选）
小红书网页端发布入口常见是：
- 图文笔记：`https://creator.xiaohongshu.com/publish/imgNote`
- 视频笔记：`https://creator.xiaohongshu.com/publish/publish`

首次建议用可视模式登录一次，再发布：

```bash
./xhs_auto.sh login
```

如果 login 没有弹出浏览器/直接报 profile 被占用（SingletonLock），说明上一次的浏览器实例还在用同一个 profile 目录：
- 先关掉所有 Chrome/Edge/Chromium 再重试
- 或者换一个 profile 目录（后续 publish 要用同一个）：

```bash
./xhs_auto.sh login --profile-dir ./.xhs_profile_2
./xhs_auto.sh publish --profile-dir ./.xhs_profile_2 ...
```

说明：
- login 只负责打开浏览器并让你完成一次登录（写入 profileDir），不会自动写文章
- 自动写文章/自动填充在 publish 阶段发生（publish 不传 --file 时会先自动生成一篇再去填）

也可以指定发布某个已生成文件：

```bash
./xhs_auto.sh publish --file /absolute/path/to/post.md --headful
```

只想检查“将要发布的内容”（不打开网页）：

```bash
./xhs_auto.sh publish --dry-run
```

## 无人工干预的前提
- 你已经通过 `./xhs_auto.sh login` 把登录态保存到 `profileDir`（默认 `./.xhs_profile`）
- 你提供了图片（例如放在 `xhs_images/` 并用 `--images-dir` 指定）
- 发布过程中不触发验证码/风控（这是平台侧策略，无法保证 100%）

## 完全无人值守的现实边界（重要）
- 小红书网页端通常会有登录态过期、验证码、风控、必填项变化等情况，这些都可能导致自动发布失败
- 如果你希望“机器跑就行，不需要人盯着”，建议用 `--headless --unattended` 跑批任务：失败时脚本会自动把页面截图与 URL 保存到 `logs/xhs/` 便于事后排查

示例：

```bash
./xhs_auto.sh publish --headless --unattended --images-dir xhs_images --image-count 1
```

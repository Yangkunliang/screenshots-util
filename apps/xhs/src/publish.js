const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getBoolArg(flag, fallback) {
  const raw = getArg(flag);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function getIntArg(flag, fallback) {
  const raw = getArg(flag);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) ? value : fallback;
}

function pickChromeExecutable(explicitPath) {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

function parseFrontmatter(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines[0] !== "---") return { meta: null, body: text };
  const endIndex = lines.slice(1).findIndex((l) => l.trim() === "---");
  if (endIndex === -1) return { meta: null, body: text };
  const metaLines = lines.slice(1, endIndex + 1);
  const bodyLines = lines.slice(endIndex + 2);
  let meta = null;
  try {
    const YAML = require("yaml");
    meta = YAML.parse(metaLines.join("\n"));
  } catch {
    meta = null;
  }
  return { meta, body: bodyLines.join("\n") };
}

function parseNote(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  const { meta, body } = parseFrontmatter(raw);
  const bodyLines = String(body).split(/\r?\n/);
  const firstLineIndex = bodyLines.findIndex((l) => l.trim().length > 0);
  const firstLine = firstLineIndex === -1 ? "" : bodyLines[firstLineIndex].trim();
  const titleFromBody = firstLine.startsWith("#") ? firstLine.replace(/^#+\s*/, "").trim() : firstLine;
  const content = bodyLines.slice(firstLineIndex + 1).join("\n").trim();

  const xhs = meta && typeof meta === "object" ? meta.xhs : null;
  const images = xhs && Array.isArray(xhs.images) ? xhs.images : [];
  const type = xhs && typeof xhs.type === "string" && xhs.type.trim() ? xhs.type.trim() : "imgNote";
  const title = xhs && typeof xhs.title === "string" && xhs.title.trim() ? xhs.title.trim() : titleFromBody;
  return { title, content: content || String(body).trim(), images, type };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTimes(fn, times, delayMs) {
  for (let i = 0; i < times; i += 1) {
    const ok = await fn().catch(() => false);
    if (ok) return true;
    if (delayMs > 0) await sleep(delayMs);
  }
  return false;
}

async function writeRunDebugJson(label, data) {
  const ctx = globalThis.__xhsAutoRun;
  if (!ctx || !ctx.runLogDir || !ctx.runTs) return;
  if (typeof ctx.seq !== "number") ctx.seq = 0;
  const safe = String(label || "debug").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) || "debug";
  const filePath = path.join(ctx.runLogDir, `${ctx.runTs}_${pad2(ctx.seq)}_${safe}.json`);
  ctx.seq += 1;
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8").catch(() => {});
}

function registerExitHandlers({ projectDir, context, page }) {
  const state = globalThis.__xhsAutoExit || { exiting: false };
  globalThis.__xhsAutoExit = state;
  const handle = async (label, error) => {
    if (state.exiting) return;
    state.exiting = true;
    try {
      if (error) process.stderr.write(`${String(error?.stack || error)}\n`);
    } catch {}
    try {
      if (page) await writeDebugArtifactsExtended({ projectDir, page, label });
    } catch {}
    try {
      await context?.close();
    } catch {}
  };

  process.once("SIGINT", () => {
    handle("sigint").finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    handle("sigterm").finally(() => process.exit(143));
  });
  process.once("uncaughtException", (err) => {
    handle("uncaught_exception", err).finally(() => process.exit(1));
  });
  process.once("unhandledRejection", (err) => {
    handle("unhandled_rejection", err).finally(() => process.exit(1));
  });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatTimestamp(now) {
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

async function writeDebugArtifacts({ projectDir, page, label }) {
  const ts = formatTimestamp(new Date());
  const outDir = path.join(projectDir, "logs", "xhs");
  await fs.promises.mkdir(outDir, { recursive: true });

  const safeLabel = String(label || "debug").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) || "debug";
  const screenshotPath = path.join(outDir, `${ts}_${safeLabel}.png`);
  const urlPath = path.join(outDir, `${ts}_${safeLabel}.url.txt`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (error) {
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch (error2) {
      process.stderr.write(`保存截图失败: ${String(error?.message || error)}; fallback 失败: ${String(error2?.message || error2)}\n`);
    }
  }
  try {
    await fs.promises.writeFile(urlPath, `${page.url()}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`保存 URL 失败: ${String(error?.message || error)}\n`);
  }
  return { screenshotPath, urlPath };
}

async function writeDebugArtifactsExtended({ projectDir, page, label }) {
  const base = await writeDebugArtifacts({ projectDir, page, label });
  const ts = path.basename(base.screenshotPath).replace(/\.png$/i, "");
  const outDir = path.dirname(base.screenshotPath);
  const htmlPath = path.join(outDir, `${ts}.html`);
  const framesPath = path.join(outDir, `${ts}.frames.json`);
  const diagPath = path.join(outDir, `${ts}.diag.json`);

  try {
    let html = "";
    try {
      html = await page.content();
    } catch {}
    if (!html) {
      html = await page.evaluate(() => document.documentElement.outerHTML).catch(() => "");
    }
    if (html) await fs.promises.writeFile(htmlPath, html, "utf8");
  } catch (error) {
    process.stderr.write(`保存 HTML 失败: ${String(error?.message || error)}\n`);
  }

  try {
    const diag = {
      url: page.url(),
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => ""),
      viewport: await page.viewportSize().catch(() => null),
      ts,
      label: String(label || ""),
    };
    await fs.promises.writeFile(diagPath, JSON.stringify(diag, null, 2), "utf8");
  } catch (error) {
    process.stderr.write(`保存 Diag 失败: ${String(error?.message || error)}\n`);
  }

  const frames = (page.frames ? page.frames() : []).map((f) => ({
    url: f.url ? f.url() : "",
    name: f.name ? f.name() : "",
  }));
  try {
    await fs.promises.writeFile(framesPath, JSON.stringify({ url: page.url(), frames }, null, 2), "utf8");
  } catch (error) {
    process.stderr.write(`保存 Frames 失败: ${String(error?.message || error)}\n`);
  }

  return { ...base, htmlPath, framesPath, diagPath };
}

async function normalizePageView(page) {
  await page.bringToFront().catch(() => {});
  await page.mouse.click(10, 10).catch(() => {});
  await page.keyboard.press("Meta+0").catch(() => {});
  await page.keyboard.press("Control+0").catch(() => {});
  await page.evaluate(() => {
    try {
      document.documentElement.style.zoom = "100%";
      document.body && (document.body.style.zoom = "100%");
    } catch {}
  }).catch(() => {});
}

function getAllScopes(page) {
  const frames = page.frames ? page.frames() : [];
  const all = [page, ...frames];
  const unique = [];
  const seen = new Set();
  for (const scope of all) {
    const key = scope === page ? "page" : (scope.url ? scope.url() : String(scope));
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(scope);
  }
  return unique;
}

function editorSelectors() {
  return [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="正文"]',
    'textarea[placeholder*="内容"]',
    'textarea[placeholder*="描述"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    ".ProseMirror",
    '[data-slate-editor="true"]',
    "[data-slate-editor]",
    '[role="textbox"]',
  ];
}

async function ensureArticleEditorOpen(page) {
  const scopes = getAllScopes(page);
  const openCandidates = [
    /新的创作/,
    /新建创作/,
    /开始写作/,
    /写文章/,
    /新建文章/,
    /创建文章/,
    /去写文章/,
    /立即创作/,
  ];
  for (const scope of scopes) {
    for (const name of openCandidates) {
      const btn = scope.getByRole("button", { name }).first();
      if (await btn.count()) {
        const enabled = await btn.isEnabled().catch(() => true);
        if (!enabled) continue;
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(1000);
        return true;
      }
      const text = scope.getByText(name).first();
      if (await text.count()) {
        await text.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(1000);
        return true;
      }
    }
  }
  return false;
}

async function waitForEditor(page, timeoutMs) {
  const startedAt = Date.now();
  const selectors = editorSelectors();

  while (Date.now() - startedAt < timeoutMs) {
    const scopes = getAllScopes(page);
    for (const scope of scopes) {
      for (const selector of selectors) {
        const locator = scope.locator(selector).first();
        if (await locator.count()) return scope;
      }
    }
    await sleep(300);
  }

  return null;
}

async function fillBestEffort(scope, page, title, content) {
  const titleBox = scope.locator('textarea[placeholder*="标题"]').first();
  if (await titleBox.count()) {
    await titleBox.fill(title);
  } else {
    const anyTextarea = scope.locator("textarea").first();
    if (await anyTextarea.count()) await anyTextarea.fill(title);
  }

  const contentTextarea = scope.locator('textarea[placeholder*="正文"], textarea[placeholder*="内容"], textarea[placeholder*="描述"]').first();
  if (await contentTextarea.count()) {
    await contentTextarea.fill(content);
    return;
  }

  const textbox = scope.locator('[contenteditable="true"][role="textbox"]').first();
  if (await textbox.count()) {
    await textbox.click();
    try {
      await page.keyboard.insertText(content);
    } catch {
      await page.keyboard.type(content);
    }
    return;
  }

  const anyEditable = scope.locator('[contenteditable="true"]').first();
  if (await anyEditable.count()) {
    await anyEditable.click();
    try {
      await page.keyboard.insertText(content);
    } catch {
      await page.keyboard.type(content);
    }
    return;
  }
}

async function clickFirstEnabled(locator) {
  const count = await locator.count().catch(() => 0);
  if (!count) return false;
  for (let i = 0; i < Math.min(count, 5); i += 1) {
    const item = locator.nth(i);
    const enabled = await item.isEnabled().catch(() => true);
    if (!enabled) continue;
    await item.scrollIntoViewIfNeeded().catch(() => {});
    let clicked = false;
    try {
      await item.click({ timeout: 2000 });
      clicked = true;
    } catch {}
    if (clicked) return true;
  }
  return false;
}

function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickButtonExactText(scope, text) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
  const byRole = scope.getByRole("button", { name: pattern });
  if (await clickFirstEnabled(byRole)) return true;

  const button = scope.locator("button").filter({ hasText: pattern });
  const count = await button.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 5); i += 1) {
    const el = button.nth(i);
    const enabled = await el.isEnabled().catch(() => true);
    if (!enabled) continue;
    const inner = await el.innerText().catch(() => "");
    if (!pattern.test(inner)) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    let clicked = false;
    try {
      await el.click({ timeout: 2000 });
      clicked = true;
    } catch {}
    if (clicked) return true;
  }

  const byText = scope.getByText(pattern);
  if (await clickFirstEnabled(byText)) return true;

  return false;
}

async function acceptAgreementsBestEffort(page) {
  const scopes = getAllScopes(page);
  const patterns = [/我已阅读/, /已阅读并同意/, /同意/, /服务协议/, /隐私/];
  for (const scope of scopes) {
    for (const pattern of patterns) {
      const byText = scope.getByText(pattern).first();
      if (await byText.count()) {
        await byText.click({ timeout: 1000 }).catch(() => {});
      }
    }
  }
}

async function clickPublishBestEffort(scope, effectiveTarget) {
  const target = effectiveTarget || "imgNote";
  if (target === "article") {
    const exactOrder = ["下一步", "提交审核", "发布文章", "确认发布", "确定", "确认", "完成"];
    for (const text of exactOrder) {
      if (await clickButtonExactText(scope, text)) return true;
    }

    const fallbackRegex = [/下一步/, /提交审核/, /发布文章/, /确认发布/, /完成/, /确定/, /确认/];
    for (const pattern of fallbackRegex) {
      const byRole = scope.getByRole("button", { name: pattern });
      if (await clickFirstEnabled(byRole)) return true;
    }

    for (const pattern of fallbackRegex) {
      const byText = scope.getByText(pattern);
      if (await clickFirstEnabled(byText)) return true;
    }

    return false;
  }

  const exactOrder = ["下一步", "发布", "提交", "提交审核", "发布笔记", "确认发布", "确定", "确认", "完成"];
  for (const text of exactOrder) {
    if (await clickButtonExactText(scope, text)) return true;
  }

  const fallbackRegex = [/发布笔记/, /提交审核/, /提交/, /发布/, /下一步/, /完成/, /确定/, /确认/];
  for (const pattern of fallbackRegex) {
    const byRole = scope.getByRole("button", { name: pattern });
    if (await clickFirstEnabled(byRole)) return true;
  }

  return false;
}

async function isArticleCoverStep(page) {
  const scopes = getAllScopes(page);
  const hints = [/图片编辑/, /发布图文/, /封面预览/, /笔记预览/];
  for (const scope of scopes) {
    for (const hint of hints) {
      const locator = scope.getByText(hint).first();
      if (await locator.count()) return true;
    }
  }
  const publishBtn = page.locator("button.publishBtn").first();
  if (await publishBtn.count().catch(() => 0)) return true;
  return false;
}

async function isArticlePublishSettingsStep(page) {
  const candidates = await collectPublishSettingsCandidates(page).catch(() => null);
  return Boolean(candidates?.picked);
}

async function hasArticleNextButton(page) {
  const scopes = getAllScopes(page);
  for (const scope of scopes) {
    const btn = scope.locator("button.custom-button.submit").filter({ hasText: /下一步/ }).first();
    if (await btn.count().catch(() => 0)) return true;
  }
  for (const scope of scopes) {
    const btn = scope.locator("button").filter({ hasText: /下一步/ }).first();
    if (await btn.count().catch(() => 0)) return true;
  }
  return false;
}

async function waitForArticlePublishStep(page, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isArticleCoverStep(page)) return true;
    const publishBtn = page.locator("button,[role='button']").filter({ hasText: /^\\s*发布\\s*$/ }).first();
    if (await publishBtn.count().catch(() => 0)) return true;
    await sleep(250);
  }
  return false;
}

async function isUploadingHint(page) {
  const scopes = getAllScopes(page);
  const hints = [/上传中/, /图片上传中/, /请稍后/];
  for (const scope of scopes) {
    for (const hint of hints) {
      const locator = scope.getByText(hint).first();
      if (await locator.count().catch(() => 0)) return true;
    }
  }
  return false;
}

async function clickArticlePublishButton(page) {
  if (await hasIncidentalMarkModal(page)) {
    await handleIncidentalMarkModal(page);
    return false;
  }

  const scopes = getAllScopes(page);

  for (const scope of scopes) {
    const btn = scope.locator("button.publishBtn").first();
    if (await btn.count().catch(() => 0)) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await btn.click({ timeout: 2000, force: true });
        if (await hasIncidentalMarkModal(page)) {
          await handleIncidentalMarkModal(page);
          return false;
        }
        return true;
      } catch {}
    }
  }

  const settings = await clickPublishSettingsPublishButton(page);
  if (settings && (await hasIncidentalMarkModal(page))) {
    await handleIncidentalMarkModal(page);
    return false;
  }
  if (settings) return true;

  return false;
}

async function waitForPublishResult(page, timeoutMs) {
  const startedAt = Date.now();
  const patterns = [/发布成功/, /提交成功/, /审核中/, /已发布/, /发布完成/, /已提交/];
  while (Date.now() - startedAt < timeoutMs) {
    const scopes = getAllScopes(page);
    for (const scope of scopes) {
      for (const pattern of patterns) {
        const locator = scope.getByText(pattern).first();
        if (await locator.count()) return true;
      }
    }
    await sleep(500);
  }
  return false;
}

async function dumpButtonHints(page) {
  const scopes = getAllScopes(page);
  const keywords = [/发布/, /提交/, /审核/, /下一步/, /保存/, /草稿/, /认证/, /排版/, /暂存/];
  const hits = new Set();

  for (const scope of scopes) {
    const candidates = scope.locator("button,[role='button'],a");
    const count = await candidates.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 200); i += 1) {
      const el = candidates.nth(i);
      const text = await el.innerText().catch(() => "");
      const t = String(text).replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (t.length > 30) continue;
      if (keywords.some((k) => k.test(t))) hits.add(t);
      if (hits.size >= 30) break;
    }
    if (hits.size >= 30) break;
  }

  if (hits.size) {
    process.stdout.write(`页面按钮/入口线索: ${Array.from(hits).join(" | ")}\n`);
  }
}

async function dumpBlockerHints(page) {
  const scopes = getAllScopes(page);
  const patterns = [
    /去认证/,
    /立即认证/,
    /开通/,
    /发布权限/,
    /完善/,
    /请.*验证/,
    /安全验证/,
    /风险/,
    /验证码/,
    /请选择/,
    /封面/,
    /分类/,
    /声明/,
    /协议/,
  ];
  const hits = new Set();
  for (const scope of scopes) {
    for (const pattern of patterns) {
      const locator = scope.getByText(pattern).first();
      if (await locator.count()) hits.add(String(pattern));
    }
  }
  if (hits.size) {
    process.stdout.write(`疑似阻塞提示: ${Array.from(hits).join(" | ")}\n`);
  }
}

function parseCsvList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function listImageFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  return files.map((name) => path.join(dirPath, name));
}

function pickImages({ projectDir, imagesCsv, imagesDir, imageCount }) {
  const explicit = parseCsvList(imagesCsv).map((p) => path.resolve(projectDir, p));
  if (explicit.length) return explicit;
  if (!imagesDir) return [];
  const absDir = path.resolve(projectDir, imagesDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [];
  const files = listImageFiles(absDir);
  const count = Math.max(1, Math.min(9, Number(imageCount) || 1));
  return files.slice(0, count);
}

async function isLikelyLoginPage(page) {
  const hints = [/短信登录/, /验证码/, /登录/, /安全验证/, /行为验证/, /风险/];
  for (const hint of hints) {
    const locator = page.getByText(hint).first();
    if (await locator.count()) return true;
  }
  const telInput = page.locator('input[type="tel"]').first();
  if (await telInput.count()) return true;
  return false;
}

async function uploadImagesBestEffort(page, images) {
  const files = (images || []).map((p) => path.resolve(p)).filter((p) => fs.existsSync(p));
  if (!files.length) return false;

  for (const scope of getAllScopes(page)) {
    const actionButtons = [
      scope.getByRole("button", { name: /上传/ }).first(),
      scope.getByRole("button", { name: /添加/ }).first(),
      scope.getByText(/上传图片|添加图片|选择图片/).first(),
    ];

    for (const locator of actionButtons) {
      if (await locator.count()) {
        await locator.click({ timeout: 1000 }).catch(() => {});
      }
    }

    const inputs = scope.locator('input[type="file"]');
    const count = await inputs.count();
    for (let i = 0; i < count; i += 1) {
      const input = inputs.nth(i);
      try {
        await input.setInputFiles(files);
        await page.waitForTimeout(1500);
        return true;
      } catch {}
    }
  }

  return false;
}

function registerFileChooserAutoSet(page, files) {
  if (!files || !files.length) return;
  page.on("filechooser", async (chooser) => {
    await chooser.setFiles(files).catch(() => {});
  });
}

async function uploadCoverImagesBestEffort(page, images) {
  const files = (images || []).map((p) => path.resolve(p)).filter((p) => fs.existsSync(p));
  if (!files.length) return false;

  if (!(await isArticleCoverStep(page))) return false;

  const uploaded = await uploadImagesBestEffort(page, files);
  if (uploaded) return true;

  for (const scope of getAllScopes(page)) {
    const addButtons = [
      scope.getByRole("button", { name: /添加/ }).first(),
      scope.getByText(/添加/).first(),
    ];
    for (const btn of addButtons) {
      if (await btn.count()) {
        await btn.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(1500);
        return true;
      }
    }
  }

  return false;
}

async function isMissingTitle(page) {
  const scopes = getAllScopes(page);
  const patterns = [/缺少标题/, /请输入标题/, /标题不能为空/];
  for (const scope of scopes) {
    for (const pattern of patterns) {
      const locator = scope.getByText(pattern).first();
      if (await locator.count()) return true;
    }
  }
  return false;
}

async function clickOneKeyFormat(page) {
  const scopes = getAllScopes(page);
  for (const scope of scopes) {
    if (await clickButtonExactText(scope, "一键排版")) return true;
    const byText = scope.getByText(/一键排版/);
    if (await clickFirstEnabled(byText)) return true;
  }
  return false;
}

async function clickPublishOnCoverStep(page) {
  if (!(await isArticleCoverStep(page))) return false;
  const scopes = getAllScopes(page);

  for (const scope of scopes) {
    const publishBtnByClass = scope.locator("button.publishBtn").first();
    if (await publishBtnByClass.count()) {
      await publishBtnByClass.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await publishBtnByClass.click({ timeout: 2000, force: true });
        return true;
      } catch {}
    }
  }

  const pwPublish = await playwrightClickButtonByTextAnyScope(page, [/^\\s*发布\\s*$/, /^\\s*提交审核\\s*$/]);
  if (pwPublish) return true;

  return false;
}

async function domClickByExactText(page, texts) {
  const list = Array.isArray(texts) ? texts.map(String) : [String(texts)];
  return page
    .evaluate((targets) => {
      const isInModal = (el) =>
        !!(el.closest('[aria-modal="true"]') ||
           el.closest('.el-dialog,.d-dialog,.dialog,.modal'));
      const candidates = Array.from(document.querySelectorAll("button,[role='button']"));
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      for (const text of targets) {
        const t = norm(text);
        for (const el of candidates) {
          if (isInModal(el)) continue;
          const label = norm(el.textContent);
          if (label !== t) continue;
          const rect = el.getBoundingClientRect();
          if (!(rect.width > 2 && rect.height > 2)) continue;
          const disabled = el.getAttribute("disabled") !== null || el.getAttribute("aria-disabled") === "true";
          if (disabled) continue;
          const cs = window.getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || Number.parseFloat(cs.opacity || "1") < 0.1) continue;
          const klass = String(el.className || "");
          if (/mark|tag/i.test(klass)) continue;
          el.scrollIntoView({ block: "center", inline: "center" });
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          el.click();
          return t;
        }
      }
      return null;
    }, list)
    .then((v) => Boolean(v))
    .catch(() => false);
}

async function domClickBottomBarButtonAnyScope(page, texts) {
  const list = Array.isArray(texts) ? texts.map(String) : [String(texts)];
  const scopes = getAllScopes(page);

  for (const scope of scopes) {
    const ok = await scope
      .evaluate((targets) => {
        const isInModal = (el) =>
          !!(el.closest('[aria-modal="true"]') || el.closest(".el-dialog,.d-dialog,.dialog,.modal"));
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const candidates = Array.from(document.querySelectorAll("button,[role='button']"));
        const viewportH = window.innerHeight || 0;
        const bottomLine = viewportH * 0.6;

        for (const raw of targets) {
          const target = norm(raw);
          const matches = [];
          for (const el of candidates) {
            if (isInModal(el)) continue;
            const label = norm(el.textContent);
            if (!(label === target || label.startsWith(target) || label.includes(target))) continue;
            const rect = el.getBoundingClientRect();
            if (!(rect.width > 2 && rect.height > 2)) continue;
            if (!(rect.bottom > bottomLine)) continue;
            const disabled = el.getAttribute("disabled") !== null || el.getAttribute("aria-disabled") === "true";
            if (disabled) continue;
            const cs = window.getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden" || Number.parseFloat(cs.opacity || "1") < 0.1) continue;
            const klass = String(el.className || "");
            if (/mark|tag/i.test(klass)) continue;
            matches.push({ el, rect });
          }
          matches.sort((a, b) => b.rect.bottom - a.rect.bottom);
          const picked = matches[0]?.el;
          const rect = matches[0]?.rect;
          if (!picked || !rect) continue;
          picked.scrollIntoView({ block: "center", inline: "center" });
          picked.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          picked.click();
          return true;
        }
        return false;
      }, list)
      .catch(() => false);
    if (ok) return true;
  }

  return false;
}

async function playwrightClickButtonByTextAnyScope(page, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const scopes = getAllScopes(page);

  for (const scope of scopes) {
    for (const pattern of list) {
      const locator = scope.locator("button,[role='button']").filter({ hasText: pattern });
      const count = await locator.count().catch(() => 0);
      if (!count) continue;
      for (let i = 0; i < Math.min(count, 8); i += 1) {
        const el = locator.nth(i);
        const box = await el.boundingBox().catch(() => null);
        if (!box || box.width < 2 || box.height < 2) continue;
        await el.scrollIntoViewIfNeeded().catch(() => {});
        try {
          await el.click({ timeout: 2000, force: true });
          return true;
        } catch {}
        try {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 10 });
          return true;
        } catch {}
      }
    }
  }

  return false;
}

async function exposePublishButtonForHumans(page) {
  if (!(await isArticleCoverStep(page))) return false;
  return page
    .evaluate(() => {
      const btn = document.querySelector("button.publishBtn");
      if (!btn) return false;
      // 仅用于“可见性”增强，不修改交互语义
      btn.style.position = "fixed";
      btn.style.left = "20px";
      btn.style.bottom = "20px";
      btn.style.zIndex = "2147483647";
      btn.style.opacity = "1";
      btn.style.visibility = "visible";
      btn.style.display = "inline-flex";
      btn.style.transform = "none";
      return true;
    })
    .catch(() => false);
}

async function clickConfirmDialogsBestEffort(page) {
  if (await hasIncidentalMarkModal(page)) {
    await handleIncidentalMarkModal(page);
    return true;
  }

  const scopes = getAllScopes(page);
  const exactTexts = ["确认发布", "确定", "确认", "我知道了", "继续", "继续发布"];
  for (const scope of scopes) {
    for (const text of exactTexts) {
      if (await clickButtonExactText(scope, text)) return true;
    }
  }

  const domClicked = await domClickByExactText(page, exactTexts);
  if (domClicked) return true;

  const regexTexts = [/确认发布/, /确定/, /确认/, /我知道了/, /继续发布/];
  for (const scope of scopes) {
    for (const pattern of regexTexts) {
      const byRole = scope.getByRole("button", { name: pattern });
      if (await clickFirstEnabled(byRole)) return true;
      const byText = scope.getByText(pattern);
      if (await clickFirstEnabled(byText)) return true;
    }
  }

  return false;
}

async function clickArticleNextButton(page) {
  const scopes = getAllScopes(page);
  for (const scope of scopes) {
    const btn = scope.locator("button.custom-button.submit").filter({ hasText: /下一步/ }).first();
    if (await btn.count().catch(() => 0)) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await btn.click({ timeout: 2000, force: true });
        await writeRunDebugJson("next_click", { ok: true, via: "custom-button.submit" });
        return true;
      } catch {}
    }
  }
  for (const scope of scopes) {
    const btn = scope.locator("button").filter({ hasText: /下一步/ }).first();
    if (await btn.count().catch(() => 0)) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await btn.click({ timeout: 2000, force: true });
        await writeRunDebugJson("next_click", { ok: true, via: "button_text" });
        return true;
      } catch {}
    }
  }
  await writeRunDebugJson("next_click", { ok: false });
  return false;
}

async function isArticleEditorLikelyFilled(scope) {
  const titleBox = scope.locator('textarea[placeholder*="标题"]').first();
  if (await titleBox.count().catch(() => 0)) {
    const value = await titleBox.inputValue().catch(() => "");
    if (String(value).trim().length < 3) return false;
  }

  return true;
}

async function closeIncidentalModals(page) {
  const scopes = getAllScopes(page);
  const modalTitles = [/添加标记/, /选择标记/, /添加标签/];
  for (const scope of scopes) {
    for (const pattern of modalTitles) {
      const title = scope.getByText(pattern).first();
      if (await title.count()) {
        const visible = await title.isVisible().catch(() => false);
        if (!visible) continue;
        // 优先点击“取消”，避免误提交
        if (await clickButtonExactText(scope, "取消")) return true;
        const byRoleCancel = scope.getByRole("button", { name: /取消/ });
        if (await clickFirstEnabled(byRoleCancel)) return true;
        // 尝试关闭按钮
        const closeBtn = scope.locator('button[aria-label="Close"], .el-dialog__headerbtn, .d-dialog__close');
        if (await clickFirstEnabled(closeBtn)) return true;
      }
    }
  }
  return false;
}

async function hasIncidentalMarkModal(page) {
  const scopes = getAllScopes(page);
  const modalTitles = [/添加标记/, /选择标记/, /添加标签/];
  for (const scope of scopes) {
    for (const pattern of modalTitles) {
      const title = scope.getByText(pattern).first();
      if (!(await title.count().catch(() => 0))) continue;
      const ok = await title
        .evaluate((node) => {
          const cs = window.getComputedStyle(node);
          if (cs.display === "none" || cs.visibility === "hidden" || Number.parseFloat(cs.opacity || "1") < 0.1) return false;
          const r = node.getBoundingClientRect();
          if (!(r.width > 2 && r.height > 2)) return false;
          const dialog =
            node.closest('[aria-modal="true"]') ||
            node.closest('[role="dialog"]') ||
            node.closest(".el-dialog,.d-dialog,.dialog,.modal");
          return Boolean(dialog);
        })
        .catch(() => false);
      if (ok) return true;
    }
  }
  return false;
}

async function handleIncidentalMarkModal(page) {
  const ok = await page
    .evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const titleEl = Array.from(document.querySelectorAll("*")).find((el) => norm(el.textContent) === "添加标记");
      if (!titleEl) return null;
      const dialog =
        titleEl.closest('[aria-modal="true"]') ||
        titleEl.closest('[role="dialog"]') ||
        titleEl.closest(".el-dialog,.d-dialog,.dialog,.modal") ||
        titleEl.parentElement;
      if (!dialog) return null;

      const buttons = Array.from(dialog.querySelectorAll("button,[role='button']"));
      const pick = (name) =>
        buttons.find((b) => norm(b.textContent) === name && b.getAttribute("disabled") === null && b.getAttribute("aria-disabled") !== "true");
      const cancel = pick("取消") || pick("关闭");
      const skip = pick("跳过") || pick("稍后") || pick("暂不");
      const confirm = pick("确定") || pick("确认");

      const target = cancel || skip || confirm;
      if (!target) return null;
      target.scrollIntoView({ block: "center", inline: "center" });
      target.click();
      return norm(target.textContent);
    })
    .catch(() => null);
  return Boolean(ok);
}

async function collectPublishSettingsCandidates(page) {
  const result = await page
    .evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const viewport = { w: window.innerWidth || 0, h: window.innerHeight || 0 };

      const parseRgb = (v) => {
        const m = String(v || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!m) return null;
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
      };
      const redness = (rgb) => (rgb ? rgb.r - (rgb.g + rgb.b) / 2 : 0);

      const isVisible = (el) => {
        const cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        if (Number.parseFloat(cs.opacity || "1") < 0.1) return false;
        const r = el.getBoundingClientRect();
        if (!(r.width > 10 && r.height > 10)) return false;
        return true;
      };

      const isClickable = (el) => {
        const tag = (el.tagName || "").toLowerCase();
        if (tag === "button") return true;
        const role = el.getAttribute("role");
        if (role === "button") return true;
        const cs = window.getComputedStyle(el);
        if (cs.cursor === "pointer") return true;
        if (typeof el.onclick === "function") return true;
        return false;
      };

      const candidates = [];
      const all = Array.from(document.querySelectorAll("button,[role='button'],a,div,span"));
      for (let idx = 0; idx < all.length; idx += 1) {
        const el = all[idx];
        if (!isVisible(el)) continue;
        if (!isClickable(el)) continue;
        const inModal =
          !!(el.closest('[aria-modal="true"]') ||
             el.closest('[role="dialog"]') ||
             el.closest(".el-dialog,.d-dialog,.dialog,.modal"));
        if (inModal) continue;
        const t = norm(el.textContent);
        if (!(t === "发布" || t === "提交审核")) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom <= viewport.h * 0.7) continue;
        if (r.left >= viewport.w * 0.7) continue;
        if (r.width < 60 || r.height < 28) continue;
        const cs = window.getComputedStyle(el);
        const bg = parseRgb(cs.backgroundColor);
        const border = parseRgb(cs.borderTopColor);
        const color = parseRgb(cs.color);
        const bgScore = redness(bg);
        const borderScore = redness(border);
        const colorScore = redness(color);
        const bonus = t === "发布" ? 1000 : 0;
        const score = bgScore * 10 + borderScore * 2 + colorScore + bonus;
        candidates.push({
          idx,
          tag: (el.tagName || "").toLowerCase(),
          role: el.getAttribute("role") || "",
          className: String(el.className || ""),
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
          text: t,
          bg: cs.backgroundColor || "",
          border: cs.borderTopColor || "",
          color: cs.color || "",
          score,
        });
      }

      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ab = a.y + a.h;
        const bb = b.y + b.h;
        if (bb !== ab) return bb - ab;
        return a.x - b.x;
      });

      const picked = candidates[0] || null;
      return { viewport, candidates, picked };
    })
    .catch(() => null);

  if (!result) return null;
  await writeRunDebugJson("publish_candidates", result);
  return result;
}

async function clickPublishSettingsPublishButton(page) {
  const publishBtn = page
    .locator("button.publishBtn")
    .filter({ hasText: /^\\s*(发布|提交审核)\\s*$/ })
    .first();
  if (await publishBtn.count().catch(() => 0)) {
    await publishBtn.scrollIntoViewIfNeeded().catch(() => {});
    const enabled = await publishBtn.isEnabled().catch(() => true);
    await writeRunDebugJson("publish_click", { ok: false, phase: "precheck", selector: "button.publishBtn", enabled });
    try {
      await publishBtn.click({ timeout: 2000, force: true });
      await writeRunDebugJson("publish_click", { ok: true, via: "playwright", selector: "button.publishBtn" });
      return true;
    } catch (error) {
      await writeRunDebugJson("publish_click", { ok: false, via: "playwright", selector: "button.publishBtn", error: String(error?.message || error) });
    }
  }

  const result = await collectPublishSettingsCandidates(page);
  if (!result?.picked) {
    await writeRunDebugJson("publish_click", { ok: false, via: "candidates", hasPicked: false });
    return false;
  }

  const { x, y, w, h } = result.picked;
  await writeRunDebugJson("publish_click", { ok: false, phase: "fallback_mouse", picked: result.picked });
  try {
    await page.mouse.click(x + w / 2, y + h / 2, { delay: 20 });
    await writeRunDebugJson("publish_click", { ok: true, via: "mouse", x: x + w / 2, y: y + h / 2 });
    return true;
  } catch (error) {
    await writeRunDebugJson("publish_click", { ok: false, via: "mouse", error: String(error?.message || error) });
    return false;
  }
}

async function tryPublishOnSettingsPage(page) {
  const publishClicked = await clickPublishSettingsPublishButton(page);
  if (!publishClicked) return false;
  await page.waitForTimeout(1500);
  await clickConfirmDialogsBestEffort(page);
  await page.waitForTimeout(1500);
  return !(await hasIncidentalMarkModal(page));
}

async function tryGenerateImagesInXhs(page, prompt) {
  const scopes = getAllScopes(page);
  const entryCandidates = scopes.flatMap((scope) => [
    scope.getByRole("button", { name: /AI配图|智能配图|文生图|AI生成|生成图片/ }).first(),
    scope.getByText(/AI配图|智能配图|文生图|AI生成|生成图片/).first(),
  ]);

  let opened = false;
  for (const locator of entryCandidates) {
    if (await locator.count()) {
      const enabled = await locator.isEnabled().catch(() => true);
      if (!enabled) continue;
      await locator.click({ timeout: 1500 }).catch(() => {});
      opened = true;
      break;
    }
  }
  if (!opened) return false;

  const promptBox = page.locator('textarea[placeholder*="提示"], textarea[placeholder*="描述"], textarea[placeholder*="关键词"], input[placeholder*="提示"], input[placeholder*="描述"]').first();
  if (await promptBox.count()) {
    await promptBox.fill(String(prompt).slice(0, 200)).catch(() => {});
  }

  const genButtons = [
    page.getByRole("button", { name: /生成|开始|一键生成/ }).first(),
    page.getByText(/生成|开始|一键生成/).first(),
  ];
  for (const btn of genButtons) {
    if (await btn.count()) {
      const enabled = await btn.isEnabled().catch(() => true);
      if (!enabled) continue;
      await btn.click({ timeout: 2000 }).catch(() => {});
      break;
    }
  }

  await page.waitForTimeout(2500);

  const imageCandidates = page.locator("img");
  const imgCount = await imageCandidates.count();
  if (!imgCount) return false;

  for (let i = 0; i < Math.min(30, imgCount); i += 1) {
    const img = imageCandidates.nth(i);
    try {
      const box = await img.boundingBox();
      if (!box || box.width < 120 || box.height < 120) continue;
      await img.click({ timeout: 1500 }).catch(() => {});
      break;
    } catch {}
  }

  const confirmButtons = [
    ...scopes.map((scope) => scope.getByRole("button", { name: /使用|确定|完成|选用/ }).first()),
    ...scopes.map((scope) => scope.getByText(/使用|确定|完成|选用/).first()),
  ];
  for (const btn of confirmButtons) {
    if (await btn.count()) {
      const enabled = await btn.isEnabled().catch(() => true);
      if (!enabled) continue;
      await btn.click({ timeout: 1500 }).catch(() => {});
      return true;
    }
  }

  return true;
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const projectDir = path.resolve(getArg("--project-dir") || process.cwd());
  const filePath = getArg("--file");
  const profileDir = path.resolve(getArg("--profile-dir") || path.join(projectDir, ".xhs_profile"));
  let headless = getBoolArg("--headless", false);
  const dryRun = getBoolArg("--dry-run", false);
  const imagesCsv = getArg("--images");
  const imagesDir = getArg("--images-dir");
  const imageCount = getArg("--image-count");
  const loginOnly = getBoolArg("--login-only", false);
  const aiImage = getBoolArg("--ai-image", false);
  const unattended = getBoolArg("--unattended", false);
  const lingerMsArg = getIntArg("--linger-ms", 0);
  const target = (getArg("--target") || "").trim();
  const chromePath = pickChromeExecutable(getArg("--chrome-path"));

  if (loginOnly) {
    headless = false;
  }

  if (!loginOnly) {
    if (!filePath) {
      process.stderr.write("缺少 --file\n");
      process.exit(2);
    }
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`文件不存在: ${filePath}\n`);
      process.exit(2);
    }
  }
  if (!chromePath) {
    process.stderr.write("未找到可用的 Chrome/Edge/Chromium，可通过 --chrome-path 指定。\n");
    process.exit(1);
  }

  const note = loginOnly ? { title: "", content: "", images: [], type: "imgNote" } : parseNote(filePath);
  const { title, content } = note;

  if (dryRun) {
    process.stdout.write(`DRY RUN\nTITLE: ${title}\nCONTENT:\n${content}\n`);
    if (Array.isArray(note.images) && note.images.length) {
      process.stdout.write(`IMAGES:\n${note.images.join("\n")}\n`);
    }
    return;
  }

  const { chromium } = require("playwright-core");
  let context;
  let page;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      executablePath: chromePath,
      ignoreDefaultArgs: headless ? ["--enable-automation"] : undefined,
      args: headless ? ["--disable-blink-features=AutomationControlled"] : ["--start-maximized"],
      viewport: headless ? { width: 1400, height: 900 } : null,
      deviceScaleFactor: headless ? 2 : undefined,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("ProcessSingleton") || message.includes("SingletonLock") || message.includes("profile is already in use")) {
      process.stderr.write(
        [
          "启动浏览器失败：profileDir 正在被占用（或上次异常退出遗留锁）。",
          `profileDir: ${profileDir}`,
          "处理办法（二选一）：",
          "1) 关闭所有 Chrome/Edge/Chromium 后重试",
          `2) 换一个 profile 目录：./xhs_auto.sh login --profile-dir ./.xhs_profile_2`,
          `如果确认没有浏览器在使用该目录，也可以手动删除：${path.join(profileDir, "SingletonLock")}`,
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
    process.stderr.write(`${String(error?.stack || error)}\n`);
    process.exit(1);
  }

  const runTs = formatTimestamp(new Date());
  const runLogDir = path.join(projectDir, "logs", "xhs");
  await fs.promises.mkdir(runLogDir, { recursive: true }).catch(() => {});
  globalThis.__xhsAutoRun = { runTs, runLogDir, seq: 0 };

  try {
    page = context.pages()[0] ?? (await context.newPage());
    registerExitHandlers({ projectDir, context, page });
    const effectiveTarget = target || note.type || "imgNote";
    const publishUrl =
      effectiveTarget === "article"
        ? "https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=article"
        : "https://creator.xiaohongshu.com/publish/imgNote";
    await page.goto(publishUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await normalizePageView(page);
    await fs.promises.writeFile(path.join(runLogDir, `${runTs}_run.url.txt`), `${page.url()}\n`, "utf8").catch(() => {});
    await writeDebugArtifactsExtended({ projectDir, page, label: "run" }).catch(() => {});

  if (loginOnly) {
    process.stdout.write("请在打开的窗口中完成登录；确认能进入发布页后，回到终端按回车退出。\n");
    await waitForEnter("按回车关闭窗口并退出…");
    await context.close();
    return;
  }

  const currentUrl = page.url();
  if (headless && (/(^|\/)login(\?|\/|$)/i.test(currentUrl) || (await isLikelyLoginPage(page)))) {
    process.stderr.write("检测到需要登录/验证码页面。请先用 --headful 登录一次，让登录态写入 profileDir，然后再用 headless 自动发布。\n");
    const artifacts = await writeDebugArtifactsExtended({ projectDir, page, label: "need_login" });
    process.stderr.write(`已保存排查截图: ${artifacts.screenshotPath}\n`);
    await context.close();
    process.exit(1);
  }

  if (!headless) {
    process.stdout.write(
      [
        "已打开小红书发布页（可视模式）。",
        "1) 如果跳到登录页：请先在浏览器窗口中完成登录",
        `2) 登录完成/回到发布页后，会自动尝试填充标题/正文并点击发布（target=${effectiveTarget})`,
        "3) 如果提示需要验证码/其它强校验，需要你手动处理",
        "",
      ].join("\n") + "\n",
    );
  }

  if (effectiveTarget === "article") {
    await ensureArticleEditorOpen(page);
    await normalizePageView(page);
  }

  const editorScope = await waitForEditor(page, headless ? 25_000 : 10 * 60_000);
  if (!editorScope) {
    process.stderr.write("未检测到发布编辑器输入框。可能仍在登录页/页面结构变更。\n");
    if (headless) {
      process.stderr.write("提示：headless 模式下如果登录态失效/触发风控，页面可能不会出现编辑器。建议先执行：./xhs_auto.sh login --headful\n");
    }
    const artifacts = await writeDebugArtifactsExtended({ projectDir, page, label: "no_editor" });
    process.stderr.write(`已保存排查截图: ${artifacts.screenshotPath}\n`);
    process.stderr.write(`当前 URL: ${page.url()}\n`);
    process.stderr.write(`URL 记录: ${artifacts.urlPath}\n`);
    process.stderr.write(`HTML 记录: ${artifacts.htmlPath}\n`);
    process.stderr.write(`Frames 记录: ${artifacts.framesPath}\n`);
    if (!headless) {
      await waitForEnter("请在浏览器窗口中处理完成后按回车退出…");
      await context.close();
    } else {
      await context.close();
      process.exit(1);
    }
    return;
  }

  const imagesFromNote = Array.isArray(note.images) ? note.images : [];
  const imagesFromArgs = pickImages({ projectDir, imagesCsv, imagesDir, imageCount });
  const images = aiImage ? [] : (imagesFromNote.length ? imagesFromNote : imagesFromArgs);

  registerFileChooserAutoSet(page, images);

  if (effectiveTarget === "imgNote" && images.length) {
    const uploaded = await uploadImagesBestEffort(page, images);
    if (!uploaded) {
      process.stdout.write("未能自动上传图片（未找到可用的文件上传 input）。你可以改用 --headful 手动上传，或反馈页面结构我再适配。\n");
    }
  } else if (effectiveTarget === "imgNote" && aiImage) {
    const prompt = `${title}\n${content}`.trim();
    const ok = await tryGenerateImagesInXhs(page, prompt);
    if (!ok) {
      process.stdout.write("未找到/无法触发网页端 AI 配图入口。可能当前账号/页面不支持该功能，建议继续用本地图片上传。\n");
    }
  } else if (effectiveTarget === "imgNote") {
    process.stdout.write("未提供图片。网页端图文笔记通常需要至少 1 张图，建议用 --images-dir ./xhs_images 或 --images a.jpg,b.jpg\n");
  }

  let clickedAny = false;
  let formattedOnce = false;
  let savedMarkModal = false;
  let savedPublishFail = false;
  let savedPublishPage = false;
  let savedAfterPublishClick = false;

  for (let i = 0; i < 12; i += 1) {
    if (effectiveTarget === "article") {
      const publishCandidates = await collectPublishSettingsCandidates(page).catch(() => null);
      if (publishCandidates?.picked || (await isArticlePublishSettingsStep(page))) {
        if (!headless) await normalizePageView(page);
        if (!savedPublishPage) {
          await writeDebugArtifactsExtended({ projectDir, page, label: "publish_page" });
          savedPublishPage = true;
        }

        await handleIncidentalMarkModal(page);
        await closeIncidentalModals(page);

        const clickedPublish = await retryTimes(async () => {
          await handleIncidentalMarkModal(page);
          await closeIncidentalModals(page);
          return clickPublishSettingsPublishButton(page);
        }, 6, 500);

        await writeRunDebugJson("publish_attempt", {
          step: "settings",
          clickedPublish,
          hasMarkModal: await hasIncidentalMarkModal(page).catch(() => null),
          url: page.url(),
        });

        if (clickedPublish) {
          clickedAny = true;
          if (!savedAfterPublishClick) {
            await writeDebugArtifactsExtended({ projectDir, page, label: "after_publish_click" }).catch(() => {});
            savedAfterPublishClick = true;
          }
          await page.waitForTimeout(1500);
          await clickConfirmDialogsBestEffort(page);
          await page.waitForTimeout(1500);
          const published = await waitForPublishResult(page, 25_000);
          if (published) break;
        } else if (!savedPublishFail) {
          await writeDebugArtifactsExtended({ projectDir, page, label: "publish_click_failed" });
          savedPublishFail = true;
        }

        await page.waitForTimeout(1000);
        continue;
      }

      if (await isArticleCoverStep(page)) {
        if (!headless) await normalizePageView(page);
        await closeIncidentalModals(page);
        if (!savedPublishPage) {
          const maybePublish = page.locator("button.publishBtn, button,[role='button']").filter({ hasText: /^\\s*发布\\s*$/ }).first();
          if (await maybePublish.count().catch(() => 0)) {
            await writeDebugArtifactsExtended({ projectDir, page, label: "publish_page" });
            savedPublishPage = true;
          }
        }
        if (images.length) await uploadCoverImagesBestEffort(page, images);
        if (await isUploadingHint(page)) {
          await page.waitForTimeout(1500);
          continue;
        }
        const clickedPublish = await retryTimes(async () => {
          await closeIncidentalModals(page);
          return clickArticlePublishButton(page);
        }, 5, 500);
        if (clickedPublish) {
          clickedAny = true;
          if (!savedAfterPublishClick) {
            await writeDebugArtifactsExtended({ projectDir, page, label: "after_publish_click" }).catch(() => {});
            savedAfterPublishClick = true;
          }
          await page.waitForTimeout(2000);
          await clickConfirmDialogsBestEffort(page);
          await page.waitForTimeout(1500);
          const published = await waitForPublishResult(page, 20_000);
          if (published) break;
          continue;
        }
        if (await hasIncidentalMarkModal(page)) {
          if (!savedMarkModal) {
            await writeDebugArtifactsExtended({ projectDir, page, label: "mark_modal" });
            savedMarkModal = true;
          }
          await closeIncidentalModals(page);
          continue;
        }
        if (!savedPublishFail) {
          await writeDebugArtifactsExtended({ projectDir, page, label: "publish_click_failed" });
          savedPublishFail = true;
        }
        const clickedConfirm = await clickConfirmDialogsBestEffort(page);
        if (clickedConfirm) {
          clickedAny = true;
          await page.waitForTimeout(2000);
          const published = await waitForPublishResult(page, 20_000);
          if (published) break;
          continue;
        }
      } else {
        const fastNext = await retryTimes(() => clickArticleNextButton(page), 2, 150);
        if (fastNext) {
          clickedAny = true;
          await page.waitForTimeout(200);
          await waitForArticlePublishStep(page, 15_000);
          continue;
        }
        if (await hasIncidentalMarkModal(page)) {
          if (!savedMarkModal) {
            await writeDebugArtifactsExtended({ projectDir, page, label: "mark_modal" });
            savedMarkModal = true;
          }
          await handleIncidentalMarkModal(page);
        }
        await closeIncidentalModals(page);
        const freshScope = await waitForEditor(page, 8000);
        if (!freshScope) {
          await ensureArticleEditorOpen(page);
        }
        const scope = freshScope || (await waitForEditor(page, 8000));
        if (!scope) break;

        const filled = await isArticleEditorLikelyFilled(scope);
        if (!filled && ((await isMissingTitle(page)) || i === 0)) {
          await fillBestEffort(scope, page, title, content);
        }

        await acceptAgreementsBestEffort(page);

        if (await hasIncidentalMarkModal(page)) {
          await writeDebugArtifactsExtended({ projectDir, page, label: "mark_modal" });
          await closeIncidentalModals(page);
        }
        await closeIncidentalModals(page);
        const nextClicked = await retryTimes(() => clickArticleNextButton(page), 8, 300);
        if (nextClicked) {
          clickedAny = true;
          await page.waitForTimeout(300);
          await waitForArticlePublishStep(page, 15_000);
          continue;
        }
        if (!formattedOnce) {
          const didFormat = await clickOneKeyFormat(page);
          if (didFormat) {
            formattedOnce = true;
            clickedAny = true;
            await page.waitForTimeout(1200);
            continue;
          }
        }
        const pwClicked =
          (await playwrightClickButtonByTextAnyScope(page, [/^\\s*下一步\\s*$/])) ||
          (await playwrightClickButtonByTextAnyScope(page, [/^\\s*提交审核\\s*$/])) ||
          (await playwrightClickButtonByTextAnyScope(page, [/^\\s*发布文章\\s*$/]));
        if (pwClicked) {
          clickedAny = true;
          await page.waitForTimeout(2000);
          const advanced = await isArticleCoverStep(page);
          if (advanced) continue;
          continue;
        }
        const domClicked =
          (await domClickBottomBarButtonAnyScope(page, ["下一步"])) ||
          (await domClickByExactText(page, ["下一步", "提交审核", "发布文章", "确认发布", "确定", "确认", "完成"])) ||
          (await domClickBottomBarButtonAnyScope(page, ["提交审核", "发布文章"]));
        if (domClicked) {
          clickedAny = true;
          await page.waitForTimeout(2000);
          continue;
        }

        const clickedNext =
          (await clickPublishBestEffort(page, effectiveTarget)) ||
          (await clickPublishBestEffort(scope, effectiveTarget));

        if (clickedNext) {
          clickedAny = true;
          await page.waitForTimeout(2000);
          continue;
        }

        break;
      }
    } else {
      await fillBestEffort(editorScope, page, title, content);
      await acceptAgreementsBestEffort(page);
      const clicked =
        (await clickPublishBestEffort(page, effectiveTarget)) ||
        (await clickPublishBestEffort(editorScope, effectiveTarget));
      if (!clicked) break;
      clickedAny = true;
      await page.waitForTimeout(2000);
    }
  }

  if (!clickedAny) {
    await dumpBlockerHints(page);
    await dumpButtonHints(page);
    process.stdout.write(
      [
        "未找到可点击的“发布/下一步”按钮，常见原因：",
        "- 未上传图片（网页端图文通常要求至少 1 张图）",
        "- 有必填项未完成（话题/分类/封面/协议勾选等）",
        "- 标题/正文超限导致按钮禁用",
        "- 页面结构更新或按钮在屏幕外（缩放/滚动到顶部）",
        "",
      ].join("\n") + "\n",
    );
    const artifacts = await writeDebugArtifactsExtended({ projectDir, page, label: "no_publish_button" });
    process.stdout.write(`已保存排查截图: ${artifacts.screenshotPath}\n`);
    process.stdout.write(`HTML 记录: ${artifacts.htmlPath}\n`);
    process.stdout.write(`Frames 记录: ${artifacts.framesPath}\n`);
  } else {
    const published = await waitForPublishResult(page, 20_000);
    if (published) {
      process.stdout.write("已检测到发布/提交结果提示。\n");
    } else {
      process.stdout.write(
        [
          "已尝试触发“下一步/发布”按钮，但未检测到发布成功/提交成功提示。",
          "常见原因：需要补全必填项（分类/封面/声明/协议勾选等）或触发风控/验证码。",
          "",
        ].join("\n") + "\n",
      );
      const artifacts = await writeDebugArtifactsExtended({ projectDir, page, label: "publish_not_confirmed" });
      process.stdout.write(`已保存排查截图: ${artifacts.screenshotPath}\n`);
      process.stdout.write(`HTML 记录: ${artifacts.htmlPath}\n`);
      process.stdout.write(`Frames 记录: ${artifacts.framesPath}\n`);
    }
  }

  if (!headless && !unattended) {
    await waitForEnter("如需继续手动补图/检查发布结果，请在完成后按回车关闭窗口…");
  } else if (!headless && unattended) {
    const lingerMs = lingerMsArg > 0 ? lingerMsArg : 15_000;
    await page.waitForTimeout(lingerMs).catch(() => {});
  }

  } catch (error) {
    process.stderr.write(`${String(error?.stack || error)}\n`);
    if (page) {
      await writeDebugArtifactsExtended({ projectDir, page, label: "crash" }).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    if (page && !headless) {
      const artifacts = await writeDebugArtifactsExtended({ projectDir, page, label: "final" }).catch(() => null);
      if (artifacts?.screenshotPath) process.stdout.write(`最终状态截图: ${artifacts.screenshotPath}\n`);
    }
    await context.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});

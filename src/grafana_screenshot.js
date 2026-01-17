const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { PNG } = require("pngjs");

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getIntArg(flag, fallback) {
  const raw = getArg(flag);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function getBoolArg(flag, fallback) {
  const raw = getArg(flag);
  if (!raw) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
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

async function expandScrollableContainers(page) {
  await page.evaluate(() => {
    const candidates = [];
    const elements = Array.from(document.querySelectorAll("*"));

    for (const element of elements) {
      const style = window.getComputedStyle(element);
      if (!style) continue;

      const overflowY = style.overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll") continue;

      const clientHeight = element.clientHeight;
      const scrollHeight = element.scrollHeight;
      if (!clientHeight || !scrollHeight) continue;
      if (scrollHeight - clientHeight < 300) continue;

      candidates.push({ element, scrollHeight });
    }

    candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
    const toExpand = candidates.slice(0, 5);

    for (const { element } of toExpand) {
      element.style.overflow = "visible";
      element.style.overflowY = "visible";
      element.style.maxHeight = "none";
      element.style.height = "auto";
    }
  });
}

async function findScrollTarget(page) {
  const handle = await page.evaluateHandle(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollingElement =
      document.scrollingElement || document.documentElement || document.body;

    const candidates = [];

    function addCandidate(el) {
      if (!el) return;
      const style = window.getComputedStyle(el);
      if (!style) return;

      const clientHeight = el.clientHeight;
      const clientWidth = el.clientWidth;
      const scrollHeight = el.scrollHeight;

      if (!clientHeight || !clientWidth || !scrollHeight) return;
      if (scrollHeight - clientHeight < 300) return;

      const rect = el.getBoundingClientRect();
      if (!rect || rect.width < viewportWidth * 0.5) return;
      if (rect.height < viewportHeight * 0.4) return;

      const overflowY = style.overflowY;
      const isScrollableStyle = overflowY === "auto" || overflowY === "scroll";
      const isDocumentScroller = el === scrollingElement;
      if (!isScrollableStyle && !isDocumentScroller) return;

      const score =
        (scrollHeight - clientHeight) +
        rect.height * 2 +
        rect.width +
        (isDocumentScroller ? 100 : 0);
      candidates.push({ el, score });
    }

    addCandidate(scrollingElement);
    addCandidate(document.documentElement);
    addCandidate(document.body);

    const elements = Array.from(document.querySelectorAll("*"));
    for (const el of elements) addCandidate(el);

    candidates.sort((a, b) => b.score - a.score);
    return (candidates[0] && candidates[0].el) || scrollingElement;
  });

  return handle.asElement();
}

async function stitchPngBuffersVertically(buffers, outputPath) {
  const images = buffers.map((buffer) => PNG.sync.read(buffer));
  const width = images.reduce((max, img) => Math.max(max, img.width), 0);
  const height = images.reduce((sum, img) => sum + img.height, 0);

  const out = new PNG({ width, height });
  out.data.fill(0);

  let yOffset = 0;
  for (const img of images) {
    for (let y = 0; y < img.height; y += 1) {
      const srcStart = (y * img.width) * 4;
      const srcEnd = srcStart + img.width * 4;
      const dstStart = ((yOffset + y) * width) * 4;
      img.data.copy(out.data, dstStart, srcStart, srcEnd);
    }
    yOffset += img.height;
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, PNG.sync.write(out));
}

async function screenshotScrollableElement(page, element, outputPath, waitMs) {
  const metrics = await page.evaluate((el) => {
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const clientWidth = el.clientWidth;
    const rect = el.getBoundingClientRect();
    return {
      scrollHeight,
      clientHeight,
      clientWidth,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }, element);

  const bbox = await element.boundingBox();
  if (!bbox) {
    throw new Error("无法获取滚动容器的可视区域大小（boundingBox 为空）");
  }

  const clipX = bbox.x;
  const clipY = bbox.y;
  const clipWidth = Math.ceil(bbox.width);
  const clipHeight = Math.ceil(bbox.height);

  const scrollHeight = metrics.scrollHeight;
  const clientHeight = metrics.clientHeight || clipHeight;

  const positions = [];
  for (let top = 0; top < scrollHeight; top += clientHeight) {
    positions.push(top);
  }
  const lastTop = Math.max(0, scrollHeight - clientHeight);
  positions.push(lastTop);

  const uniquePositions = Array.from(new Set(positions));
  uniquePositions.sort((a, b) => a - b);

  const buffers = [];
  for (const top of uniquePositions) {
    await element.evaluate((el, t) => {
      el.scrollTop = t;
    }, top);

    await page.waitForTimeout(waitMs);

    const remaining = Math.max(0, scrollHeight - top);
    const thisClipHeight = Math.max(
      1,
      Math.ceil(Math.min(clipHeight, remaining)),
    );

    const buffer = await page.screenshot({
      clip: { x: clipX, y: clipY, width: clipWidth, height: thisClipHeight },
    });
    buffers.push(buffer);
  }

  await stitchPngBuffersVertically(buffers, outputPath);
}

async function main() {
  const url = getArg("--url");
  const output = getArg("--output");
  const waitMs = getIntArg("--wait-ms", 30_000);
  const timeoutMs = getIntArg("--timeout-ms", 120_000);
  const scrollWaitMs = getIntArg("--scroll-wait-ms", 250);
  const width = getIntArg("--width", 1600);
  const height = getIntArg("--height", 900);
  const chromePath = pickChromeExecutable(getArg("--chrome-path"));
  const userDataDir = getArg("--user-data-dir");
  const profileDirectory = getArg("--profile-directory");
  const headless = getBoolArg("--headless", true);
  const stitch = getBoolArg("--stitch", true);

  if (!url || !output) {
    process.stderr.write(
      "Usage: node grafana_screenshot.js --url <url> --output <path> [--wait-ms 30000] [--scroll-wait-ms 250] [--stitch true|false] [--width 1600] [--height 900] [--timeout-ms 120000] [--chrome-path <path>] [--user-data-dir <dir>] [--profile-directory <name>] [--headless true|false]\n",
    );
    process.exit(2);
  }

  if (!chromePath) {
    process.stderr.write(
      "未找到可用的 Chrome/Edge/Chromium 可执行文件。请安装 Google Chrome，或通过 --chrome-path 指定浏览器路径。\n",
    );
    process.exit(1);
  }

  if (!userDataDir) {
    process.stderr.write("缺少 --user-data-dir，用于保存登录态与 Cookie。\n");
    process.exit(2);
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    executablePath: chromePath,
    viewport: { width, height },
    deviceScaleFactor: 2,
    args: profileDirectory ? [`--profile-directory=${profileDirectory}`] : [],
  });

  const page = context.pages()[0] ?? (await context.newPage());

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition-duration: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForTimeout(waitMs);
  await expandScrollableContainers(page);

  const target = await findScrollTarget(page);
  if (!target) {
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output, fullPage: true });
    await context.close();
    return;
  }

  const isDocumentScroller = await page.evaluate((el) => {
    const scrollingElement =
      document.scrollingElement || document.documentElement || document.body;
    return (
      el === scrollingElement || el === document.documentElement || el === document.body
    );
  }, target);

  if (isDocumentScroller || !stitch) {
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output, fullPage: true });
  } else {
    await screenshotScrollableElement(page, target, output, scrollWaitMs);
  }

  await context.close();
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exit(1);
});


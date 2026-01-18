const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const YAML = require("yaml");

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
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

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDate(now) {
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
}

function formatTimestamp(now) {
  return `${formatDate(now)}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

function renderTemplate(input, vars) {
  if (!input) return input;
  return String(input).replace(/\$\{(\w+)\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
    return "";
  });
}

function normalizeTargets(config) {
  if (!config || typeof config !== "object") return [];
  if (Array.isArray(config.targets)) return config.targets;
  if (Array.isArray(config.dashboards)) return config.dashboards;
  if (Array.isArray(config.jobs)) return config.jobs;
  return [];
}

function pick(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function runScreenshot({ depsDir, appDir, screenshotArgs }) {
  const nodePath = path.join(depsDir, "node_modules");
  const env = { ...process.env, NODE_PATH: nodePath };

  const result = spawnSync(
    process.execPath,
    [path.join(appDir, "src", "grafana_screenshot.js"), ...screenshotArgs],
    { env, stdio: "inherit" },
  );

  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const projectDir = path.resolve(getArg("--project-dir") || path.join(__dirname, "..", "..", ".."));
  const appDir = path.resolve(getArg("--app-dir") || path.join(projectDir, "apps", "grafana"));
  const depsDir = path.resolve(getArg("--deps-dir") || path.join(projectDir, ".deps"));
  const configPath = path.resolve(getArg("--config") || path.join(projectDir, "grafana_auto.yaml"));
  const targetName = getArg("--target");
  const headless = getBoolArg("--headless", true);
  const overrideOutDir = getArg("--out-dir");
  const overrideProfileDir = getArg("--profile-dir");
  const overrideProfileName = getArg("--profile-name");
  const overrideWidth = getIntArg("--width", undefined);
  const overrideHeight = getIntArg("--height", undefined);
  const overrideWaitSeconds = getIntArg("--wait", undefined);
  const overrideScrollWaitMs = getIntArg("--scroll-wait-ms", undefined);
  const overrideStitch = getBoolArg("--stitch", undefined);
  const headful = hasFlag("--headful");

  if (!fs.existsSync(configPath)) {
    process.stderr.write(`配置文件不存在: ${configPath}\n`);
    process.exit(1);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const config = YAML.parse(raw) || {};

  const defaults = (config.defaults && typeof config.defaults === "object") ? config.defaults : {};
  const targets = normalizeTargets(config);
  if (!targets.length) {
    process.stderr.write("配置文件中未找到 targets（或 dashboards/jobs）数组。\n");
    process.exit(1);
  }

  const selected = targetName
    ? targets.filter((t) => t && typeof t === "object" && (t.name === targetName || t.id === targetName))
    : targets;

  if (!selected.length) {
    process.stderr.write(`未找到 target: ${targetName}\n`);
    process.exit(1);
  }

  const now = new Date();
  const baseVars = {
    date: formatDate(now),
    timestamp: formatTimestamp(now),
  };

  for (const target of selected) {
    const name = pick(target.name, pick(target.id, "grafana"));
    const vars = { ...baseVars, name };

    const enabled = normalizeBoolean(pick(target.enabled, defaults.enabled), true);
    if (!enabled) {
      process.stdout.write(`已跳过（enabled=false）: ${name}\n`);
      continue;
    }

    const url = pick(target.url, defaults.url);
    if (!url) {
      process.stderr.write(`target 缺少 url: ${name}\n`);
      process.exit(1);
    }

    const waitSeconds = pick(
      overrideWaitSeconds,
      pick(target.waitSeconds, pick(defaults.waitSeconds, 30)),
    );

    const width = pick(overrideWidth, pick(target.width, pick(defaults.width, 1600)));
    const height = pick(overrideHeight, pick(target.height, pick(defaults.height, 900)));
    const scrollWaitMs = pick(
      overrideScrollWaitMs,
      pick(target.scrollWaitMs, pick(defaults.scrollWaitMs, 250)),
    );
    const stitch = pick(
      overrideStitch,
      pick(target.stitch, pick(defaults.stitch, true)),
    );

    const profileDir = pick(
      overrideProfileDir,
      pick(target.profileDir, pick(defaults.profileDir, path.join(projectDir, ".grafana_auto_profile"))),
    );
    const profileName = pick(
      overrideProfileName,
      pick(target.profileName, defaults.profileName),
    );

    const outDir = renderTemplate(
      pick(overrideOutDir, pick(target.outDir, pick(defaults.outDir, path.join(projectDir, "screenshots")))),
      vars,
    );

    const filenameTemplate = pick(
      target.filename,
      pick(defaults.filename, "${name}_${timestamp}.png"),
    );
    const filename = renderTemplate(filenameTemplate, vars);
    const outputPath = path.resolve(outDir, filename);

    process.stdout.write(`正在生成长截图: ${name}\n`);

    const screenshotArgs = [
      "--url",
      url,
      "--output",
      outputPath,
      "--wait-ms",
      String(waitSeconds * 1000),
      "--scroll-wait-ms",
      String(scrollWaitMs),
      "--stitch",
      stitch ? "true" : "false",
      "--width",
      String(width),
      "--height",
      String(height),
      "--user-data-dir",
      profileDir,
      "--headless",
      headful ? "false" : (headless ? "true" : "false"),
    ];

    if (profileName) {
      screenshotArgs.push("--profile-directory", profileName);
    }

    runScreenshot({ depsDir, appDir, screenshotArgs });
    process.stdout.write(`完成: ${outputPath}\n`);
  }
}

main();


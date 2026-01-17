#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd
)"

GRAFANA_URL_DEFAULT=""
SCREENSHOT_DIR_DEFAULT="${SCRIPT_DIR}/screenshots"
WAIT_TIME_SECONDS_DEFAULT=60
WIDTH_DEFAULT=1600
HEIGHT_DEFAULT=900
PROFILE_DIR_DEFAULT="${SCRIPT_DIR}/.grafana_auto_profile"
HEADLESS_DEFAULT=1
CONFIG_PATH_LOCAL_DEFAULT="${SCRIPT_DIR}/grafana_auto.yaml"
CONFIG_PATH_LOCAL_ALT_DEFAULT="${SCRIPT_DIR}/grafana_auto.local.yaml"
CONFIG_PATH_TEMPLATE_DEFAULT="${SCRIPT_DIR}/grafana_auto.demo.yaml"

usage() {
  cat <<'USAGE'
Usage:
  ./grafana_auto.sh
  ./grafana_auto.sh --target <name> [--headful] [--wait <seconds>]
  ./grafana_auto.sh --config <path> [--target <name>]
  ./grafana_auto.sh --url <url> [--out-dir <dir>] [--wait <seconds>] [--headful]

Notes:
  - --target 必须跟一个 name，例如：--target grafana_project_a
  - 需要登录时建议：--headful 并配合 --wait 给足登录时间
USAGE
}

GRAFANA_URL="${GRAFANA_URL_DEFAULT}"
SCREENSHOT_DIR="${SCREENSHOT_DIR_DEFAULT}"
WAIT_TIME_SECONDS="${WAIT_TIME_SECONDS_DEFAULT}"
WIDTH="${WIDTH_DEFAULT}"
HEIGHT="${HEIGHT_DEFAULT}"
PROFILE_DIR="${PROFILE_DIR_DEFAULT}"
HEADLESS="${HEADLESS_DEFAULT}"
PROFILE_NAME=""
CONFIG_PATH="${CONFIG_PATH_LOCAL_DEFAULT}"
TARGET_NAME=""
USE_CONFIG=0
CLI_OVERRIDE=0
OVERRIDE_OUT_DIR=0
OVERRIDE_WAIT=0
OVERRIDE_WIDTH=0
OVERRIDE_HEIGHT=0
OVERRIDE_PROFILE_DIR=0
OVERRIDE_PROFILE_NAME=0
EXTRA_ARGS=()
CONFIG_SPECIFIED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--url <url>" >&2
        usage >&2
        exit 2
      fi
      GRAFANA_URL="${2}"
      CLI_OVERRIDE=1
      shift 2
      ;;
    --out-dir)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--out-dir <dir>" >&2
        usage >&2
        exit 2
      fi
      SCREENSHOT_DIR="${2}"
      CLI_OVERRIDE=1
      OVERRIDE_OUT_DIR=1
      shift 2
      ;;
    --wait)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--wait <seconds>" >&2
        usage >&2
        exit 2
      fi
      WAIT_TIME_SECONDS="${2}"
      CLI_OVERRIDE=1
      OVERRIDE_WAIT=1
      shift 2
      ;;
    --width)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--width <number>" >&2
        usage >&2
        exit 2
      fi
      WIDTH="${2}"
      CLI_OVERRIDE=1
      OVERRIDE_WIDTH=1
      shift 2
      ;;
    --height)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--height <number>" >&2
        usage >&2
        exit 2
      fi
      HEIGHT="${2}"
      CLI_OVERRIDE=1
      OVERRIDE_HEIGHT=1
      shift 2
      ;;
    --profile-dir)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--profile-dir <dir>" >&2
        usage >&2
        exit 2
      fi
      PROFILE_DIR="${2}"
      CLI_OVERRIDE=1
      OVERRIDE_PROFILE_DIR=1
      shift 2
      ;;
    --profile-name)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--profile-name <name>" >&2
        usage >&2
        exit 2
      fi
      PROFILE_NAME="${2}"
      CLI_OVERRIDE=1
      OVERRIDE_PROFILE_NAME=1
      shift 2
      ;;
    --config)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--config <path>" >&2
        usage >&2
        exit 2
      fi
      CONFIG_PATH="${2}"
      CONFIG_SPECIFIED=1
      USE_CONFIG=1
      shift 2
      ;;
    --target)
      if [[ $# -lt 2 ]]; then
        echo "缺少参数：--target <name>" >&2
        usage >&2
        exit 2
      fi
      TARGET_NAME="${2}"
      USE_CONFIG=1
      shift 2
      ;;
    --headful)
      HEADLESS=0
      CLI_OVERRIDE=1
      shift 1
      ;;
    --headless)
      HEADLESS=1
      CLI_OVERRIDE=1
      shift 1
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

echo "正在生成网页长截图..."
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node，请先安装 Node.js 后重试。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm，请先安装 Node.js（包含 npm）后重试。" >&2
  exit 1
fi

DEPS_DIR="${SCRIPT_DIR}/.grafana_auto_deps"
if [[ ! -d "${DEPS_DIR}/node_modules/playwright-core" ]] || [[ ! -d "${DEPS_DIR}/node_modules/pngjs" ]] || [[ ! -d "${DEPS_DIR}/node_modules/yaml" ]]; then
  (cd "${DEPS_DIR}" && npm install --no-fund --no-audit)
fi

if [[ ${CONFIG_SPECIFIED} -eq 0 ]] && [[ ! -f "${CONFIG_PATH}" ]]; then
  if [[ -f "${CONFIG_PATH_LOCAL_ALT_DEFAULT}" ]]; then
    CONFIG_PATH="${CONFIG_PATH_LOCAL_ALT_DEFAULT}"
  elif [[ -f "${CONFIG_PATH_TEMPLATE_DEFAULT}" ]]; then
    CONFIG_PATH="${CONFIG_PATH_TEMPLATE_DEFAULT}"
  fi
fi

if [[ ${USE_CONFIG} -eq 1 ]] || [[ -f "${CONFIG_PATH}" && ${CLI_OVERRIDE} -eq 0 ]]; then
  EXTRA_ARGS=()
  if [[ ${OVERRIDE_OUT_DIR} -eq 1 ]]; then EXTRA_ARGS+=(--out-dir "${SCREENSHOT_DIR}"); fi
  if [[ ${OVERRIDE_WAIT} -eq 1 ]]; then EXTRA_ARGS+=(--wait "${WAIT_TIME_SECONDS}"); fi
  if [[ ${OVERRIDE_WIDTH} -eq 1 ]]; then EXTRA_ARGS+=(--width "${WIDTH}"); fi
  if [[ ${OVERRIDE_HEIGHT} -eq 1 ]]; then EXTRA_ARGS+=(--height "${HEIGHT}"); fi
  if [[ ${OVERRIDE_PROFILE_DIR} -eq 1 ]]; then EXTRA_ARGS+=(--profile-dir "${PROFILE_DIR}"); fi
  if [[ ${OVERRIDE_PROFILE_NAME} -eq 1 ]]; then EXTRA_ARGS+=(--profile-name "${PROFILE_NAME}"); fi

  if [[ -n "${TARGET_NAME}" ]]; then
    NODE_PATH="${DEPS_DIR}/node_modules" node "${SCRIPT_DIR}/grafana_auto_runner.js" \
      --script-dir "${SCRIPT_DIR}" \
      --deps-dir "${DEPS_DIR}" \
      --config "${CONFIG_PATH}" \
      --target "${TARGET_NAME}" \
      --headless "${HEADLESS}" \
      ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
  else
    NODE_PATH="${DEPS_DIR}/node_modules" node "${SCRIPT_DIR}/grafana_auto_runner.js" \
      --script-dir "${SCRIPT_DIR}" \
      --deps-dir "${DEPS_DIR}" \
      --config "${CONFIG_PATH}" \
      --headless "${HEADLESS}" \
      ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
  fi
  exit 0
fi

if [[ -z "${GRAFANA_URL}" ]]; then
  echo "未提供截图链接。请在 grafana_auto.yaml 中配置 targets，或使用参数：--url <链接>" >&2
  exit 2
fi

mkdir -p "${SCREENSHOT_DIR}"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
SCREENSHOT_PATH="${SCREENSHOT_DIR}/grafana_${TIMESTAMP}.png"

WAIT_MS="$((WAIT_TIME_SECONDS * 1000))"

if [[ -n "${PROFILE_NAME}" ]]; then
  NODE_PATH="${DEPS_DIR}/node_modules" node "${SCRIPT_DIR}/grafana_screenshot.js" \
    --url "${GRAFANA_URL}" \
    --output "${SCREENSHOT_PATH}" \
    --wait-ms "${WAIT_MS}" \
    --width "${WIDTH}" \
    --height "${HEIGHT}" \
    --user-data-dir "${PROFILE_DIR}" \
    --profile-directory "${PROFILE_NAME}" \
    --headless "${HEADLESS}"
else
  NODE_PATH="${DEPS_DIR}/node_modules" node "${SCRIPT_DIR}/grafana_screenshot.js" \
    --url "${GRAFANA_URL}" \
    --output "${SCREENSHOT_PATH}" \
    --wait-ms "${WAIT_MS}" \
    --width "${WIDTH}" \
    --height "${HEIGHT}" \
    --user-data-dir "${PROFILE_DIR}" \
    --headless "${HEADLESS}"
fi

echo "完成！截图已保存到: ${SCREENSHOT_PATH}"

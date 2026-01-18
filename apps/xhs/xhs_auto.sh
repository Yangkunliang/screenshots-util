#!/usr/bin/env bash

set -euo pipefail

APP_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd
)"
PROJECT_DIR="$(
  cd "${APP_DIR}/../.."
  pwd
)"

usage() {
  cat <<'USAGE'
Usage:
  ./xhs_auto.sh
  ./xhs_auto.sh login [--target <imgNote|article>] [--headful] [--profile-dir <dir>]
  ./xhs_auto.sh write [--target <imgNote|article>] [--topic <keyword-or-index>] [--images <a,b,c>] [--images-dir <dir>] [--image-count <n>]
  ./xhs_auto.sh publish [--target <imgNote|article>] [--file <path>] [--headful] [--profile-dir <dir>] [--dry-run] [--images <a,b,c>] [--images-dir <dir>] [--image-count <n>] [--ai-image] [--unattended] [--linger-ms <ms>]

Notes:
  - write 会生成 100~200 字左右的 Java 知识点内容并保存到 posts/xhs/
  - publish 依赖网页端登录态（首次建议 --headful 登录一次）
USAGE
}

COMMAND="write"
TARGET=""
TOPIC=""
FILE_PATH=""
HEADLESS="true"
PROFILE_DIR=""
DRY_RUN=0
IMAGES=""
IMAGES_DIR=""
IMAGE_COUNT=""
AI_IMAGE=0
UNATTENDED=0
LINGER_MS=""

if [[ $# -gt 0 ]]; then
  case "$1" in
    login|write|publish)
      COMMAND="$1"
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --topic)
      TOPIC="${2:-}"
      shift 2
      ;;
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --file)
      FILE_PATH="${2:-}"
      shift 2
      ;;
    --images)
      IMAGES="${2:-}"
      shift 2
      ;;
    --images-dir)
      IMAGES_DIR="${2:-}"
      shift 2
      ;;
    --image-count)
      IMAGE_COUNT="${2:-}"
      shift 2
      ;;
    --profile-dir)
      PROFILE_DIR="${2:-}"
      shift 2
      ;;
    --headful)
      HEADLESS="false"
      shift 1
      ;;
    --headless)
      HEADLESS="true"
      shift 1
      ;;
    --dry-run)
      DRY_RUN=1
      shift 1
      ;;
    --ai-image)
      AI_IMAGE=1
      shift 1
      ;;
    --unattended)
      UNATTENDED=1
      shift 1
      ;;
    --linger-ms)
      LINGER_MS="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node，请先安装 Node.js 后重试。" >&2
  exit 1
fi

DEPS_DIR="${PROJECT_DIR}/.deps"
if [[ ! -d "${DEPS_DIR}/node_modules/playwright-core" ]]; then
  if [[ -d "${PROJECT_DIR}/.grafana_auto_deps/node_modules/playwright-core" ]]; then
    DEPS_DIR="${PROJECT_DIR}/.grafana_auto_deps"
  else
    (cd "${DEPS_DIR}" && npm install --no-fund --no-audit)
  fi
fi

if [[ "${COMMAND}" == "write" ]]; then
  NODE_PATH="${DEPS_DIR}/node_modules" node "${APP_DIR}/src/generate.js" \
    --project-dir "${PROJECT_DIR}" \
    ${TARGET:+--mode "${TARGET}"} \
    ${TOPIC:+--topic "${TOPIC}"} \
    ${IMAGES:+--images "${IMAGES}"} \
    ${IMAGES_DIR:+--images-dir "${IMAGES_DIR}"} \
    ${IMAGE_COUNT:+--image-count "${IMAGE_COUNT}"} \
    $([[ ${AI_IMAGE} -eq 1 ]] && echo --no-images true)
  exit 0
fi

if [[ "${COMMAND}" == "login" ]]; then
  if [[ "${HEADLESS}" == "true" ]]; then
    HEADLESS="false"
  fi
  NODE_PATH="${DEPS_DIR}/node_modules" node "${APP_DIR}/src/publish.js" \
    --project-dir "${PROJECT_DIR}" \
    --headless "${HEADLESS}" \
    ${PROFILE_DIR:+--profile-dir "${PROFILE_DIR}"} \
    ${TARGET:+--target "${TARGET}"} \
    --login-only true
  exit 0
fi

if [[ "${COMMAND}" == "publish" ]]; then
  if [[ -z "${FILE_PATH}" ]]; then
    FILE_PATH="$(NODE_PATH="${DEPS_DIR}/node_modules" node "${APP_DIR}/src/generate.js" --project-dir "${PROJECT_DIR}" ${TARGET:+--mode "${TARGET}"} ${TOPIC:+--topic "${TOPIC}"} ${IMAGES:+--images "${IMAGES}"} ${IMAGES_DIR:+--images-dir "${IMAGES_DIR}"} ${IMAGE_COUNT:+--image-count "${IMAGE_COUNT}"} $([[ ${AI_IMAGE} -eq 1 ]] && echo --no-images true) --print-path)"
  fi

  NODE_PATH="${DEPS_DIR}/node_modules" node "${APP_DIR}/src/publish.js" \
    --project-dir "${PROJECT_DIR}" \
    --file "${FILE_PATH}" \
    ${TARGET:+--target "${TARGET}"} \
    --headless "${HEADLESS}" \
    ${PROFILE_DIR:+--profile-dir "${PROFILE_DIR}"} \
    $([[ ${DRY_RUN} -eq 1 ]] && echo --dry-run true) \
    ${IMAGES:+--images "${IMAGES}"} \
    ${IMAGES_DIR:+--images-dir "${IMAGES_DIR}"} \
    ${IMAGE_COUNT:+--image-count "${IMAGE_COUNT}"} \
    $([[ ${AI_IMAGE} -eq 1 ]] && echo --ai-image true) \
    $([[ ${UNATTENDED} -eq 1 ]] && echo --unattended true) \
    ${LINGER_MS:+--linger-ms "${LINGER_MS}"}
  exit 0
fi

usage >&2
exit 2

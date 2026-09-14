#!/usr/bin/env bash
# ==========================================================================
# 竞析 JINGXI · GitHub Pages 一键部署
# --------------------------------------------------------------------------
# 做五件事：校验 token → 创建仓库 → 推送代码 → 开启 Pages → 轮询构建并输出地址
#
# 用法：
#   GITHUB_TOKEN=ghp_xxx bash tools/deploy-github.sh
#
# 可选环境变量：
#   REPO_NAME  仓库名，默认 jingxi-football
#   BRANCH     分支名，默认 main
#   PRIVATE    设为 1 则建私有仓库（私有仓库开启 Pages 需 GitHub Pro）
#
# 关于 token：GitHub 规定必须由账号授权才能创建仓库与推送代码，这是平台侧
# 的硬性要求，任何工具都无法代你完成。token 仅在本次运行中使用，不会写入
# .git/config，也不会进入提交历史。用完请到 https://github.com/settings/tokens 删除。
# ==========================================================================
set -euo pipefail

REPO_NAME="${REPO_NAME:-jingxi-football}"
BRANCH="${BRANCH:-main}"
PRIVATE_FLAG=false
[ "${PRIVATE:-0}" = "1" ] && PRIVATE_FLAG=true

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  printf '未检测到 GITHUB_TOKEN。请粘贴你的 GitHub Personal Access Token（仅需 repo 权限）：\n> '
  read -rs TOKEN
  echo
fi
if [ -z "$TOKEN" ]; then
  echo "未提供 token，退出。" >&2
  exit 1
fi

API="https://api.github.com"
HTTP_CODE=""
API_BODY=""

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }

# 注意：不用命令替换调用，否则变量在子 shell 中无法回传
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -o "$TMP/body" -w '%{http_code}' -X "$method"
              -H "Authorization: Bearer ${TOKEN}"
              -H "User-Agent: jingxi-deploy"
              -H "Accept: application/vnd.github+json"
              -H "X-GitHub-Api-Version: 2022-11-28"
              "${API}${path}")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" -d "$body")
  HTTP_CODE="$(curl "${args[@]}" 2>/dev/null)" || HTTP_CODE="000"
  API_BODY="$(cat "$TMP/body" 2>/dev/null || true)"
}

jget() { printf '%s' "$API_BODY" | /usr/bin/python3 -c \
  'import sys,json
try: print(json.load(sys.stdin).get(sys.argv[1],""))
except Exception: print("")' "$1" 2>/dev/null || true; }

# ---------------------------------------------------------------- 1. 校验 token
say "1/5  校验 token"
api GET /user
if [ "$HTTP_CODE" != "200" ]; then
  bad "token 无效或权限不足（HTTP ${HTTP_CODE}）"
  msg="$(jget message)"; [ -n "$msg" ] && echo "   GitHub 返回：${msg}" >&2
  exit 1
fi
OWNER="$(jget login)"
if [ -z "$OWNER" ]; then bad "无法获取账号信息"; exit 1; fi
ok "已认证为 ${OWNER}"

# ---------------------------------------------------------------- 2. 创建仓库
say "2/5  准备仓库 ${OWNER}/${REPO_NAME}"
api GET "/repos/${OWNER}/${REPO_NAME}"
if [ "$HTTP_CODE" = "200" ]; then
  ok "仓库已存在，将复用"
elif [ "$HTTP_CODE" = "404" ]; then
  BODY="$(printf '{"name":"%s","description":"%s","private":%s,"has_issues":true,"has_wiki":false,"has_projects":false,"auto_init":false}' \
          "$REPO_NAME" "竞析 JINGXI · 中国竞彩足球数据分析中心（纯静态 · Dixon-Coles 概率模型）" "$PRIVATE_FLAG")"
  api POST /user/repos "$BODY"
  if [ "$HTTP_CODE" = "201" ]; then
    ok "仓库创建成功"
  else
    bad "创建仓库失败（HTTP ${HTTP_CODE}）：$(jget message)"
    echo "   请确认 token 勾选了 repo 权限（classic token）。" >&2
    exit 1
  fi
else
  bad "查询仓库失败（HTTP ${HTTP_CODE}）：$(jget message)"
  exit 1
fi
REPO_URL="https://github.com/${OWNER}/${REPO_NAME}.git"

# ---------------------------------------------------------------- 3. 推送代码
say "3/5  推送代码"
git -C "$ROOT" rev-parse --verify HEAD >/dev/null 2>&1 || { bad "本地尚无提交，请先 commit"; exit 1; }
# 用已认证的 GitHub 账号作为提交身份，保证提交记录归属正确
git -C "$ROOT" config --local user.name "$OWNER"
git -C "$ROOT" config --local user.email "${OWNER}@users.noreply.github.com"
# 若仓库只有一条尚未推送的占位提交，改写成真实作者
if [ "$(git -C "$ROOT" rev-list --count HEAD)" = "1" ] \
   && [ "$(git -C "$ROOT" log -1 --format=%ae)" = "jingxi@localhost" ]; then
  git -C "$ROOT" commit --amend --reset-author --no-edit --quiet
  ok "提交作者已更新为 ${OWNER}"
fi
git -C "$ROOT" remote remove origin 2>/dev/null || true
git -C "$ROOT" remote add origin "$REPO_URL"
git -C "$ROOT" branch -M "$BRANCH"
# 凭据只出现在本次命令参数中，不写入 .git/config；同时禁用凭据缓存
if git -C "$ROOT" -c credential.helper= push --quiet \
     "https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO_NAME}.git" \
     "${BRANCH}:${BRANCH}" 2>"$TMP/push_err"; then
  ok "已推送到 ${BRANCH} 分支"
else
  bad "推送失败："; cat "$TMP/push_err" >&2
  echo "   提示：若 github.com 连接超时（国内网络常见），本项目另有国内直连镜像可用。" >&2
  exit 1
fi
git -C "$ROOT" remote set-url origin "$REPO_URL"   # 远程地址保持不含凭据
ok "remote origin = ${REPO_URL}（不含凭据）"

# ---------------------------------------------------------------- 4. 开启 Pages
say "4/5  开启 GitHub Pages"
PAGES_BODY="$(printf '{"source":{"branch":"%s","path":"/"}}' "$BRANCH")"
api POST "/repos/${OWNER}/${REPO_NAME}/pages" "$PAGES_BODY"
case "$HTTP_CODE" in
  201) ok "Pages 已开启（${BRANCH} / 根目录）" ;;
  409) api PUT "/repos/${OWNER}/${REPO_NAME}/pages" "$PAGES_BODY"
       if [ "$HTTP_CODE" = "204" ]; then ok "Pages 配置已更新"; else ok "Pages 此前已开启"; fi ;;
  422) ok "Pages 此前已开启" ;;
  *)   bad "开启 Pages 失败（HTTP ${HTTP_CODE}）：$(jget message)"
       echo "   可稍后到 ${REPO_URL%.git}/settings/pages 手动选择分支 ${BRANCH} + 根目录" >&2 ;;
esac

# ---------------------------------------------------------------- 5. 等待构建
SITE="https://${OWNER}.github.io/${REPO_NAME}/"
say "5/5  等待首次构建"
STATUS=""
for i in $(seq 1 20); do
  sleep 6
  api GET "/repos/${OWNER}/${REPO_NAME}/pages"
  STATUS="$(jget status)"
  printf '\r  构建状态：%s（第 %s 次检查）' "${STATUS:-pending}" "$i"
  [ "$STATUS" = "built" ] && break
done
echo

printf '\n\033[1m部署完成\033[0m\n'
echo "  仓库地址：https://github.com/${OWNER}/${REPO_NAME}"
echo "  访问地址：${SITE}"
[ "$STATUS" = "built" ] || echo "  （Pages 仍在构建中，通常 1~2 分钟后可访问）"
echo
echo "  国内直连镜像：https://jingxi-football.app.workbuddy.host/"
echo "  别忘了到 https://github.com/settings/tokens 删除本次使用的 token。"

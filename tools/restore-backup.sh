#!/bin/bash
# ==========================================================================
# 竞析 JINGXI · 一键恢复脚本（在目标电脑上运行）
#   ./restore.sh                     默认装到 ~/WorkBuddy/jingxi
#   ./restore.sh --dest ~/code/jingxi
#   ./restore.sh --no-secrets        不安装 GitHub 凭据
#   ./restore.sh --no-test           跳过测试
# ==========================================================================
set -u

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/WorkBuddy/jingxi"
WITH_SECRETS=1
RUN_TEST=1

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --no-secrets) WITH_SECRETS=0; shift ;;
    --no-test) RUN_TEST=0; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
done

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✘\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m[%s] %s\033[0m\n' "$1" "$2"; }

FAIL=0

step 1 "环境检查"
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"; ok "node $($NODE_BIN -v) → $NODE_BIN"
else
  for c in "$HOME/.workbuddy/binaries/node/versions/"*/bin/node; do
    [ -x "$c" ] && NODE_BIN="$c" && break
  done
  if [ -n "${NODE_BIN:-}" ]; then ok "node（WorkBuddy 内置）→ $NODE_BIN"; else bad "未找到 node，请先安装 Node.js ≥ 22"; FAIL=1; fi
fi
command -v git >/dev/null 2>&1 && ok "git $(git --version | awk '{print $3}')" || { bad "未找到 git"; FAIL=1; }
[ "$FAIL" = "1" ] && { echo; echo "环境不满足，请先安装缺失组件。"; exit 1; }

step 2 "复制项目代码"
mkdir -p "$(dirname "$DEST")"
if [ -e "$DEST" ]; then
  bad "目标已存在：$DEST（请换 --dest 或先移走）"; exit 1
fi
cp -R "$SRC/jingxi" "$DEST" && ok "已复制 → $DEST"

step 3 "项目记忆"
MEM_TARGET="$(dirname "$DEST")/.workbuddy/memory"
mkdir -p "$MEM_TARGET"
if ls "$SRC/workbuddy-memory/"*.md >/dev/null 2>&1; then
  cp "$SRC/workbuddy-memory/"*.md "$MEM_TARGET/" && ok "记忆文件 $(ls "$SRC/workbuddy-memory/"*.md | wc -l | tr -d ' ') 个 → $MEM_TARGET"
fi
[ -f "$SRC/workbuddy-memory/applications.yaml" ] && cp "$SRC/workbuddy-memory/applications.yaml" "$(dirname "$DEST")/.workbuddy/" && ok "发布元数据 applications.yaml"
[ -f "$SRC/.wbapp_bY7Fitt0oil6JUR1apaUrA.genie" ] && cp "$SRC/.wbapp_bY7Fitt0oil6JUR1apaUrA.genie" "$(dirname "$DEST")/" && ok "appId 元数据 .genie"

step 4 "GitHub 凭据"
if [ "$WITH_SECRETS" = "0" ]; then
  echo "  （--no-secrets：跳过）"
else
  if [ -f "$SRC/secrets/gh_jingxi_token" ]; then
    cp "$SRC/secrets/gh_jingxi_token" "$HOME/.gh_jingxi_token" && chmod 600 "$HOME/.gh_jingxi_token" && ok "token → ~/.gh_jingxi_token (600)"
  fi
  if [ -f "$SRC/secrets/gh-api-push-history.js" ]; then
    cp "$SRC/secrets/gh-api-push-history.js" "$HOME/.gh-api-push-history.js" && ok "推送脚本 → ~/.gh-api-push-history.js"
  fi
  if [ -f "$SRC/secrets/id_ed25519_github_jingxi" ]; then
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
    cp "$SRC/secrets/id_ed25519_github_jingxi" "$HOME/.ssh/" && chmod 600 "$HOME/.ssh/id_ed25519_github_jingxi" && ok "SSH 私钥 → ~/.ssh/"
    [ -f "$SRC/secrets/id_ed25519_github_jingxi.pub" ] && cp "$SRC/secrets/id_ed25519_github_jingxi.pub" "$HOME/.ssh/" && ok "SSH 公钥已复制"
  fi
  echo "  ⚠️  迁移完成后请删除备份里的 secrets/ 目录"
fi

step 5 "校验 Git 仓库"
cd "$DEST" || exit 1
if [ -d .git ]; then
  ok "HEAD = $(git log --oneline -1)"
  [ -z "$(git status --porcelain)" ] && ok "工作区干净" || bad "工作区有未提交改动（正常，若从旧机带过来）"
else
  bad "未找到 .git 目录"
fi

if [ "$RUN_TEST" = "1" ] && [ -n "${NODE_BIN:-}" ]; then
  step 6 "运行测试"
  if [ -d "$HOME/.workbuddy/binaries/node/workspace/node_modules" ]; then
    export NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules"
    ok "NODE_PATH 已指向 WorkBuddy node_modules"
  else
    # 兜底：在本机任意位置找一份含 jsdom 的 node_modules
    FOUND_NM="$(find "$HOME" -maxdepth 6 -type d -name node_modules -path '*workspace*' 2>/dev/null | head -1)"
    if [ -n "$FOUND_NM" ] && [ -d "$FOUND_NM/jsdom" ]; then
      export NODE_PATH="$FOUND_NM"; ok "NODE_PATH 自动定位 → $FOUND_NM"
    elif [ -d "$DEST/node_modules/jsdom" ]; then
      export NODE_PATH="$DEST/node_modules"; ok "使用项目内 node_modules"
    else
      echo "  ⚠️  未找到 jsdom，render/parlay/sim-compose 测试会失败。"
      echo "     修复：cd \"$DEST\" && npm i jsdom && export NODE_PATH=\"$DEST/node_modules\""
    fi
  fi
  for t in render-test parlay-interact-test sim-compose-test predict-providers-test; do
    out=$("$NODE_BIN" tools/$t.js 2>&1)
    rc=$?
    if [ $rc -eq 0 ] && ! printf '%s' "$out" | grep -qE '✘|FATAL|存在失败'; then
      printf '  \033[32m✓\033[0m %s — %s\n' "$t" "$(printf '%s' "$out" | grep -E '全部|通过' | tail -1 | sed 's/^ *//')"
    else
      printf '  \033[31m✘\033[0m %s 失败（exit=%s）：\n' "$t" "$rc"
      printf '%s\n' "$out" | tail -8 | sed 's/^/      /'
      FAIL=1
    fi
  done
fi

step 7 "完成"
cat <<EOF
  项目位置：$DEST
  本地预览：cd "$DEST" && python3 -m http.server 8080   →  http://localhost:8080
  刷新数据：node tools/make-snapshot.js
  查看详情：见 RESTORE.md（含推送通道、版本号流程、密钥配置）
EOF
[ "$FAIL" = "1" ] && { echo; echo "⚠️  有步骤未通过，请检查上面的输出。"; exit 1; }
echo
echo "✅ 恢复完成。"

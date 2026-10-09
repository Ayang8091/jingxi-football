# 竞析 JINGXI · 迁移恢复指南

备份日期：2026-10-09
备份内容：`jingxi/`（全量代码含 .git）+ 项目记忆 + 密钥/推送工具

---

## 一、这个包里有什么

| 目录/文件 | 内容 | 是否必需 |
|---|---|---|
| `jingxi/` | 站点全量代码（8 页面、assets、tools、api/snapshot.json、docs）+ **完整 .git 历史** | 必需 |
| `workbuddy-memory/` | 项目工作日志（2026-09-14 ~ 09-29）+ `MEMORY.md`（长期约定）+ `applications.yaml` | 强烈建议 |
| `secrets/` | GitHub 推送 token、API 推送脚本、SSH 密钥 | 需要推送才要 |
| `.wbapp_bY7Fitt0oil6JUR1apaUrA.genie` | WorkBuddy 发布元数据（含 appId，重新发布用） | 需要发布才要 |

⚠️ **`secrets/` 里是明文凭据**（GitHub token 等）。传到新机器并装好后，建议删除整个 `secrets/` 目录。

---

## 二、新机器上的前置条件

1. **macOS**（脚本按 macOS 路径写；Windows 需手动照做）
2. **Node.js ≥ 22**（换用系统 Node 也可以，脚本会自动探测）
3. **Git**（已装；用于查看历史）
4. 网络能连：`api.github.com`（推送用）、`webapi.sporttery.cn`（官方数据）

---

## 三、一键恢复（推荐）

把整个 `jingxi-backup-20261009` 目录拷到新机器（U 盘 / AirDrop / scp），然后：

```bash
cd <备份目录>/jingxi-backup-20261009
chmod +x restore.sh
./restore.sh                      # 默认装到 ~/WorkBuddy/jingxi
./restore.sh --dest ~/somewhere   # 也可指定目标目录
./restore.sh --no-secrets         # 跳过密钥安装（换机器但不想带 token）
```

脚本会依次：
1. 检查 node / git 环境
2. 把 `jingxi/` 复制到目标目录
3. 把 `secrets/` 装到 `$HOME`（`~/.gh_jingxi_token` 权限 600、`~/.gh-api-push-history.js`）
4. 校验 git 状态与 HEAD 提交
5. 跑全部测试（render / parlay / sim-compose / predict-providers）
6. 打印后续步骤

---

## 四、手动恢复（分步）

```bash
# 1) 代码
mkdir -p ~/WorkBuddy && cp -R jingxi ~/WorkBuddy/jingxi && cd ~/WorkBuddy/jingxi
git log --oneline -3            # 应看到 57e7d1c docs：预测数据源调研报告…

# 2) 项目记忆（放回 WorkBuddy 工作区，路径需与工作区一致才能被自动读到）
mkdir -p ~/WorkBuddy/<工作区目录>/.workbuddy/memory
cp workbuddy-memory/*.md ~/WorkBuddy/<工作区目录>/.workbuddy/memory/

# 3) 密钥（仅当需要推送）
cp secrets/gh_jingxi_token ~/.gh_jingxi_token && chmod 600 ~/.gh_jingxi_token
cp secrets/gh-api-push-history.js ~/.gh-api-push-history.js
cp secrets/id_ed25519_github_jingxi* ~/.ssh/ && chmod 600 ~/.ssh/id_ed25519_github_jingxi

# 4) 验证
node tools/render-test.js              # 期望：16/16
node tools/parlay-interact-test.js     # 期望：35/35
node tools/sim-compose-test.js         # 期望：131/131
node tools/predict-providers-test.js   # 期望：37/37
```

---

## 五、跑起来（三条命令）

```bash
# ① 起本地预览
python3 -m http.server 8080      # 然后浏览器开 http://localhost:8080

# ② 刷新官方数据快照（站点数据源）
node tools/make-snapshot.js

# ③ 拉外部预测源 / 回测（需先配 key，见下）
node tools/predict-providers.js --date 2026-10-09
node tools/backtest-providers.js --results tools/fixtures/backtest-results.json
```

---

## 六、新机器上的关键约定（不做会踩坑）

### 1. 推送通道：只能走 GitHub REST API
本机 DNS/代理环境对 `github.com` 可能不通（`git push` 会失败），但 `api.github.com` 通。推代码用：

```bash
cd <项目目录>
BASE=$(curl -s -H "Authorization: Bearer $(cat ~/.gh_jingxi_token)" \
  https://api.github.com/repos/Ayang8091/jingxi-football/git/ref/heads/main \
  | grep -o '"sha": "[0-9a-f]*"' | head -1 | cut -d'"' -f4)
GH_TOKEN=$(cat ~/.gh_jingxi_token) node ~/.gh-api-push-history.js --base "$BASE" --range <本地已推起点SHA>
```

**必须带 `--range`**：`--base` 是远程 SHA，本地不存在时会报 `Invalid revision range`。

走 API 建的提交 SHA 与本地不同（时区被规范化为 UTC），**内容一致即可**——校验比 tree：
`git rev-parse HEAD^{tree}` vs `GET /repos/Ayang8091/jingxi-football/git/commits/<sha>` 的 `tree.sha`。

### 2. 测试环境变量
```bash
export NODE_PATH=/Users/apple/.workbuddy/binaries/node/workspace/node_modules
```
（jsdom 依赖在此；新机器若无此目录，用 `npm i jsdom` 到任意位置后指向其 `node_modules`）

### 3. 改站点代码后的发布流程
1. 改代码 → 跑测试
2. 8 个 HTML 的资源版本号 `?v=YYYYMMDDXX` 统一 +1：`perl -pi -e 's/v=2026094009/v=2026094010/g' *.html`
3. commit → 按上面 API 通道推送 → 轮询验证 Pages：
   `curl -s https://ayang8091.github.io/jingxi-football/index.html | grep -o 'v=[0-9]*'`
4. WorkBuddy 镜像站重新发布（需在 WorkBuddy 里用发布功能，`updateExistingApp:true`）

### 4. 外部预测源密钥（可选）
```bash
cat > ~/.jingxi-predict-keys.json <<'EOF'
{ "apiFootball": "在 api-football.com 免费注册", "rapidApi": "RapidAPI 订阅 boggio Football Prediction", "apify": "apify.com 免费注册" }
EOF
chmod 600 ~/.jingxi-predict-keys.json
```
当前备份里**没有**这个文件（原机也没配）。未配置时 `sportterySP` 官方基线仍可离线跑。

---

## 七、注意事项

- **API token 有效期**：`~/.gh_jingxi_token` 里的 token 有到期时间，过期后需到 GitHub 设置里重新生成 classic token（勾 `repo`）替换。
- **快照有时效**：`api/snapshot.json` 会随官方赛事过期，新机器上先跑 `node tools/make-snapshot.js` 刷新。
- **`api/cache/` 未备份**（运行时缓存，会自动重建），已在 `.gitignore` 中。
- **体彩赛果接口**在本机被 WAF 拦截（返回"禁止访问"），回测赛果需人工填 `tools/fixtures/backtest-results.json`。
- 若新机器装了 WorkBuddy，可直接把工作区目录放到 `~/WorkBuddy/<同名目录>/`，项目记忆会被自动读取。

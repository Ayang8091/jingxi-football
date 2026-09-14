# 竞析 JINGXI · 中国竞彩足球数据分析中心

一个零依赖的纯静态站点：**竞彩足球赛事概率预测与价值分析**。所有概率由 Dixon-Coles 修正泊松模型从 λ 参数实时计算，并与竞彩官方 SP 去水后的市场隐含概率对比，只有正期望（EV > 1%）的方向才进入推荐池。

> ⚠️ 本项目是**数据分析与信息展示**工具，不销售彩票、不接受投注、不代购、不返奖、不提供任何投注入口。站内赛事与战绩数据当前为标注清晰的**演示样本（DEMO）**。请通过中国体育彩票实体网点合法购彩，未满 18 周岁禁止购彩。

---

## 在线访问

**国内直连（推荐 · 手机微信可直接打开）：**

```
https://jingxi-football.app.workbuddy.host/
```

**GitHub Pages 镜像：**

```
https://<你的用户名>.github.io/<仓库名>/
```

### 部署到 GitHub Pages（一键脚本）

GitHub 规定必须由账号授权才能创建仓库与推送代码，这是平台侧的硬性要求，任何工具都无法代你完成。因此首次部署需要一个 Personal Access Token，**只需这一次**：

1. 打开 https://github.com/settings/tokens/new
2. Note 填 `jingxi-deploy`，Expiration 选 `7 days`
3. 只勾选 **`repo`** 权限，点 **Generate token**
4. 复制 `ghp_` 开头的字符串，执行：

```bash
GITHUB_TOKEN=ghp_xxxxxxxx bash tools/deploy-github.sh
```

脚本会自动跑完五步：校验 token → 创建仓库 → 推送代码 → 开启 GitHub Pages → 轮询构建状态并输出访问地址。

token 仅在本次运行中使用，不会写入 `.git/config`，也不会进入任何提交记录。用完请到 https://github.com/settings/tokens 删除。

> 若 `github.com` 连接超时（国内网络常见），推送可能失败；此时直接使用上面的国内直连地址即可，站点功能完全一致。

## 页面结构

| 页面 | 文件 | 内容 |
| --- | --- | --- |
| 今日预测 | `index.html` | 赛事列表、日期切换（今日/明日/后天）、玩法与联赛筛选、置信度/EV 排序、当日核心推荐 |
| 单场剖析 | `match.html?id=<赛事ID>` | 八维拆解：基本面 · 交锋史 · 阵容伤停 · 欧亚盘口 · 进球分布 · 比分矩阵 · 结论仓位 · 风险 |
| 模型与方法 | `model.html` | 预测流水线、Dixon-Coles 公式、全部参数公开、校准曲线、资金管理、模型局限 |
| 战绩公示 | `records.html` | 命中率 / ROI / 最大回撤 / 连红连黑、按玩法与联赛拆分、注单流水、月度复盘 |
| 数据看板 | `dashboard.html` | 联赛特征基准、攻防效率 xG 榜、盘口异动榜、模型健康度 Brier / ECE 趋势 |
| 合规与数据源 | `compliance.html` | 合规边界、理性购彩、数据来源与更新机制、免责声明 |

## 技术实现

```
jingxi/
├── index.html / match.html / model.html / records.html / dashboard.html / compliance.html
├── assets/
│   ├── css/main.css          # 设计系统（CSS 变量 + 数据密集型排版）
│   └── js/
│       ├── data.js           # 数据层：只存原始输入（λ、SP、盘口、战绩）
│       ├── core.js           # 引擎：模型计算 + SVG 图表 + 页面骨架
│       ├── app.js            # 首页赛事列表
│       ├── pages-match.js    # 单场剖析页
│       ├── pages-model.js    # 模型方法论页
│       ├── pages-data.js     # 战绩公示 + 数据看板
│       ├── pages-law.js      # 合规页
│       └── boot.js           # 启动路由
└── tools/
    ├── calibrate-demo-data.js  # 演示数据校准脚本
    ├── data.backup.js          # 校准前的数据备份
    ├── deploy-github.sh        # GitHub Pages 一键部署
    └── render-test.js          # jsdom 渲染冒烟测试
```

**零外部依赖**：不使用任何前端框架、CDN 或第三方资源，全部 CSS 与 SVG 自绘。离线可用、加载快、无脚本注入风险，总体积约 284KB。

### 核心设计：数据与视图解耦

`data.js` 只保存**原始输入**（λ、竞彩 SP、盘口、历史战绩）。公平赔率、去水边际、价值 EV、凯利分数、建议仓位等**派生指标全部由 `core.js` 在渲染时实时计算**——从根本上杜绝"表里的数字和公式对不上"。

接入真实数据源时，只需把 `data.js` 的静态对象替换为异步 fetch 逻辑，六个页面零改动。

### 模型自洽性验证

页面上的概率不是写死的。同一场比赛中：

- 胜 + 平 + 负 概率之和 ≡ 1
- 总进球分布概率之和 ≡ 1
- 比分矩阵所有格子概率之和 ≡ 1

```
$ node -e 'global.window=global; require("./assets/js/data.js"); require("./assets/js/core.js");
  const D=global.JX_DATA; let bad=0;
  for(const m of D.matches){const r=global.JX.model(m);
    if(Math.abs(r.w+r.d+r.l-1)>1e-9) bad++;}
  console.log("概率异常:", bad);'
概率异常: 0
```

## 本地运行

站点是纯静态文件，任意静态服务器均可：

```bash
# 方式一：Python
python3 -m http.server 8787

# 方式二：Node
npx serve .

# 然后浏览器打开 http://127.0.0.1:8787/index.html
```

直接双击 `index.html` 也能运行（无任何跨域请求）。

## 开发工具

```bash
# 渲染冒烟测试（需先安装 jsdom）
npm install jsdom
node tools/render-test.js

# 演示数据校准：按各玩法真实返奖率反解市场隐含概率，保证 SP 与模型概率自洽
node tools/calibrate-demo-data.js
```

## 数据来源说明

| 数据源 | 提供内容 | 更新频率 |
| --- | --- | --- |
| 中国体育彩票官方 | 竞彩赛程、SP 赔率、开奖结果 | 每日 |
| 公开赛事数据（示例接入） | 球队基础数据、xG、交锋记录 | 每日 |
| 亚洲盘口数据（示例接入） | 让球盘、大小球、水位变化 | 每 2 小时 |

当前版本所有数值为演示样本，用于验证产品结构与算法逻辑。SP 数据以中国体育彩票官方公布为准。

## 免责声明

1. 本项目所有内容均基于公开数据的技术性分析与研究，仅供体育爱好者参考交流，**不构成任何投注建议、投资建议或收益承诺**。
2. 足球比赛受众多不可量化因素影响，模型输出为概率分布而非确定结论。历史表现不代表未来结果。
3. 使用者据此作出的任何决策及其后果由使用者自行承担。
4. 本项目与任何博彩公司、彩票代销平台均无隶属、代理或合作关系。

## 许可

本项目仅供学习与研究使用。

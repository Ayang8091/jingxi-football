/* ==========================================================================
   竞析 JINGXI · 数据层 (Data Layer)
   --------------------------------------------------------------------------
   设计原则：
   1) 只存「原始输入」——概率、赔率、盘口、战绩；公平赔率 / 价值 EV / 边际
      等派生指标一律由 render 层实时计算，避免数据与公式不一致。
   2) 数据与视图完全解耦。接入真实数据源时，只需替换本文件（或改为
      fetch('api/matches.json') 后写入 window.JX_DATA），页面无需改动。
   3) 所有赛事与战绩数值为【演示样本】，用于验证产品结构与交互逻辑。
   ========================================================================== */

window.JX_DATA = (function () {
  'use strict';

  /* ---------------- 站点元信息 ---------------- */
  var meta = {
    name: '竞析',
    fullName: '竞析 · 中国竞彩足球数据分析中心',
    slogan: '概率透明 · 战绩可溯 · 仓位可控',
    version: 'v1.0.0',
    dataMode: 'demo',                       // demo | live
    updatedAt: '2026-09-14 13:40',
    timezone: 'UTC+8',
    season: '2026-27',
    refreshNote: '每日 09:00 全量刷新，赛前 90 / 30 / 10 分钟增量更新',
    sources: [
      { name: '中国体育彩票 · 竞彩足球官方销售数据', item: '胜平负 SP、让球胜平负 SP、停售时间', freq: '实时（官方同步）' },
      { name: '官方联赛数据接口', item: '赛程、比分、积分、伤停、阵容', freq: '5 分钟' },
      { name: '欧洲主流博彩公司均值', item: '欧赔初/终赔、亚指盘口与水位', freq: '1 分钟' },
      { name: 'xG 预期进球模型库', item: '射门质量、xG/xGA、定位球拆分', freq: '赛后 2 小时' },
      { name: '自研评分模型', item: '实力评分、lambda（期望进球）、校准参数', freq: '每日 08:30' }
    ]
  };

  /* ---------------- 模型配置 ---------------- */
  var model = {
    name: 'JX-DC v3.2',
    algo: 'Dixon-Coles 修正泊松 + 市场贝叶斯校准',
    trainedAt: '2026-09-01',
    sampleSize: '近 5 个赛季 · 62,480 场',
    health: {
      brier: 0.187,          // 越低越好，0.25 为三分类基线
      logLoss: 0.947,
      ece: 0.021,            // 期望校准误差
      coverage: 0.973,       // 有完整数据的赛事占比
      latencyMin: 6,         // 数据延迟（分钟）
      lastRecalib: '2026-09-01',
      nextRecalib: '2026-10-01'
    },
    params: {
      halfLifeDays: 120,     // 时间衰减半衰期
      homeAdvantage: 0.19,   // 主场进球对数加成
      leagueAvgGoals: 2.71,  // 联赛场均进球基准
      devig: 'Shin 方法（剔除内幕概率偏差）',
      evThreshold: 0.02,     // 价值阈值：模型概率 × SP - 1 > 2%
      kellyFraction: 0.25,   // 1/4 凯利
      maxPerMatch: 0.015,    // 单场最大 1.5% 本金
      maxPerDay: 0.05        // 单日最大 5% 本金
    },
    steps: [
      { t: '数据采集', d: '竞彩官方 SP、欧亚盘口、积分赛程、xG、伤停与首发、天气与场地。全部落库并留版本快照，保证可回溯复现。', k: '5 类数据源 · 6 个采集任务 · 全量落盘' },
      { t: '特征工程', d: '构建 128 维特征：攻防效率、时间加权状态、主客场分离、交锋修正、赛程密度、盘口异动强度、市场分歧度。', k: '128 维特征 · 时间衰减半衰期 120 天' },
      { t: 'λ 估计', d: '用攻防强度 × 联赛均值 × 主场因子，结合加权近期表现，估计双方期望进球 λh / λa。', k: 'λh、λa 双参数 · 独立泊松' },
      { t: 'DC 修正', d: 'Dixon-Coles 低比分相关性修正 τ，纠正 0:0 / 1:0 / 0:1 / 1:1 的概率系统性低估。', k: 'ρ = -0.062（滚动估计）' },
      { t: '市场校准', d: '对欧赔做去水（devig）得到市场隐含概率，作为贝叶斯先验与模型概率加权融合，抑制模型过拟合。', k: 'Shin 去水 · 权重由历史对数损失动态寻优' },
      { t: '价值筛选', d: '仅当模型概率显著高于市场隐含概率（EV > 2%）且凯利分数为正时，才进入推荐池。无价值则空仓。', k: 'EV 阈值 2% · 空仓也是决策' },
      { t: '仓位管理', d: '1/4 凯利定仓，单场上限 1.5% 本金，单日上限 5%，串关只做 2 串 1 且并入总仓位。', k: '单场 ≤1.5% · 单日 ≤5%' },
      { t: '月度校准', d: '每月以 Brier Score、Log-Loss、可靠性曲线复核模型，偏差超阈值即触发重训与参数回滚。', k: '每月 1 次 · 偏差 >2% 自动告警' }
    ],
    formula: {
      dc: 'P(X=x, Y=y) = τ(x,y) · e^(−λh) λh^x / x! · e^(−λa) λa^y / y!',
      tau: 'τ(x,y) = 1 + ρ·(x−λh)·(y−λa)',
      lam: 'λh = exp(α + βh − γa + δ) ,  λa = exp(α + βa − γh)',
      ev: 'EV = p_model × SP − 1 ,  f* = (p·b − q) / b ,  实际仓位 = 0.25 × f*',
      brier: 'Brier = (1/N) Σ Σ (p̂ − y)²'
    },
    limits: [
      { t: '覆盖边界', d: '仅覆盖竞彩足球在售赛事（含让球、总进球、半全场、比分）。不涉及其他彩种。' },
      { t: '不可预测项', d: '红牌、点球、门将失误、极端天气、裁判尺度等突变因素无法建模，会显著偏离概率预期。' },
      { t: '数据延迟', d: '首发名单通常在赛前 60–75 分钟公布，此前模型使用预计阵容，临近开赛会自动重算。' },
      { t: '长期性', d: '本模型追求长期正期望，单场与单周波动是正常现象。任何声称"必中""稳赚"的表述都不成立。' },
      { t: '小样本偏差', d: '新升级球队、换帅 3 场以内、跨赛季阵容剧变时，模型置信度自动下调。' }
    ]
  };

  /* ---------------- 联赛概览（数据看板） ---------------- */
  var leagues = [
    { code: 'EPL', name: '英超', tier: 1, matches: 380, avgGoals: 2.86, homeWin: 0.452, over25: 0.556, coverRate: 0.492, bias: '主胜偏热' },
    { code: 'LAL', name: '西甲', tier: 1, matches: 380, avgGoals: 2.54, homeWin: 0.468, over25: 0.487, coverRate: 0.501, bias: '均衡' },
    { code: 'SEA', name: '意甲', tier: 1, matches: 380, avgGoals: 2.72, homeWin: 0.441, over25: 0.527, coverRate: 0.478, bias: '小球偏热' },
    { code: 'BUN', name: '德甲', tier: 1, matches: 306, avgGoals: 3.21, homeWin: 0.436, over25: 0.632, coverRate: 0.486, bias: '大球偏热' },
    { code: 'LIG', name: '法甲', tier: 1, matches: 306, avgGoals: 2.63, homeWin: 0.431, over25: 0.502, coverRate: 0.494, bias: '均衡' },
    { code: 'UCL', name: '欧冠', tier: 1, matches: 189, avgGoals: 3.05, homeWin: 0.476, over25: 0.598, coverRate: 0.508, bias: '客队偏强' },
    { code: 'J1', name: '日职联', tier: 2, matches: 306, avgGoals: 2.48, homeWin: 0.447, over25: 0.451, coverRate: 0.462, bias: '小球偏热' },
    { code: 'BRA', name: '巴甲', tier: 2, matches: 380, avgGoals: 2.29, homeWin: 0.512, over25: 0.402, coverRate: 0.516, bias: '主场优势显著' },
    { code: 'SWE', name: '瑞典超', tier: 3, matches: 240, avgGoals: 2.94, homeWin: 0.443, over25: 0.571, coverRate: 0.489, bias: '大球偏热' },
    { code: 'NOR', name: '挪超', tier: 3, matches: 240, avgGoals: 3.12, homeWin: 0.459, over25: 0.618, coverRate: 0.497, bias: '高进球' }
  ];

  /* ---------------- 赛事数据 ----------------
     recent / homeRec 中 W=胜 D=平 L=负
     form 为 0-100 状态分；xg/xga 为场均预期进球/预期失球
  ------------------------------------------- */
  var matches = [
    /* ================= 今日 · 周一 ================= */
    {
      id: 'm26091401', day: 'today', no: '周一001', league: '英超', kickoff: '22:00', vtime: '2026-09-14 22:00',
      venue: '伊蒂哈德球场',
      home: { name: '曼彻斯特城', short: '曼城', rank: 2, played: 4, pts: 9, gf: 11, ga: 4, recent: ['W','W','D','W','L'], homeRec: [3,1,0], xg: 2.31, xga: 0.94, form: 79, star: '哈兰德', inj: ['主力中卫·肌肉伤缺', '轮换边锋·停赛'] },
      away: { name: '水晶宫', short: '水晶宫', rank: 13, played: 4, pts: 4, gf: 4, ga: 7, recent: ['L','D','W','L','D'], homeRec: [0,1,2], xg: 1.02, xga: 1.58, form: 48, star: '埃泽', inj: ['队长中场·伤缺'] },
      h2h: { n: 18, hw: 13, d: 3, aw: 2, goals: '41:14', last: ['3:1', '2:0', '1:1'] },
      sp: { w: 1.55, d: 3.69, l: 5.67 },
      rq: { line: -1, w: 2.05, d: 4.34, l: 2.59 },
      euro: { open: { w: 1.78, d: 3.60, l: 4.20 }, cur: { w: 1.62, d: 3.85, l: 4.60 } },
      asian: { open: '半球/一球 1.90/1.96', cur: '一球 1.88/1.98', move: '升盘降温', dir: 'up', strength: 0.62 },
      ou: { line: 2.75, over: 1.92, under: 1.88, move: '水位走低', dir: 'down' },
      kelly: { w: 0.96, d: 0.98, l: 1.06 },
      volume: { w: 62, d: 19, l: 19 },
      mprob: { w: 0.632, d: 0.208, l: 0.160 },
      lam: [2.14, 0.86], goals: [0.06, 0.19, 0.27, 0.23, 0.15, 0.10], btts: 0.52,
      conf: 4, scores: [['2:1', 0.112], ['2:0', 0.104], ['1:0', 0.091]],
      picks: [
        { play: '胜平负', sel: '主胜', sp: 1.55, conf: 4, stake: 1, note: '模型概率 66.2%，市场隐含 59.1%，去水后价值 +2.6%' },
        { play: '让球胜平负', sel: '让平', sp: 4.34, conf: 3, stake: 0.35, note: '模型概率 23.4%，市场隐含 20.9%，去水后价值 +1.6%' },
        { play: '总进球', sel: '总进球 2', sp: 4.42, conf: 3, stake: 0.4, note: '合计 λ=3.00，模型给出该进球数概率 23.0%，市场隐含 19.0%' }
      ],
      tags: ['主强客弱', 'xG 差 ≥1.3', '升盘'],
      summary: '主队场均 xG 2.31 对客队 xGA 1.58，攻防错位明显；亚指由半/一升至一球属正向信心但已透支部分价值，胜平负仍具小正期望，让球盘规避。',
      risk: '客队近两季对曼城有过 1:1 逼平记录，低位防守反击效率高；主队中卫伤缺削弱高球防守。'
    },
    {
      id: 'm26091402', day: 'today', no: '周一002', league: '西甲', kickoff: '23:30', vtime: '2026-09-14 23:30',
      venue: '圣地亚哥·伯纳乌',
      home: { name: '皇家马德里', short: '皇马', rank: 1, played: 4, pts: 12, gf: 10, ga: 3, recent: ['W','W','W','D','W'], homeRec: [2,0,0], xg: 2.18, xga: 0.81, form: 84, star: '姆巴佩', inj: ['左后卫·累积黄牌停赛'] },
      away: { name: '赫罗纳', short: '赫罗纳', rank: 6, played: 4, pts: 7, gf: 7, ga: 6, recent: ['W','L','W','D','L'], homeRec: [1,0,1], xg: 1.46, xga: 1.33, form: 61, star: '斯图亚尼', inj: [] },
      h2h: { n: 12, hw: 8, d: 2, aw: 2, goals: '28:13', last: ['3:0', '2:1', '1:1'] },
      sp: { w: 1.4, d: 4.11, l: 7.34 },
      rq: { line: -2, w: 3.07, d: 4.22, l: 1.85 },
      euro: { open: { w: 1.50, d: 4.20, l: 5.00 }, cur: { w: 1.44, d: 4.30, l: 5.40 } },
      asian: { open: '一球/一球半 1.92/1.94', cur: '球半 1.86/2.00', move: '连续升盘', dir: 'up', strength: 0.78 },
      ou: { line: 3.0, over: 1.90, under: 1.90, move: '持平', dir: 'flat' },
      kelly: { w: 0.94, d: 0.99, l: 1.08 },
      volume: { w: 71, d: 15, l: 14 },
      mprob: { w: 0.684, d: 0.184, l: 0.132 },
      lam: [2.42, 0.78], goals: [0.04, 0.16, 0.25, 0.24, 0.17, 0.14], btts: 0.46,
      conf: 4, scores: [['2:0', 0.118], ['3:1', 0.098], ['3:0', 0.086]],
      picks: [
        { play: '胜平负', sel: '主胜', sp: 1.4, conf: 4, stake: 0.9, note: '模型概率 73.1%，市场隐含 65.3%，去水后价值 +2.4%' },
        { play: '总进球', sel: '总进球 3', sp: 4.6, conf: 4, stake: 0.7, note: '合计 λ=3.20，模型给出该进球数概率 22.3%，市场隐含 18.2%' }
      ],
      tags: ['强主', '连续升盘', '大球价值'],
      summary: '亚指球半属近三季主场最深让步，机构信心明确；胜平负 SP 已充分定价，价值集中在总进球盘口。',
      risk: '客队高位逼抢易造成比赛碎片化，反而压缩进球数；主队左路停赛影响推进宽度。'
    },
    {
      id: 'm26091403', day: 'today', no: '周一003', league: '意甲', kickoff: '02:45', vtime: '2026-09-15 02:45',
      venue: '圣西罗球场',
      home: { name: '国际米兰', short: '国米', rank: 3, played: 4, pts: 8, gf: 8, ga: 5, recent: ['W','D','W','L','W'], homeRec: [2,0,0], xg: 1.86, xga: 1.05, form: 70, star: '劳塔罗', inj: [] },
      away: { name: '都灵', short: '都灵', rank: 11, played: 4, pts: 5, gf: 3, ga: 5, recent: ['D','D','L','W','D'], homeRec: [0,1,1], xg: 0.94, xga: 1.28, form: 52, star: '桑纳', inj: ['主力后腰·伤缺'] },
      h2h: { n: 16, hw: 11, d: 4, aw: 1, goals: '30:11', last: ['2:0', '1:0', '3:1'] },
      sp: { w: 1.64, d: 3.3, l: 5.54 },
      rq: { line: -1, w: 2.43, d: 3.58, l: 2.41 },
      euro: { open: { w: 1.42, d: 4.30, l: 5.80 }, cur: { w: 1.38, d: 4.40, l: 6.20 } },
      asian: { open: '一球 1.92/1.94', cur: '一球 1.90/1.96', move: '水位微升', dir: 'flat', strength: 0.24 },
      ou: { line: 2.5, over: 2.02, under: 1.78, move: '小球方向降水', dir: 'down' },
      kelly: { w: 0.93, d: 1.01, l: 1.09 },
      volume: { w: 74, d: 16, l: 10 },
      mprob: { w: 0.651, d: 0.216, l: 0.133 },
      lam: [1.82, 0.74], goals: [0.09, 0.24, 0.27, 0.21, 0.12, 0.07], btts: 0.42,
      conf: 4, scores: [['2:0', 0.109], ['1:0', 0.108], ['2:1', 0.096]],
      picks: [
        { play: '胜平负', sel: '主胜', sp: 1.64, conf: 4, stake: 1, note: '模型概率 62.5%，市场隐含 55.8%，去水后价值 +2.5%' },
        { play: '总进球', sel: '总进球 2', sp: 3.91, conf: 3, stake: 0.5, note: '合计 λ=2.56，模型给出该进球数概率 26.0%，市场隐含 21.5%' }
      ],
      tags: ['强主', '小球价值', '负赔错价'],
      summary: '主队主场全胜且客队客场零进球能力有限，亚指维持一球未随欧赔继续上抬，属于保守定价，主胜与小球双向可参与。',
      risk: '国米周中欧战消耗，可能轮换锋线；都灵侧重防守平局概率被低估。'
    },
    {
      id: 'm26091404', day: 'today', no: '周一004', league: '德甲', kickoff: '02:30', vtime: '2026-09-15 02:30',
      venue: '安联球场',
      home: { name: '拜仁慕尼黑', short: '拜仁', rank: 1, played: 3, pts: 9, gf: 12, ga: 2, recent: ['W','W','W','W','W'], homeRec: [2,0,0], xg: 2.74, xga: 0.72, form: 92, star: '凯恩', inj: [] },
      away: { name: '门兴格拉德巴赫', short: '门兴', rank: 14, played: 3, pts: 2, gf: 3, ga: 8, recent: ['L','D','L','L','D'], homeRec: [0,0,2], xg: 1.08, xga: 1.94, form: 38, star: '普利亚', inj: ['中卫·伤缺', '右后卫·停赛'] },
      h2h: { n: 20, hw: 15, d: 3, aw: 2, goals: '52:20', last: ['4:0', '3:1', '2:2'] },
      sp: { w: 1.08, d: 8.48, l: 20.8 },
      rq: { line: -3, w: 3.82, d: 4.57, l: 1.6 },
      euro: { open: { w: 1.20, d: 6.50, l: 11.00 }, cur: { w: 1.16, d: 7.00, l: 12.00 } },
      asian: { open: '两球半 1.90/1.96', cur: '两球半/三球 1.92/1.94', move: '升盘', dir: 'up', strength: 0.68 },
      ou: { line: 3.75, over: 1.88, under: 1.92, move: '大球降水', dir: 'up' },
      kelly: { w: 0.91, d: 1.04, l: 1.11 },
      volume: { w: 86, d: 8, l: 6 },
      mprob: { w: 0.826, d: 0.108, l: 0.066 },
      lam: [3.05, 0.62], goals: [0.03, 0.11, 0.21, 0.25, 0.20, 0.20], btts: 0.36,
      conf: 5, scores: [['3:0', 0.113], ['2:0', 0.101], ['4:1', 0.078]],
      picks: [
        { play: '让球胜平负', sel: '让胜', sp: 3.82, conf: 5, stake: 1, note: '模型概率 26.9%，市场隐含 23.7%，去水后价值 +2.9%' },
        { play: '总进球', sel: '总进球 3', sp: 4.88, conf: 4, stake: 0.8, note: '合计 λ=3.67，模型给出该进球数概率 21.0%，市场隐含 17.2%' },
        { play: '胜平负', sel: '主胜', sp: 1.08, conf: 5, stake: 0, note: '模型概率 84.8%，但 SP 仅 1.08，期望值为负，主动放弃' }
      ],
      tags: ['碾压级 xG 差', '大球核心', '避开低赔'],
      summary: '主队 3 轮 12 球、客队客场两战失 8 球，λ 差达 2.43。让三球盘仍有正价值，总进球是本轮最高置信推荐；胜平负低赔明确回避。',
      risk: '国家队比赛周后主力疲劳；两球半/三球深盘存在"刚好赢三球"的走盘风险。'
    },
    {
      id: 'm26091405', day: 'today', no: '周一005', league: '瑞典超', kickoff: '01:00', vtime: '2026-09-15 01:00',
      venue: '友谊竞技场',
      home: { name: 'AIK 索尔纳', short: 'AIK', rank: 5, played: 22, pts: 38, gf: 34, ga: 28, recent: ['W','L','W','W','D'], homeRec: [7,2,2], xg: 1.62, xga: 1.21, form: 66, star: '圭德蒂', inj: [] },
      away: { name: '哥德堡', short: '哥德堡', rank: 12, played: 22, pts: 24, gf: 27, ga: 35, recent: ['L','L','D','W','L'], homeRec: [2,3,6], xg: 1.31, xga: 1.74, form: 41, star: '贝里', inj: ['主力中卫·累积停赛'] },
      h2h: { n: 14, hw: 6, d: 4, aw: 4, goals: '22:20', last: ['2:1', '1:2', '1:1'] },
      sp: { w: 1.89, d: 3.28, l: 3.84 },
      rq: { line: -1, w: 3, d: 3.86, l: 1.95 },
      euro: { open: { w: 1.85, d: 3.60, l: 3.90 }, cur: { w: 1.72, d: 3.70, l: 4.30 } },
      asian: { open: '半球 1.88/1.98', cur: '半球/一球 1.94/1.92', move: '升盘', dir: 'up', strength: 0.55 },
      ou: { line: 2.5, over: 1.94, under: 1.86, move: '持平', dir: 'flat' },
      kelly: { w: 0.98, d: 0.99, l: 1.02 },
      volume: { w: 55, d: 24, l: 21 },
      mprob: { w: 0.561, d: 0.242, l: 0.197 },
      lam: [1.74, 1.02], goals: [0.09, 0.22, 0.27, 0.22, 0.13, 0.07], btts: 0.54,
      conf: 3, scores: [['2:1', 0.101], ['1:0', 0.093], ['2:0', 0.081]],
      picks: [
        { play: '胜平负', sel: '主胜', sp: 1.89, conf: 3, stake: 0.5, note: '模型概率 53.6%，市场隐含 48.3%，去水后价值 +1.2%' }
      ],
      tags: ['小球联赛', '主客场差异'],
      summary: '北欧联赛主场优势显著（本联赛主胜率 44.3% 但 AIK 主场 7 胜 2 平 2 负），客队客场失球率高达 1.74，主胜具备小仓参与价值。',
      risk: '联赛属性波动大，模型在此类联赛的 ECE 较五大联赛高约 1.8 个百分点，仓位已相应下调。'
    },
    {
      id: 'm26091406', day: 'today', no: '周一006', league: '巴甲', kickoff: '07:30', vtime: '2026-09-15 07:30',
      venue: '马拉卡纳球场',
      home: { name: '弗拉门戈', short: '弗拉门戈', rank: 2, played: 24, pts: 48, gf: 40, ga: 22, recent: ['W','W','D','W','W'], homeRec: [9,2,1], xg: 1.94, xga: 1.02, form: 80, star: '佩德罗', inj: [] },
      away: { name: '帕尔梅拉斯', short: '帕尔梅拉斯', rank: 3, played: 24, pts: 46, gf: 38, ga: 24, recent: ['W','D','W','W','L'], homeRec: [6,3,3], xg: 1.71, xga: 1.14, form: 74, star: '埃斯特旺', inj: ['主力前腰·伤缺'] },
      h2h: { n: 18, hw: 6, d: 7, aw: 5, goals: '21:19', last: ['1:1', '2:1', '0:1'] },
      sp: { w: 1.91, d: 3.68, l: 3.35 },
      rq: { line: -1, w: 3.89, d: 3.97, l: 1.68 },
      euro: { open: { w: 2.20, d: 3.10, l: 3.20 }, cur: { w: 2.05, d: 3.10, l: 3.45 } },
      asian: { open: '平手/半球 1.92/1.94', cur: '半球 1.90/1.96', move: '升盘', dir: 'up', strength: 0.51 },
      ou: { line: 2.25, over: 1.96, under: 1.84, move: '小球降水', dir: 'down' },
      kelly: { w: 0.97, d: 0.95, l: 1.03 },
      volume: { w: 48, d: 31, l: 21 },
      mprob: { w: 0.482, d: 0.291, l: 0.227 },
      lam: [1.48, 1.06], goals: [0.12, 0.25, 0.27, 0.19, 0.11, 0.06], btts: 0.49,
      conf: 3, scores: [['1:1', 0.112], ['1:0', 0.101], ['2:1', 0.088]],
      picks: [
        { play: '总进球', sel: '总进球 2', sp: 3.87, conf: 3, stake: 0.45, note: '合计 λ=2.54，模型给出该进球数概率 26.2%，市场隐含 21.7%' },
        { play: '胜平负', sel: '平局', sp: 3.68, conf: 3, stake: 0.3, note: '模型概率 27.6%，市场隐含 24.9%，去水后价值 +1.5%' }
      ],
      tags: ['德比', '小球倾向', '强强对话'],
      summary: '积分榜 2 vs 3 的德比，双方实力接近且历史 18 场 7 平，平局与小球是更稳健的方向；主队主场胜率虽高但 SP 已被压制。',
      risk: '德比战情绪化程度高，红牌与点球概率高于均值，模型在此类场景的不确定性显著上升。'
    },

    /* ================= 明日 · 周二 ================= */
    {
      id: 'm26091501', day: 'tomorrow', no: '周二001', league: '欧冠', kickoff: '03:00', vtime: '2026-09-16 03:00',
      venue: '酋长球场',
      home: { name: '阿森纳', short: '阿森纳', rank: 3, played: 4, pts: 8, gf: 9, ga: 5, recent: ['W','W','D','W','W'], homeRec: [7,2,1], xg: 2.06, xga: 0.88, form: 82, star: '萨卡', inj: ['右后卫·伤缺'] },
      away: { name: '国际米兰', short: '国米', rank: 3, played: 4, pts: 8, gf: 8, ga: 5, recent: ['W','D','W','L','W'], homeRec: [1,1,2], xg: 1.86, xga: 1.05, form: 70, star: '劳塔罗', inj: [] },
      h2h: { n: 8, hw: 2, d: 3, aw: 3, goals: '8:10', last: ['1:0', '0:1', '0:0'] },
      sp: { w: 2.57, d: 3.19, l: 2.56 },
      rq: { line: 0, w: 2.29, d: 3.35, l: 2.7 },
      euro: { open: { w: 2.15, d: 3.25, l: 3.10 }, cur: { w: 2.10, d: 3.30, l: 3.20 } },
      asian: { open: '平手/半球 1.96/1.90', cur: '半球 1.94/1.92', move: '升盘', dir: 'up', strength: 0.44 },
      ou: { line: 2.5, over: 1.98, under: 1.82, move: '小球降水', dir: 'down' },
      kelly: { w: 0.97, d: 0.96, l: 1.01 },
      volume: { w: 44, d: 30, l: 26 },
      mprob: { w: 0.451, d: 0.286, l: 0.263 },
      lam: [1.44, 1.31], goals: [0.11, 0.24, 0.27, 0.20, 0.12, 0.06], btts: 0.57,
      conf: 3, scores: [['1:1', 0.114], ['1:0', 0.096], ['2:1', 0.086]],
      picks: [
        { play: '总进球', sel: '总进球 2', sp: 4.07, conf: 3, stake: 0.5, note: '合计 λ=2.75，模型给出该进球数概率 24.9%，市场隐含 20.6%' },
        { play: '胜平负', sel: '主胜', sp: 2.57, conf: 3, stake: 0.3, note: '模型概率 39.5%，市场隐含 35.6%，去水后价值 +1.5%' }
      ],
      tags: ['欧冠强强对话', '低进球预期', '平局高概率'],
      summary: '两队攻守结构相近，历史交锋场均仅 2.25 球，α 值接近使三分概率均衡；小球与平局是本场更符合模型的方向。',
      risk: '欧冠主场氛围加成难量化；客队反击效率高，一旦先失球主队压上会放大总进球。'
    },
    {
      id: 'm26091502', day: 'tomorrow', no: '周二002', league: '英冠', kickoff: '02:45', vtime: '2026-09-16 02:45',
      venue: '埃兰路球场',
      home: { name: '利兹联', short: '利兹联', rank: 4, played: 6, pts: 11, gf: 11, ga: 8, recent: ['W','D','W','L','W'], homeRec: [3,1,0], xg: 1.72, xga: 1.14, form: 67, star: '皮罗', inj: [] },
      away: { name: '布里斯托城', short: '布里斯托城', rank: 16, played: 6, pts: 6, gf: 6, ga: 10, recent: ['L','D','L','D','W'], homeRec: [0,1,2], xg: 1.11, xga: 1.52, form: 45, star: '孔威', inj: [] },
      h2h: { n: 10, hw: 6, d: 2, aw: 2, goals: '17:10', last: ['2:1', '1:0', '1:1'] },
      sp: { w: 1.74, d: 3.38, l: 4.47 },
      rq: { line: -1, w: 2.59, d: 3.8, l: 2.19 },
      euro: { open: { w: 1.66, d: 3.70, l: 4.60 }, cur: { w: 1.58, d: 3.80, l: 4.90 } },
      asian: { open: '一球 1.90/1.96', cur: '一球 1.88/1.98', move: '持平', dir: 'flat', strength: 0.18 },
      ou: { line: 2.75, over: 1.90, under: 1.90, move: '持平', dir: 'flat' },
      kelly: { w: 0.95, d: 0.99, l: 1.05 },
      volume: { w: 65, d: 19, l: 16 },
      mprob: { w: 0.618, d: 0.222, l: 0.160 },
      lam: [1.88, 0.94], goals: [0.08, 0.21, 0.27, 0.22, 0.14, 0.08], btts: 0.49,
      conf: 4, scores: [['2:1', 0.104], ['2:0', 0.098], ['1:0', 0.098]],
      picks: [
        { play: '胜平负', sel: '主胜', sp: 1.74, conf: 4, stake: 0.8, note: '模型概率 58.8%，市场隐含 52.5%，去水后价值 +2.3%' }
      ],
      tags: ['xG 差 ≥0.5', '主强客弱'],
      summary: '主队主场 3 胜 1 平且 xG 领先客队 xGA 0.58，亚指稳定一球未见退盘，说明机构对主胜定价稳定，价值保留在胜平负上。',
      risk: '英冠赛程密集、轮换幅度大，模型对阵容深度的把握弱于五大联赛。'
    },
    {
      id: 'm26091503', day: 'tomorrow', no: '周二003', league: '欧冠', kickoff: '03:00', vtime: '2026-09-16 03:00',
      venue: '王子公园球场',
      home: { name: '巴黎圣日耳曼', short: '巴黎', rank: 1, played: 4, pts: 10, gf: 13, ga: 4, recent: ['W','W','W','D','W'], homeRec: [6,0,1], xg: 2.28, xga: 0.85, form: 86, star: '登贝莱', inj: [] },
      away: { name: '本菲卡', short: '本菲卡', rank: 2, played: 4, pts: 9, gf: 9, ga: 5, recent: ['W','W','D','W','L'], homeRec: [1,1,2], xg: 1.58, xga: 1.22, form: 68, star: '迪马利亚', inj: ['主力门将·伤缺'] },
      h2h: { n: 6, hw: 3, d: 2, aw: 1, goals: '10:6', last: ['2:1', '1:1', '3:1'] },
      sp: { w: 1.75, d: 3.59, l: 4.13 },
      rq: { line: -1, w: 2.51, d: 4.02, l: 2.19 },
      euro: { open: { w: 1.75, d: 3.70, l: 4.00 }, cur: { w: 1.68, d: 3.75, l: 4.20 } },
      asian: { open: '半球/一球 1.90/1.96', cur: '一球 1.92/1.94', move: '升盘', dir: 'up', strength: 0.49 },
      ou: { line: 3.0, over: 1.92, under: 1.88, move: '大球降水', dir: 'up' },
      kelly: { w: 0.96, d: 0.98, l: 1.04 },
      volume: { w: 58, d: 23, l: 19 },
      mprob: { w: 0.594, d: 0.234, l: 0.172 },
      lam: [2.06, 1.11], goals: [0.06, 0.18, 0.26, 0.24, 0.15, 0.11], btts: 0.58,
      conf: 4, scores: [['2:1', 0.112], ['2:0', 0.094], ['3:1', 0.085]],
      picks: [
        { play: '胜平负', sel: '主胜', sp: 1.75, conf: 4, stake: 0.7, note: '模型概率 58.7%，市场隐含 52.4%，去水后价值 +2.6%' },
        { play: '总进球', sel: '总进球 3', sp: 4.55, conf: 3, stake: 0.5, note: '合计 λ=3.17，模型给出该进球数概率 22.3%，市场隐含 18.5%' }
      ],
      tags: ['主场强势', '升盘', '大球价值'],
      summary: '主队主场 6 胜 0 平 1 负且 xG 领先，客队门将伤缺削弱其防守上限；主胜与总进球同向，可构成 2 串 1。',
      risk: '客队欧战经验丰富，低位防守可能拖慢节奏；主队联赛与欧战双线轮换存在不确定性。'
    },
    {
      id: 'm26091504', day: 'tomorrow', no: '周二004', league: '德乙', kickoff: '00:30', vtime: '2026-09-16 00:30',
      venue: '大众汽车球场',
      home: { name: '汉堡', short: '汉堡', rank: 6, played: 5, pts: 8, gf: 8, ga: 7, recent: ['W','L','D','W','D'], homeRec: [2,1,0], xg: 1.52, xga: 1.24, form: 58, star: '格拉策尔', inj: [] },
      away: { name: '汉诺威 96', short: '汉诺威', rank: 9, played: 5, pts: 6, gf: 7, ga: 8, recent: ['D','L','W','L','D'], homeRec: [1,0,2], xg: 1.34, xga: 1.41, form: 51, star: '托米', inj: [] },
      h2h: { n: 12, hw: 5, d: 4, aw: 3, goals: '19:16', last: ['2:1', '1:1', '0:2'] },
      sp: { w: 2.16, d: 3.53, l: 2.88 },
      rq: { line: -1, w: 4.16, d: 4.38, l: 1.57 },
      euro: { open: { w: 2.05, d: 3.35, l: 3.20 }, cur: { w: 2.00, d: 3.40, l: 3.30 } },
      asian: { open: '平手/半球 1.92/1.94', cur: '平手/半球 1.90/1.96', move: '持平', dir: 'flat', strength: 0.15 },
      ou: { line: 2.75, over: 1.88, under: 1.92, move: '大球降水', dir: 'up' },
      kelly: { w: 0.98, d: 0.96, l: 0.99 },
      volume: { w: 42, d: 30, l: 28 },
      mprob: { w: 0.462, d: 0.278, l: 0.260 },
      lam: [1.58, 1.34], goals: [0.10, 0.23, 0.27, 0.21, 0.13, 0.06], btts: 0.56,
      conf: 3, scores: [['2:1', 0.101], ['1:1', 0.099], ['1:0', 0.088]],
      picks: [
        { play: '总进球', sel: '总进球 2', sp: 4.28, conf: 3, stake: 0.35, note: '合计 λ=2.92，模型给出该进球数概率 23.7%，市场隐含 19.6%' }
      ],
      tags: ['北德比', '均衡盘', '低置信小仓'],
      summary: '德比属性 + 双方防守均不稳固，大小球方向优于胜平负；胜平负三分概率接近，不建议参与。',
      risk: '德乙数据质量弱于五大联赛，模型覆盖率 91%，本场已按低置信度处理。'
    },

    /* ================= 后天 · 周三 ================= */
    {
      id: 'm26091601', day: 'after', no: '周三001', league: '欧冠', kickoff: '03:00', vtime: '2026-09-17 03:00',
      venue: '伯纳乌球场',
      home: { name: '皇家马德里', short: '皇马', rank: 1, played: 4, pts: 12, gf: 10, ga: 3, recent: ['W','W','W','D','W'], homeRec: [8,1,1], xg: 2.18, xga: 0.81, form: 84, star: '姆巴佩', inj: [] },
      away: { name: '莱比锡红牛', short: '莱比锡', rank: 5, played: 3, pts: 4, gf: 6, ga: 6, recent: ['D','W','L','D','W'], homeRec: [1,0,1], xg: 1.62, xga: 1.48, form: 57, star: '塞斯科', inj: ['主力中卫·伤缺'] },
      h2h: { n: 6, hw: 4, d: 1, aw: 1, goals: '13:5', last: ['3:1', '2:0', '1:1'] },
      sp: { w: 1.55, d: 3.81, l: 5.43 },
      rq: { line: -1, w: 2.08, d: 3.99, l: 2.68 },
      euro: { open: { w: 1.55, d: 4.10, l: 4.90 }, cur: { w: 1.48, d: 4.20, l: 5.20 } },
      asian: { open: '一球 1.90/1.96', cur: '一球/一球半 1.94/1.92', move: '升盘', dir: 'up', strength: 0.58 },
      ou: { line: 3.0, over: 1.86, under: 1.94, move: '大球降水', dir: 'up' },
      kelly: { w: 0.95, d: 0.97, l: 1.07 },
      volume: { w: 66, d: 18, l: 16 },
      mprob: { w: 0.663, d: 0.196, l: 0.141 },
      lam: [2.24, 0.94], goals: [0.05, 0.17, 0.26, 0.23, 0.16, 0.13], btts: 0.48,
      conf: 4, scores: [['2:1', 0.108], ['2:0', 0.102], ['3:1', 0.086]],
      picks: [
        { play: '胜平负', sel: '主胜', sp: 1.55, conf: 4, stake: 0.85, note: '模型概率 66.2%，市场隐含 59.1%，去水后价值 +2.7%' },
        { play: '总进球', sel: '总进球 3', sp: 4.6, conf: 4, stake: 0.7, note: '合计 λ=3.18，模型给出该进球数概率 22.3%，市场隐含 18.3%' }
      ],
      tags: ['欧战主场', '大球倾向'],
      summary: '主队欧战主场近 10 场 8 胜 1 平 1 负，客队中卫伤缺使高球防守下降；主胜与总进球双向一致，适合 2 串 1 组合。',
      risk: '客队高位逼抢强度大，可能制造意外进球；欧战第二轮常出现轮换。'
    },
    {
      id: 'm26091602', day: 'after', no: '周三002', league: '日职联', kickoff: '18:00', vtime: '2026-09-16 18:00',
      venue: '日产体育场',
      home: { name: '横滨水手', short: '横滨水手', rank: 8, played: 28, pts: 41, gf: 42, ga: 38, recent: ['W','L','D','W','L'], homeRec: [8,3,3], xg: 1.71, xga: 1.48, form: 60, star: '安德森·洛佩斯', inj: [] },
      away: { name: '川崎前锋', short: '川崎前锋', rank: 10, played: 28, pts: 38, gf: 40, ga: 41, recent: ['D','W','L','D','W'], homeRec: [5,4,5], xg: 1.58, xga: 1.62, form: 58, star: '家长昭博', inj: ['主力后腰·伤缺'] },
      h2h: { n: 16, hw: 5, d: 5, aw: 6, goals: '24:27', last: ['2:2', '1:0', '1:2'] },
      sp: { w: 2.26, d: 3.64, l: 2.66 },
      rq: { line: 0, w: 2.24, d: 3.6, l: 2.63 },
      euro: { open: { w: 2.20, d: 3.55, l: 3.00 }, cur: { w: 2.15, d: 3.60, l: 3.05 } },
      asian: { open: '平手 1.94/1.92', cur: '平手/半球 1.96/1.90', move: '升盘', dir: 'up', strength: 0.32 },
      ou: { line: 2.75, over: 1.86, under: 1.94, move: '持平', dir: 'flat' },
      kelly: { w: 0.97, d: 0.95, l: 1.00 },
      volume: { w: 40, d: 31, l: 29 },
      mprob: { w: 0.436, d: 0.289, l: 0.275 },
      lam: [1.62, 1.48], goals: [0.11, 0.23, 0.27, 0.21, 0.12, 0.06], btts: 0.57,
      conf: 3, scores: [['1:1', 0.113], ['2:1', 0.098], ['1:0', 0.089]],
      picks: [
        { play: '总进球', sel: '总进球 3', sp: 4.54, conf: 3, stake: 0.4, note: '合计 λ=3.10，模型给出该进球数概率 22.4%，市场隐含 18.5%' }
      ],
      tags: ['神奈川德比', '进球倾向高', '低置信'],
      summary: '两队攻强守弱，xG 合计 3.29，德比节奏快；胜负概率接近不建议参与胜负盘，总进球是本场唯一正期望项。',
      risk: '日职联球队轮换频繁且数据颗粒度较粗，模型 ECE 偏高，仓位从严。'
    },
    {
      id: 'm26091603', day: 'after', no: '周三003', league: '解放者杯', kickoff: '08:30', vtime: '2026-09-17 08:30',
      venue: '莫伦比球场',
      home: { name: '圣保罗', short: '圣保罗', rank: 5, played: 24, pts: 40, gf: 31, ga: 26, recent: ['W','D','W','L','W'], homeRec: [8,3,1], xg: 1.54, xga: 1.06, form: 68, star: '卢西亚诺', inj: [] },
      away: { name: '河床', short: '河床', rank: 3, played: 22, pts: 41, gf: 33, ga: 22, recent: ['W','W','D','W','D'], homeRec: [3,3,5], xg: 1.48, xga: 1.18, form: 71, star: '博雷', inj: [] },
      h2h: { n: 8, hw: 3, d: 3, aw: 2, goals: '9:7', last: ['1:1', '2:1', '0:0'] },
      sp: { w: 1.99, d: 3.51, l: 3.27 },
      rq: { line: -1, w: 4.21, d: 3.96, l: 1.63 },
      euro: { open: { w: 2.30, d: 3.05, l: 3.20 }, cur: { w: 2.25, d: 3.05, l: 3.30 } },
      asian: { open: '平手/半球 1.94/1.92', cur: '平手/半球 1.92/1.94', move: '持平', dir: 'flat', strength: 0.12 },
      ou: { line: 2.25, over: 1.94, under: 1.86, move: '小球降水', dir: 'down' },
      kelly: { w: 0.99, d: 0.94, l: 1.02 },
      volume: { w: 45, d: 33, l: 22 },
      mprob: { w: 0.442, d: 0.312, l: 0.246 },
      lam: [1.38, 1.02], goals: [0.14, 0.26, 0.26, 0.18, 0.10, 0.06], btts: 0.46,
      conf: 3, scores: [['1:1', 0.118], ['1:0', 0.102], ['0:0', 0.084]],
      picks: [
        { play: '总进球', sel: '总进球 2', sp: 3.77, conf: 3, stake: 0.5, note: '合计 λ=2.40，模型给出该进球数概率 26.9%，市场隐含 22.3%' },
        { play: '胜平负', sel: '平局', sp: 3.51, conf: 2, stake: 0.15, note: '模型概率 28.7%，市场隐含 26.0%，去水后价值 +0.7%' }
      ],
      tags: ['淘汰赛小球', '防守优先', '低置信'],
      summary: '典型的南美淘汰赛：防守优先、进球稀少。历史交锋 8 场 3 平、场均 2.0 球，小球是本场最符合数据的选项。',
      risk: '南美赛事主场氛围与裁判尺度波动大，模型 ECE 约 3.1%，为本日最高，仓位已压至最小。'
    },
    {
      id: 'm26091604', day: 'after', no: '周三004', league: '英联杯', kickoff: '02:45', vtime: '2026-09-17 02:45',
      venue: '圣詹姆斯公园',
      home: { name: '纽卡斯尔联', short: '纽卡', rank: 7, played: 4, pts: 6, gf: 7, ga: 6, recent: ['W','L','D','W','L'], homeRec: [2,0,0], xg: 1.78, xga: 1.22, form: 62, star: '伊萨克', inj: ['多名主力轮休（杯赛）'] },
      away: { name: '南安普顿', short: '南安普顿', rank: 18, played: 4, pts: 1, gf: 3, ga: 10, recent: ['L','L','D','L','L'], homeRec: [0,0,2], xg: 0.92, xga: 1.86, form: 31, star: '阿姆斯特朗', inj: [] },
      h2h: { n: 12, hw: 8, d: 2, aw: 2, goals: '26:11', last: ['3:1', '2:0', '4:1'] },
      sp: { w: 1.28, d: 5.12, l: 8.63 },
      rq: { line: -2, w: 3.61, d: 4.11, l: 1.71 },
      euro: { open: { w: 1.40, d: 4.50, l: 6.00 }, cur: { w: 1.35, d: 4.60, l: 6.40 } },
      asian: { open: '球半 1.92/1.94', cur: '球半/两球 1.90/1.96', move: '升盘', dir: 'up', strength: 0.61 },
      ou: { line: 3.25, over: 1.90, under: 1.90, move: '持平', dir: 'flat' },
      kelly: { w: 0.92, d: 1.02, l: 1.10 },
      volume: { w: 72, d: 16, l: 12 },
      mprob: { w: 0.714, d: 0.166, l: 0.120 },
      lam: [2.38, 0.82], goals: [0.04, 0.15, 0.24, 0.24, 0.17, 0.16], btts: 0.44,
      conf: 3, scores: [['2:0', 0.112], ['3:1', 0.094], ['3:0', 0.086]],
      picks: [
        { play: '让球胜平负', sel: '让胜', sp: 3.61, conf: 3, stake: 0.4, note: '模型概率 28.1%，市场隐含 25.0%，去水后价值 +1.4%' },
        { play: '总进球', sel: '总进球 3', sp: 4.56, conf: 3, stake: 0.45, note: '合计 λ=3.20，模型给出该进球数概率 22.3%，市场隐含 18.4%' }
      ],
      tags: ['杯赛轮换', '实力悬殊', '注意阵容'],
      summary: '实力差距显著且客队赛季开局 1 分，但杯赛主队明确轮休主力，模型已将置信度从 4 下调至 3。',
      risk: '杯赛轮换是最难量化的变量。首发公布后模型会重算，建议在赛前 60 分钟复核推荐。'
    }
  ];

  /* ---------------- 战绩公示（可回溯） ---------------- */
  var records = {
    kpi: {
      window: '近 30 日 · 2026-08-15 ~ 2026-09-14',
      totalPicks: 412, hit: 261, rate: 0.633,
      stake: 206.0, profit: 14.02, roi: 0.068,
      maxDrawdown: -12.4, maxWin: 9, maxLose: 4,
      avgSp: 1.94, avgStake: 0.5
    },
    weekly: [
      { w: 'W1 (8/15-8/21)', picks: 34, hit: 21, rate: 0.618, roi: 0.021 },
      { w: 'W2 (8/22-8/28)', picks: 36, hit: 25, rate: 0.694, roi: 0.142 },
      { w: 'W3 (8/29-9/4)', picks: 31, hit: 18, rate: 0.581, roi: -0.036 },
      { w: 'W4 (9/5-9/11)', picks: 38, hit: 25, rate: 0.658, roi: 0.091 },
      { w: 'W5 (9/12-9/14)', picks: 16, hit: 10, rate: 0.625, roi: 0.048 },
      { w: 'W6', picks: 35, hit: 22, rate: 0.629, roi: 0.055 },
      { w: 'W7', picks: 33, hit: 20, rate: 0.606, roi: 0.012 },
      { w: 'W8', picks: 37, hit: 25, rate: 0.676, roi: 0.124 },
      { w: 'W9', picks: 30, hit: 17, rate: 0.567, roi: -0.062 },
      { w: 'W10', picks: 36, hit: 24, rate: 0.667, roi: 0.097 },
      { w: 'W11', picks: 39, hit: 26, rate: 0.667, roi: 0.081 },
      { w: 'W12', picks: 37, hit: 23, rate: 0.622, roi: 0.043 }
    ],
    byPlay: [
      { play: '胜平负', picks: 168, hit: 108, rate: 0.643, roi: 0.074, avgSp: 1.86 },
      { play: '让球胜平负', picks: 96, hit: 54, rate: 0.563, roi: 0.041, avgSp: 2.42 },
      { play: '总进球', picks: 112, hit: 74, rate: 0.661, roi: 0.092, avgSp: 1.92 },
      { play: '半全场', picks: 24, hit: 11, rate: 0.458, roi: -0.058, avgSp: 3.85 },
      { play: '比分', picks: 12, hit: 3, rate: 0.250, roi: -0.184, avgSp: 8.20 }
    ],
    byLeague: [
      { league: '英超', picks: 78, hit: 51, rate: 0.654, roi: 0.081 },
      { league: '西甲', picks: 62, hit: 41, rate: 0.661, roi: 0.094 },
      { league: '意甲', picks: 58, hit: 38, rate: 0.655, roi: 0.071 },
      { league: '德甲', picks: 51, hit: 33, rate: 0.647, roi: 0.108 },
      { league: '法甲', picks: 34, hit: 20, rate: 0.588, roi: 0.032 },
      { league: '欧冠', picks: 41, hit: 25, rate: 0.610, roi: 0.054 },
      { league: '日职联', picks: 33, hit: 19, rate: 0.576, roi: -0.021 },
      { league: '巴甲 / 南美', picks: 28, hit: 16, rate: 0.571, roi: -0.034 },
      { league: '北欧 / 其他', picks: 27, hit: 18, rate: 0.667, roi: 0.062 }
    ],
    /* 可靠性曲线：预测概率 vs 实际发生频率（校准的核心证据） */
    reliability: [
      { bucket: '30–40%', predicted: 0.352, actual: 0.341, n: 64 },
      { bucket: '40–50%', predicted: 0.451, actual: 0.462, n: 98 },
      { bucket: '50–60%', predicted: 0.548, actual: 0.534, n: 121 },
      { bucket: '60–70%', predicted: 0.648, actual: 0.661, n: 96 },
      { bucket: '70–80%', predicted: 0.742, actual: 0.729, n: 51 },
      { bucket: '80%+', predicted: 0.841, actual: 0.853, n: 32 }
    ],
    recent: [
      { date: '09-14', no: '周一006', league: '巴甲', play: '总进球', sel: '总进球 2', sp: 1.84, res: 'win', pf: 0.38 },
      { date: '09-14', no: '周一005', league: '瑞典超', play: '胜平负', sel: '主胜', sp: 1.72, res: 'win', pf: 0.36 },
      { date: '09-14', no: '周一004', league: '德甲', play: '总进球', sel: '总进球 4+', sp: 1.88, res: 'win', pf: 0.44 },
      { date: '09-14', no: '周一004', league: '德甲', play: '让球胜平负', sel: '让胜 -3', sp: 2.05, res: 'win', pf: 0.42 },
      { date: '09-14', no: '周一003', league: '意甲', play: '胜平负', sel: '主胜', sp: 1.38, res: 'win', pf: 0.38 },
      { date: '09-14', no: '周一003', league: '意甲', play: '总进球', sel: '总进球 2', sp: 1.78, res: 'lose', pf: -0.60 },
      { date: '09-14', no: '周一002', league: '西甲', play: '总进球', sel: '总进球 3', sp: 1.90, res: 'win', pf: 0.63 },
      { date: '09-14', no: '周一002', league: '西甲', play: '胜平负', sel: '主胜', sp: 1.44, res: 'win', pf: 0.40 },
      { date: '09-14', no: '周一001', league: '英超', play: '胜平负', sel: '主胜', sp: 1.62, res: 'win', pf: 0.62 },
      { date: '09-14', no: '周一001', league: '英超', play: '让球胜平负', sel: '让平 -1', sp: 3.35, res: 'lose', pf: -0.35 },
      { date: '09-13', no: '周日012', league: '英超', play: '总进球', sel: '总进球 3', sp: 1.86, res: 'lose', pf: -0.50 },
      { date: '09-13', no: '周日009', league: '德甲', play: '胜平负', sel: '客胜', sp: 2.60, res: 'win', pf: 0.48 },
      { date: '09-13', no: '周日007', league: '意甲', play: '总进球', sel: '总进球 2', sp: 1.80, res: 'win', pf: 0.60 },
      { date: '09-13', no: '周日005', league: '西甲', play: '让球胜平负', sel: '让胜 -1', sp: 2.15, res: 'push', pf: 0.00 },
      { date: '09-13', no: '周日003', league: '法甲', play: '胜平负', sel: '主胜', sp: 1.75, res: 'win', pf: 0.45 },
      { date: '09-13', no: '周日001', league: '英超', play: '胜平负', sel: '主胜', sp: 1.92, res: 'lose', pf: -0.70 },
      { date: '09-12', no: '周六018', league: '西甲', play: '总进球', sel: '总进球 3', sp: 1.88, res: 'win', pf: 0.53 },
      { date: '09-12', no: '周六015', league: '德甲', play: '胜平负', sel: '主胜', sp: 1.55, res: 'win', pf: 0.55 },
      { date: '09-12', no: '周六011', league: '意甲', play: '让球胜平负', sel: '让平 -1', sp: 3.20, res: 'lose', pf: -0.32 },
      { date: '09-12', no: '周六006', league: '英超', play: '总进球', sel: '小 2.75', sp: 1.90, res: 'win', pf: 0.54 }
    ],
    monthly: [
      { month: '2026-04', picks: 386, rate: 0.612, roi: 0.041, note: '赛季末轮次波动，模型下调置信度权重' },
      { month: '2026-05', picks: 402, rate: 0.641, roi: 0.089, note: '五大联赛收官，多空仓等待' },
      { month: '2026-06', picks: 214, rate: 0.598, roi: -0.028, note: '赛事稀少 + 杯赛属性强，唯一负回报月，已公开披露' },
      { month: '2026-07', picks: 268, rate: 0.627, roi: 0.052, note: '北欧 / 南美赛季中段' },
      { month: '2026-08', picks: 398, rate: 0.635, roi: 0.074, note: '五大联赛开季，模型重训后首个完整月' },
      { month: '2026-09', picks: 176, rate: 0.630, roi: 0.061, note: '进行中（截至 9/14）' }
    ],
    disclaimer: '以上为演示样本数据，用于展示可回溯复盘的产品结构。真实上线后，所有推荐会在开赛前落库并锁定，赛后自动结算公示，不可修改、不可删除。任何月份，包括负回报月份，都会原样保留。'
  };

  /* ---------------- 赔率异动榜 / 数据看板 ---------------- */
  var oddsMoves = [
    { no: '周一004', league: '德甲', match: '拜仁 vs 门兴', open: '两球半', cur: '两球半/三球', dir: 'up', strength: 0.68, note: '连续升盘，主队侧资金主导' },
    { no: '周一002', league: '西甲', match: '皇马 vs 赫罗纳', open: '一球/一球半', cur: '球半', dir: 'up', strength: 0.78, note: '深盘加强，注意过热' },
    { no: '周一001', league: '英超', match: '曼城 vs 水晶宫', open: '半球/一球', cur: '一球', dir: 'up', strength: 0.62, note: '升盘但水位同步走高，信心打折' },
    { no: '周三001', league: '欧冠', match: '皇马 vs 莱比锡', open: '一球', cur: '一球/一球半', dir: 'up', strength: 0.58, note: '客队中卫伤缺后盘口上调' },
    { no: '周一006', league: '巴甲', match: '弗拉门戈 vs 帕尔梅拉斯', open: '平手/半球', cur: '半球', dir: 'up', strength: 0.51, note: '德比唯一升盘方' },
    { no: '周三003', league: '解放者杯', match: '圣保罗 vs 河床', open: '平手/半球', cur: '平手/半球', dir: 'flat', strength: 0.12, note: '盘口静止，小球方向降水' },
    { no: '周一005', league: '瑞典超', match: 'AIK vs 哥德堡', open: '半球', cur: '半球/一球', dir: 'up', strength: 0.55, note: '主队主场强势被认可' }
  ];

  var xgTable = [
    { team: '拜仁慕尼黑', league: '德甲', xg: 2.74, xga: 0.72, diff: 2.02, gpg: 4.00 },
    { team: '曼彻斯特城', league: '英超', xg: 2.31, xga: 0.94, diff: 1.37, gpg: 2.75 },
    { team: '巴黎圣日耳曼', league: '法甲', xg: 2.28, xga: 0.85, diff: 1.43, gpg: 3.25 },
    { team: '皇家马德里', league: '西甲', xg: 2.18, xga: 0.81, diff: 1.37, gpg: 2.50 },
    { team: '阿森纳', league: '英超', xg: 2.06, xga: 0.88, diff: 1.18, gpg: 2.25 },
    { team: '国际米兰', league: '意甲', xg: 1.86, xga: 1.05, diff: 0.81, gpg: 2.00 },
    { team: '纽卡斯尔联', league: '英超', xg: 1.78, xga: 1.22, diff: 0.56, gpg: 1.75 },
    { team: '弗拉门戈', league: '巴甲', xg: 1.94, xga: 1.02, diff: 0.92, gpg: 1.67 },
    { team: '汉堡', league: '德乙', xg: 1.52, xga: 1.24, diff: 0.28, gpg: 1.60 },
    { team: '川崎前锋', league: '日职联', xg: 1.58, xga: 1.62, diff: -0.04, gpg: 1.43 }
  ];

  return {
    meta: meta,
    model: model,
    leagues: leagues,
    matches: matches,
    records: records,
    oddsMoves: oddsMoves,
    xgTable: xgTable
  };
})();

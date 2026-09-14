/* ==========================================================================
   竞析 JINGXI · 串关搭配与倍投资金计划引擎
   --------------------------------------------------------------------------
   一、倍投算法来源
     本算法复刻自用户提供的《升级版利润测算表》，其核心不是"固定倍数倍投"，
     而是"按累计盈利目标动态反算出票额"：

       出票额(n) = ( 累投(n-1) + 目标利润 × n ) / (赔率 − 1)
       实际注额  = EVEN( 出票额 )            ← Excel EVEN()：向上取最近的偶数
       累投(n)   = 累投(n-1) + 实际注额

     含义：任何一期命中，都能一次性收回此前全部投入，并实现「目标利润 × 期号」
     的净盈利。因此赔率越高，单期注额越小；赔率越低，资金需求指数式膨胀。

     已用原始表数值校验：赔率4.5/日利润200/9期 → 峰值 5,962；
     赔率6/日利润200/5期 → 峰值 788；与表格「合计」单元格完全一致。

   二、本引擎额外做的事（原表没有的）
     原表只算了"中了能赚多少"，没算"一直不中会怎样"。本引擎补上：
       · 全周期未命中概率（= 破产概率）
       · 单周期期望收益（含全灭情形）
       · 峰值资金占用与资金效率
     这是把"利润测算"还原成"风险测算"的关键一步。
   ========================================================================== */
(function (global) {
  'use strict';

  var JX = global.JX, U = JX.U, M = JX.M;
  if (!U || !M) { console.error('[竞析] parlay.js 必须在 core.js 之后加载'); return; }

  var P = {};

  /* ======================================================================
     一、倍投计划
     ====================================================================== */

  /* Excel EVEN()：向上取到最近的偶数（负数向零外取偶，这里注额恒为正） */
  function evenUp(v) { return Math.ceil(v / 2) * 2; }

  /**
   * 生成倍投计划（严格复刻原始表格的四个细节）
   * @param {number} E    组合赔率（串关时为各腿 SP 之积）
   * @param {number} C    目标利润（每期递增基数，单位与注额一致）
   * @param {number} N    最大期数（原表的"N 手"，走满即止损）
   * @param {object} opt  { unit: 最小注额(默认2), startCum: 起始累计投入(续投场景),
   *                        zeroFirst: 首期目标利润置 0（原表首期 C 为空时的语义）,
   *                        oddsArr: 逐期赔率数组（原表允许多档位按期切换赔率） }
   */
  P.martingale = function (E, C, N, opt) {
    opt = opt || {};
    var unit = opt.unit || 2;
    E = +E; C = +C; N = Math.max(1, Math.round(+N));
    if (!(E > 1)) return null;
    var oddsArr = opt.oddsArr || null;
    var eAt = function (n) {
      var v = oddsArr && oddsArr[n - 1] !== undefined ? +oddsArr[n - 1] : E;
      return v > 1 ? v : E;
    };
    var cum = +opt.startCum || 0;
    var startCum = cum;
    var rows = [];
    for (var n = 1; n <= N; n++) {
      var e = eAt(n);
      /* 原表首期若「每天利润」留空，目标按 0 计（只求回本，见「山西」表） */
      var target = (opt.zeroFirst && n === 1) ? 0 : C * n;
      var raw = (cum + target) / (e - 1);
      var stake = Math.max(unit, evenUp(raw));
      var payout = stake * e;
      var total = cum + stake;
      rows.push({
        n: n,
        odds: e,
        raw: raw,
        stake: stake,
        cum: total,               // 累计投入（含起始累投）
        payout: payout,           // 命中奖金
        net: payout - total,      // 命中净盈利
        loss: -total              // 未命中时的累计亏损
      });
      cum = total;
    }
    return {
      E: E, C: C, N: N, unit: unit, oddsArr: oddsArr,
      startCum: startCum,
      zeroFirst: !!opt.zeroFirst,
      rows: rows,
      peak: cum,                        // 峰值资金需求 = 账户最低保证金
      extraCapital: cum - startCum,     // 本轮实际需要新增投入的资金
      firstStake: rows[0].stake,
      lastStake: rows[N - 1].stake,
      lastNet: rows[N - 1].net
    };
  };

  /**
   * 倍投风险测算：把"中一次赚多少"扩展成完整的概率分布
   * @param {number} p 单期命中概率（串关的联合概率）
   */
  P.risk = function (plan, p) {
    if (!plan || !(p > 0) || p >= 1) return null;
    var q = 1 - p, N = plan.N;
    var pMissAll = Math.pow(q, N);            // 全周期未命中 → 亏损峰值资金
    var expReturn = -pMissAll * plan.peak;    // 全灭情形
    var rows = [];
    var acc = 0;
    for (var i = 0; i < plan.rows.length; i++) {
      var r = plan.rows[i];
      var pr = Math.pow(q, r.n - 1) * p;      // 恰在第 n 期命中
      acc += pr;
      expReturn += pr * r.net;
      rows.push({ n: r.n, prob: pr, cumProb: acc, net: r.net, stake: r.stake, cum: r.cum });
    }
    return {
      p: p, q: q, N: N,
      pMissAll: pMissAll,
      pHit: 1 - pMissAll,
      expReturn: expReturn,
      expPerCycle: expReturn / plan.peak,               // 以峰值资金为基数的周周期期望收益率
      expCycles: pMissAll > 0 ? 1 / pMissAll : Infinity,  // 平均多少个周期才会遇到一次全灭（几何分布）
      hitRows: rows,
      /* 命中一次就够：单期内至少命中一次的概率 */
      anyHitProb: 1 - pMissAll
    };
  };

  /* ======================================================================
     二、串关搭配
     ====================================================================== */

  /* 从一场比赛里取出可用的"腿"（每个玩法取模型概率最高的方向，并附 EV） */
  P.legsOf = function (m, opt) {
    opt = opt || {};
    var r = JX.model(m), out = [];
    var evs = [];

    if (m.sp) {
      evs.push({ play: '胜平负', sel: '主胜', sp: m.sp.w, p: r.w, side: 'w' });
      evs.push({ play: '胜平负', sel: '平局', sp: m.sp.d, p: r.d, side: 'd' });
      evs.push({ play: '胜平负', sel: '客胜', sp: m.sp.l, p: r.l, side: 'l' });
    }
    if (m.rq) {
      evs.push({ play: '让球胜平负', sel: '让胜', sp: m.rq.w, p: r.rq.w, side: 'w' });
      evs.push({ play: '让球胜平负', sel: '让平', sp: m.rq.d, p: r.rq.d, side: 'd' });
      evs.push({ play: '让球胜平负', sel: '让负', sp: m.rq.l, p: r.rq.l, side: 'l' });
    }
    evs.forEach(function (x) {
      if (!isFinite(x.sp) || x.sp <= 1 || !isFinite(x.p) || x.p <= 0) return;
      x.ev = x.p * x.sp - 1;
      x.match = m;
      x.mid = m.id;
      out.push(x);
    });
    return out;
  };

  /* 每场保留概率最高的前 k 条腿，构成候选池 */
  P.legPool = function (matches, perMatch) {
    perMatch = perMatch || 2;
    var pool = [];
    matches.forEach(function (m) {
      var legs = P.legsOf(m).sort(function (a, b) { return b.p - a.p; });
      pool = pool.concat(legs.slice(0, perMatch));
    });
    return pool;
  };

  /* 组合若干条腿（不同场次才允许） */
  function combine(legs, k) {
    var res = [];
    (function rec(start, cur) {
      if (cur.length === k) { res.push(cur.slice()); return; }
      for (var i = start; i < legs.length; i++) {
        if (cur.some(function (x) { return x.mid === legs[i].mid; })) continue;
        cur.push(legs[i]); rec(i + 1, cur); cur.pop();
      }
    })(0, []);
    return res;
  }

  /**
   * 计算组合统计量
   * 说明：联合概率按各腿独立相乘。这是近似——同联赛/同时间开赛的比赛存在
   *      轻微相关性（共同的天气、裁判尺度、赛程密度）。页面会标注同联赛组合。
   */
  P.stats = function (combo) {
    var p = 1, sp = 1, evs = [];
    combo.forEach(function (l) {
      p *= l.p;
      sp *= l.sp;
      evs.push(l.ev);
    });
    var ev = p * sp - 1;
    var sameLeague = {};
    combo.forEach(function (l) { sameLeague[l.match.league] = (sameLeague[l.match.league] || 0) + 1; });
    var leagues = Object.keys(sameLeague);
    var corr = leagues.some(function (k) { return sameLeague[k] > 1; });
    return {
      legs: combo,
      k: combo.length,
      p: p,
      sp: sp,
      fair: p > 0 ? 1 / p : 0,
      ev: ev,
      /* 官方水位在串关中的放大：单关平均水位 ≈ 13%，串关叠加为 (1+m)^k − 1 */
      marginStack: null,
      sameLeague: corr,
      leagues: leagues,
      /* 打平所需概率：只要真实概率 ≥ 1/组合赔率，期望即为非负 */
      breakEvenP: 1 / sp,
      pGap: p - 1 / sp,
      conf: Math.max(1, Math.min(5, Math.round(p * 5)))
    };
  };

  /* 生成串关组合池并按需求筛选 */
  P.build = function (matches, opt) {
    opt = opt || {};
    var kmin = opt.kmin || 2, kmax = opt.kmax || 3;
    var pool = P.legPool(matches, opt.perMatch || 2);
    var all = [];
    for (var k = kmin; k <= kmax; k++) {
      combine(pool, k).forEach(function (c) {
        var s = P.stats(c);
        /* 过滤：组合赔率过低（等于送钱给水位）或过高（命中率过低）都没有参考价值 */
        if (s.sp < (opt.minOdds || 1.6)) return;
        if (s.sp > (opt.maxOdds || 60)) return;
        if (s.p < (opt.minProb || 0.02)) return;
        all.push(s);
      });
    }
    return all;
  };

  /* 按目标赔率档位挑选代表组合（对应原表的 3.0 / 4.5 / 6.0 / 10.0 等档位） */
  P.pickTiers = function (combos, tiers) {
    tiers = tiers || [2.5, 3.0, 4.5, 6.0, 10.0];
    var used = {};
    return tiers.map(function (t) {
      var best = null, bestScore = -Infinity;
      combos.forEach(function (c, i) {
        if (used[i]) return;
        var d = Math.abs(c.sp - t) / t;
        if (d > 0.35) return;
        /* 同档位里选：赔率贴近 + 命中概率高 */
        var score = c.p * 10 - d * 3;
        if (score > bestScore) { bestScore = score; best = i; }
      });
      if (best === null) return null;
      used[best] = 1;
      var r = combos[best];
      r.tier = t;
      return r;
    }).filter(Boolean);
  };

  /* 单个串关周期的完整分析（供页面直接渲染） */
  P.analyzeCombo = function (combo, cfg) {
    cfg = cfg || {};
    var C = cfg.dailyProfit || 200;
    var N = cfg.periods || 9;
    var plan = P.martingale(combo.sp, C, N);
    var risk = plan ? P.risk(plan, combo.p) : null;
    return { combo: combo, plan: plan, risk: risk, cfg: { C: C, N: N } };
  };

  /* 原表预设（用于对照，数值来自《升级版利润测算表》） */
  P.presets = [
    { name: 'B 计划（中赔）', E: 4.5, C: 200, N: 9, src: 'Sheet1 / Sheet4 / Sheet5' },
    { name: 'A 计划（高赔 10）', E: 10, C: 2000, N: 20, src: 'Sheet1' },
    { name: '低赔 3 倍方案', E: 3, C: 200, N: 9, src: 'Sheet6' },
    { name: '低赔 3 倍 · 短周期', E: 6, C: 200, N: 5, src: 'Sheet6 A 计划' },
    { name: '5.5 八手', E: 5.5, C: 7200, N: 8, src: '3.0 表' }
  ];

  global.JX.PARLAY = P;
})(window);

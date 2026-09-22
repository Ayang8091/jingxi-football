/* ==========================================================================
   竞析 JINGXI · 串关模拟（主站导航页）
   --------------------------------------------------------------------------
   定位：以「今日预测」页展示的推荐结果（m.recs：胜平负/让球各 1 条、
   总进球/半全场各 2 条、比分 3 条，组内按概率降序）为组合依据，
   提供八种搭配模式的串关方案模拟：
     1) 胜平负组合        2) 让球胜平负组合     3) 总进球组合
     4) 胜平负+让球组合   5) 胜平负+总进球组合  6) 让球+总进球组合
         （4~6 为双玩法搭配，配置与算法完全一致：主玩法固定占 1 场、只取 1 条，
           其余（关数-1）场归另一玩法并取该场全部结果。2 串 1 因此是：
           胜平负 1 条 + 让球胜平负 1 条；胜平负 1 条 + 总进球 2 条；
           让球胜平负 1 条 + 总进球 2 条）
     7) 玩法混合组合      （五种玩法混合，与今日预测完全同口径）
     8) 按赔率混合组合    （不限玩法，以组合赔率区间 3~50 倍为核心筛选，区间内按 EV 排序）
   规则：
     · 关数 = 场数 = 腿数（2 串 1 = 2 场 = 2 腿），每一场的腿数（结果数）按「今日预测」取：
       单玩法组合每场取该玩法全部结果（2 串 1 = 总进球 2 条 + 总进球 2 条）；
       胜平负、让球胜平负每场 1 条；
     · 同一场比赛在同一玩法下的多个结果「合并为一条腿」（复式覆盖）：
       如「周一001 中国女 vs 菲律宾女 总进球 · 2球、3球」，腿赔率 = 腿内**最高的** SP；
     · 同一场比赛不可重复串联（竞彩规则）；
     · 组合赔率 = 各腿 SP 相乘；联合概率 = 各腿概率相乘（独立性近似）；
     · 赔率区间预设 3~50 倍与 50 倍以上，结果统一按 EV 降序排列；
     · 某玩法暂无推荐时，可开启「模型首选补充」生成结构参考腿。
   ========================================================================== */
(function (global) {
  'use strict';

  var JX = global.JX, U = JX.U, M = JX.M, C = JX.C;
  var D = global.JX_DATA;
  var pickProb = global.JX.pickProb;

  var STORE_KEY = 'jx.sim.v1';
  var LO_MIN = 3, HI_CAP = 999999;   // HI_CAP 视为「不设上限」（50 倍以上 / 全部）；复式高关数组合赔率可能上万倍

  var state = {
    day: 'today',
    combo: 'had',      // had | hhad | ttg | had_hhad | had_ttg | hhad_ttg | mix3 | oddsMix
    k: 3,              // 关数 2/3/4
    oddsMin: 3,
    oddsMax: 50,
    inclModel: true    // 无推荐时用模型首选腿补充
  };
  try {
    var s = localStorage.getItem(STORE_KEY);
    if (s) {
      var o = JSON.parse(s);
      ['day', 'combo', 'k', 'oddsMin', 'oddsMax', 'inclModel'].forEach(function (key) {
        if (o && o[key] !== undefined) state[key] = o[key];
      });
    }
  } catch (e) { }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { } }

  var COMBOS = [
    { k: 'had', l: '胜平负组合', plays: ['胜平负'], desc: '每场取今日预测的「胜平负」结果（1 条），2 串 1 = 两场各 1 条' },
    { k: 'hhad', l: '让球胜平负组合', plays: ['让球胜平负'], desc: '每场取今日预测的「让球胜平负」结果（1 条），2 串 1 = 两场各 1 条' },
    { k: 'ttg', l: '总进球组合', plays: ['总进球'], desc: '每场取今日预测的「总进球」全部结果（2 条），2 串 1 = 总进球 2 条 + 总进球 2 条' },
    {
      k: 'had_hhad', l: '胜平负+让球组合', plays: ['胜平负', '让球胜平负'], req: ['胜平负', '让球胜平负'],
      desc: '「胜平负」占 1 场（1 条），其余场取「让球胜平负」结果（1 条），2 串 1 = 胜平负 1 条 + 让球胜平负 1 条'
    },
    {
      k: 'had_ttg', l: '胜平负+总进球组合', plays: ['胜平负', '总进球'], req: ['胜平负', '总进球'],
      desc: '「胜平负」占 1 场（1 条），其余场取「总进球」全部结果（2 条），2 串 1 = 胜平负 1 条 + 总进球 2 条'
    },
    {
      k: 'hhad_ttg', l: '让球+总进球组合', plays: ['让球胜平负', '总进球'], req: ['让球胜平负', '总进球'],
      desc: '「让球胜平负」占 1 场（1 条），其余场取「总进球」全部结果（2 条），2 串 1 = 让球胜平负 1 条 + 总进球 2 条'
    },
    {
      k: 'mix3', l: '玩法混合组合', plays: ['胜平负', '让球胜平负', '总进球', '半全场', '比分'], mix: true,
      desc: '每场从五种玩法里挑 1 条腿，与今日预测推荐完全同口径，按 EV 从高到低排序'
    },
    {
      k: 'oddsMix', l: '按赔率混合组合', plays: ['胜平负', '让球胜平负', '总进球', '半全场', '比分'], mix: true,
      desc: '每场从五种玩法里挑 1 条腿，以组合赔率落在所选区间为核心，按 EV 排序'
    }
  ];
  function comboOf() { return COMBOS.filter(function (c) { return c.k === state.combo; })[0] || COMBOS[0]; }

  /* ------------------------------------------------- 今日预测的各玩法结果数 */
  /* 与 datasource.buildRecs 完全同口径：胜平负 / 让球胜平负各 1 条、
     总进球 / 半全场各 2 条、比分 3 条。 */
  var REC_N = { '胜平负': 1, '让球胜平负': 1, '总进球': 2, '半全场': 2, '比分': 3 };
  var K_DEF = 2;                     // 关数基准档：2 串 1（= 2 场）

  /* 每注构成文案：关数 = 场数，每场取该玩法在今日预测里的全部结果。
     单玩法：每场各自的结果数 × 场数；
     双玩法：主玩法只占 1 场（1 条），其余（关数-1）场归第二玩法 → 构成随关数增长。 */
  function compText(cfg, k) {
    if (!cfg || cfg.mix) return null;
    k = k || state.k;
    if (!cfg.req) {
      var n = REC_N[cfg.plays[0]] || 1;
      if (k <= 2) {                              // 2 串 1 直接摊开：总进球 2 条 + 总进球 2 条
        var blocks = [];
        for (var i = 0; i < k; i++) blocks.push(cfg.plays[0] + ' ' + n + ' 条');
        return blocks.join(' + ');
      }
      return cfg.plays[0] + ' ' + n + ' 条 × ' + k + ' 场（共 ' + (n * k) + ' 条）';
    }
    var main = cfg.req[0], sec = cfg.req[1], sn = REC_N[sec] || 1;
    return main + ' 1 条 + ' + sec + ' ' + (sn * (k - 1)) + ' 条';
  }
  function syncK(cfg) {
    /* 换模式时把关数带回基准档 2 串 1（就是你给的构成表那一档）；
       关数 2/3/4 仍可手动切换，切完即按手动档重算。 */
    cfg = cfg || comboOf();
    if (!cfg.mix) state.k = K_DEF;
  }
  syncK();

  /* ------------------------------------------------------------ 腿池构建 */
  function modelFirstLeg(m, play) {
    /* 推荐明细缺该玩法时，用模型首选方向补一条「结构参考」腿 */
    var r = JX.model(m), cands = [], i;
    if (play === '胜平负') {
      if (!m.sp) return null;                     // 官方未开售胜平负的场次，无法构造该玩法腿
      cands = [
        { sel: '主胜', sp: m.sp.w, p: r.w },
        { sel: '平局', sp: m.sp.d, p: r.d },
        { sel: '客胜', sp: m.sp.l, p: r.l }
      ];
    } else if (play === '让球胜平负' && m.rq && isFinite(m.rq.line) && r.rq) {
      cands = [
        { sel: '让胜', sp: m.rq.w, p: r.rq.w },
        { sel: '让平', sp: m.rq.d, p: r.rq.d },
        { sel: '让负', sp: m.rq.l, p: r.rq.l }
      ];
    } else if (play === '总进球') {
      /* 总进球各档位的官方 SP 不在结构化字段中，无法构造——跳过 */
      return null;
    }
    cands.sort(function (a, b) { return b.p - a.p; });
    var best = cands[0];
    if (!best || !(best.sp > 1) || !(best.p > 0)) return null;
    return { play: play, sel: best.sel, sp: best.sp, p: best.p, src: '模型首选' };
  }

  function buildMatchLegs() {
    /* 返回 [{ mid, no, name, legs:[{play,sel,sp,p,ev,src}] }]，仅限所选日期。
       腿池首选「今日预测」的推荐（m.recs，与首页/单场页完全同口径）；
       演示快照等无 recs 的数据回退到旧 picks + 模型首选腿。 */
    var cfg = comboOf();
    var ms = (D.matches || []).filter(function (m) {
      return m.day === state.day && (m.sp || (m.recs && m.recs.length) || (m.picks && m.picks.length));
    });
    var out = [];
    ms.forEach(function (m) {
      var legs = [], seen = {};
      /* 首选：今日预测推荐（recs 已按各玩法概率降序、固定条数输出） */
      (m.recs || []).forEach(function (rc) {
        if (cfg.plays.indexOf(rc.play) === -1) return;
        var key = rc.play + '|' + rc.sel;
        if (seen[key]) return;
        if (!(rc.sp > 1) || !(rc.p > 0)) return;   // 比分官方 SP 缺失时无法参与串关，跳过
        seen[key] = 1;
        legs.push({ play: rc.play, sel: rc.sel, sp: +rc.sp, p: rc.p, ev: rc.p * rc.sp - 1, src: '今日预测', basis: rc.basis || 'model' });
      });
      /* 兜底：无 recs（演示快照）—— 旧 picks 逻辑 */
      if (!legs.length) {
        (m.picks || []).forEach(function (pk) {
          if (cfg.plays.indexOf(pk.play) === -1) return;
          if (seen[pk.play + '|' + pk.sel]) return;
          var p = pickProb(m, pk);
          if (!(p > 0) || !(pk.sp > 1)) return;
          seen[pk.play + '|' + pk.sel] = 1;
          legs.push({ play: pk.play, sel: pk.sel, sp: +pk.sp, p: p, ev: p * pk.sp - 1, src: '演示推荐' });
        });
      }
      /* 可选：某玩法仍无腿时，用模型首选方向补「结构参考」腿 */
      if (state.inclModel) {
        cfg.plays.forEach(function (pl) {
          var has = legs.some(function (lg) { return lg.play === pl; });
          if (has) return;
          var lg = modelFirstLeg(m, pl);
          if (lg) { legs.push(lg); }
        });
      }
      if (legs.length) {
        legs.sort(function (a, b) { return b.p - a.p; });
        out.push({
          mid: m.id, no: m.no,
          name: (m.home.short || m.home.name) + ' vs ' + (m.away.short || m.away.name),
          legs: legs
        });
      }
    });
    return out;
  }

  /* ------------------------------------------------------------ 组合枚举 */
  function enumerate(groups, k, lo, hi, req, comp) {
    var res = [], nodes = 0, NODE_LIMIT = 600000;
    var reqList = (req && req.length) ? req : null;
    var compKeys = null, compAllow = null;
    if (comp) {
      compKeys = Object.keys(comp);
      compAllow = {};
      compKeys.forEach(function (p) { compAllow[p] = 1; });
    }
    (function rec(idx, chosen, sp, p) {
      if (nodes++ > NODE_LIMIT) return;
      if (chosen.length === k) {
        if (sp < lo) return;
        if (reqList) {
          /* 双玩法搭配模式：每串必须同时包含指定玩法各至少一条腿 */
          var have = {};
          for (var q = 0; q < chosen.length; q++) have[chosen[q].leg.play] = 1;
          for (var r = 0; r < reqList.length; r++) if (!have[reqList[r]]) return;
        }
        if (compKeys) {
          /* 定构成模式：每串玩法条数必须精确等于 comp（如 让球 1 条 + 总进球 2 条），
             且不允许出现 comp 之外的玩法，避免「挂着搭配名头、结果却只含单一玩法」。 */
          var cnt = {};
          for (var s = 0; s < chosen.length; s++) {
            var pl = chosen[s].leg.play;
            if (!compAllow[pl]) return;
            cnt[pl] = (cnt[pl] || 0) + 1;
          }
          for (var t = 0; t < compKeys.length; t++) if ((cnt[compKeys[t]] || 0) !== comp[compKeys[t]]) return;
        }
        /* 每注统一表示为一个「腿」数组：一条腿 = 一场比赛 + 该场该玩法的结果集合。
           混合模式每场只取 1 条结果，故每条腿只含 1 个结果。 */
        res.push({
          legs: chosen.map(function (x) {
            return { g: x.g, play: x.leg.play, legs: [x.leg], sp: x.leg.sp, p: x.leg.p };
          }),
          sp: sp, p: p
        });
        return;
      }
      if (idx >= groups.length) return;
      if (groups.length - idx < k - chosen.length) return;
      if (sp > hi) return;                       // SP 只增不减，超上限直接剪枝
      var legs = groups[idx].legs;
      for (var j = 0; j < legs.length; j++) {
        chosen.push({ g: groups[idx], leg: legs[j] });
        rec(idx + 1, chosen, sp * legs[j].sp, p * legs[j].p);
        chosen.pop();
      }
      rec(idx + 1, chosen, sp, p);               // 跳过该场
    })(0, [], 1, 1);
    return res;
  }

  /* -------------------------------------------- 组合枚举（按场配腿）
     关数 = 场数 = 腿数。每一场的腿数（结果数）由「今日预测」决定：
       · 单玩法组合：该场取该玩法的全部结果（总进球 2 条 / 胜平负、让球 1 条）
       · 双玩法组合：主玩法固定占 1 场、只取概率最高的 1 条；
                     其余（关数-1）场归第二玩法，每场取该玩法的全部结果
     同一场的多个结果合并成「一条腿」（复式覆盖），腿赔率 = 腿内最高的 SP。
     于是 2 串 1 就是：总进球 2 条 + 总进球 2 条（2 腿）／
     胜平负 1 条 + 让球胜平负 1 条（2 腿）／胜平负 1 条 + 总进球 2 条（2 腿）。 */
  function choicesFor(g, cfg, mainUsed) {
    var out = [];
    function pack(play, takeAll, isMain) {
      var ls = g.legs.filter(function (l) { return l.play === play; });
      if (!ls.length) return;
      if (!takeAll) ls = ls.slice(0, 1);          // 主玩法只取概率最高的 1 条
      /* 腿赔率 = 腿内各结果 SP 的**最大值**（同一场同玩法多结果是「覆盖」关系，
         取最高的一档计价，不做相乘）；腿概率仍为各结果模型概率相乘。 */
      var sp = 0, p = 1;
      ls.forEach(function (l) { if (l.sp > sp) sp = l.sp; p *= l.p; });
      out.push({ play: play, legs: ls, sp: sp, p: p, mainUsed: isMain });
    }
    if (cfg.req && cfg.req.length > 1) {
      if (!mainUsed) pack(cfg.req[0], false, true);   // 主玩法最多占 1 场
      pack(cfg.req[1], true, false);                  // 其余场归第二玩法，取该场全部结果
    } else { pack(cfg.plays[0], true, true); }
    return out;
  }

  function enumerateByMatch(groups, k, lo, hi, cfg) {
    var res = [], nodes = 0, NODE_LIMIT = 600000;
    var multi = !!(cfg.req && cfg.req.length > 1);
    /* 关数 = 场数：used 统计已选场次（不是腿数，总进球一场 2 条） */
    (function rec(idx, picked, sp, p, mainUsed, used) {
      if (nodes++ > NODE_LIMIT) return;
      if (used === k) {
        if (multi && !mainUsed) return;           // 双玩法：主玩法必须出现在这一注里
        if (sp < lo) return;
        res.push({ legs: picked.slice(), sp: sp, p: p });
        return;
      }
      if (idx >= groups.length) return;
      if (groups.length - idx < k - used) return;
      if (sp > hi) return;                        // SP 只增不减，超上限直接剪枝
      var opts = choicesFor(groups[idx], cfg, mainUsed);
      for (var j = 0; j < opts.length; j++) {
        var o = opts[j], before = picked.length, sp2 = sp * o.sp, p2 = p * o.p;
        if (sp2 > hi) continue;
        /* 同一场比赛的多个结果合并为「一条腿」（复式覆盖）：腿赔率取腿内最高 SP */
        picked.push({ g: groups[idx], play: o.play, legs: o.legs, sp: o.sp, p: o.p });
        rec(idx + 1, picked, sp2, p2, mainUsed || o.mainUsed, used + 1);
        picked.length = before;
      }
      rec(idx + 1, picked, sp, p, mainUsed, used);      // 跳过该场
    })(0, [], 1, 1, false, 0);
    return res;
  }

  /* ------------------------------------------------------------ 主渲染 */
  var lastSim = null;   // 供 PNG 导出复用的最近一次计算结果

  function renderSim() {
    var host = U.byId('sim-body');
    if (!host) return;
    var cfg = comboOf();
    var groups = buildMatchLegs();
    var lo = Math.max(LO_MIN, Math.min(state.oddsMin, HI_CAP));
    var hi = Math.max(LO_MIN, Math.min(state.oddsMax, HI_CAP));
    if (hi < lo) hi = lo;

    var legTotal = groups.reduce(function (s, g) { return s + g.legs.length; }, 0);
    /* 关数 = 场数（2 串 1 就是 2 场）：按场配腿枚举，每场取该玩法今日预测的全部结果 */
    var k = state.k;
    var combos = groups.length >= k
      ? (cfg.mix ? enumerate(groups, k, lo, hi, null, null) : enumerateByMatch(groups, k, lo, hi, cfg))
      : [];
    /* 统一按 EV 从大到小排列 */
    combos.sort(function (a, b) { return evOf(b) - evOf(a); });
    var shown = combos.slice(0, 15);
    lastSim = {
      cfg: cfg, k: k, compText: compText(cfg, k),
      dayL: DAY_L[state.day] || state.day, groups: groups, legTotal: legTotal,
      combos: combos, shown: shown, lo: lo, hi: hi
    };

    host.innerHTML =
      head(cfg) +
      controls(cfg) +
      resultsCard(cfg, groups, legTotal, combos, shown, lo, hi, k) +
      mathCard();
    bind();
  }

  function evOf(c) { return c.p * c.sp - 1; }

  function rangeLabel(lo, hi) {
    if (hi >= HI_CAP) return lo <= LO_MIN ? '全部（3 倍以上）' : lo + ' 倍以上';
    return lo + '~' + hi + ' 倍';
  }

  function head(cfg) {
    return '<div class="pagehead"><div class="wrap">' +
      '<div class="crumb"><a href="index.html">今日预测</a> / 串关模拟</div>' +
      '<h1>串关模拟 · 按玩法与赔率区间组合</h1>' +
      '<div class="sub">以<b>「今日预测」页展示的推荐结果</b>为组合依据' +
      '（胜平负 / 让球各 1 条、总进球 / 半全场各 2 条、比分 3 条，与首页完全同口径），' +
      '提供 8 种搭配模式：胜平负 / 让球胜平负 / 总进球 单一玩法，' +
      '胜平负+让球 / 胜平负+总进球 / 让球+总进球 双玩法搭配，' +
      '以及玩法混合 / 按赔率混合。' +
      '<b>串关关数 2 串 1 / 3 串 1 / 4 串 1 = 2 / 3 / 4 场 = 2 / 3 / 4 腿</b>，每一场的腿数（结果数）按<b>今日预测的结果数</b>取：' +
      '胜平负、让球胜平负各 1 条，总进球 2 条。' +
      '同一场比赛在同一玩法下的多个结果<b>合并为一条腿</b>（复式覆盖，如「001 总进球 · 2球、3球」，腿赔率取腿内最高的 SP）。' +
      '于是 2 串 1 分别是：' +
      '总进球 2 条 + 总进球 2 条；胜平负 1 条 + 让球胜平负 1 条；胜平负 1 条 + 总进球 2 条；让球胜平负 1 条 + 总进球 2 条。' +
      '双玩法组合里主玩法固定占 1 场，其余场归另一玩法。' +
      '组合赔率区间 <b>3 倍以上自由预设（含 50 倍以上）</b>，结果统一按 EV 从高到低排列。' +
      '同一场比赛不可重复串联（竞彩规则），' +
      '联合概率为各腿概率相乘的独立性近似。<b>模拟结果为结构参考，不是盈利承诺。</b></div>' +
      '</div></div>';
  }

  function controls(cfg) {
    var days = [{ k: 'today', l: '今日' }, { k: 'tomorrow', l: '明日' }, { k: 'after', l: '后天' }];
    var presets = [[3, 5], [5, 8], [8, 15], [15, 25], [25, 50], [50, HI_CAP], [3, HI_CAP]];
    function presetLabel(pr) {
      if (pr[1] >= HI_CAP) return pr[0] <= LO_MIN ? '全部' : pr[0] + '+';
      return pr[0] + '~' + pr[1];
    }
    return '<div class="card"><div class="card-h"><h3>模拟参数</h3>' +
      '<span class="tiny muted">调整后立即重算；参数自动保存</span></div><div class="card-b">' +
      '<div class="toolbar" style="margin:0;border:0;padding:0;background:none;flex-wrap:wrap">' +
        '<div class="seg">' + days.map(function (d) {
          return '<button data-sday="' + d.k + '" class="' + (d.k === state.day ? 'on' : '') + '">' + d.l + '</button>';
        }).join('') + '</div>' +
        '<div class="seg">' + COMBOS.map(function (c) {
          return '<button data-scombo="' + c.k + '" class="' + (c.k === state.combo ? 'on' : '') + '">' + c.l + '</button>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="toolbar mt16" style="margin:0;border:0;padding:0;background:none;flex-wrap:wrap;align-items:flex-end">' +
        '<div class="field"><label>串关关数（场数）</label><div class="seg">' + [2, 3, 4].map(function (n) {
          return '<button data-sk="' + n + '" class="' + (n === state.k ? 'on' : '') + '">' + n + ' 串 1</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><label>组合赔率区间</label><div class="seg">' + presets.map(function (pr) {
          var on = state.oddsMin === pr[0] && state.oddsMax === pr[1];
          return '<button data-srange="' + pr[0] + '-' + pr[1] + '" class="' + (on ? 'on' : '') + '">' + presetLabel(pr) + '</button>';
        }).join('') + '</div></div>' +
        '<label class="small" style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
          '<input type="checkbox" id="sim-incl"' + (state.inclModel ? ' checked' : '') + '> 无推荐时用模型首选腿补充</label>' +
      '</div>' +
      '<div class="tiny muted mt16">当前模式：<b>' + U.esc(cfg.l) + '</b> — ' + U.esc(cfg.desc) + '。' +
      (compText(cfg, state.k)
        ? '当前 ' + state.k + ' 串 1（' + state.k + ' 场 = ' + state.k + ' 腿），每注构成：<b>' + U.esc(compText(cfg, state.k)) + '</b>。'
        : '每场从五种玩法里各挑 1 条腿，' + state.k + ' 串 1 = ' + state.k + ' 场 = ' + state.k + ' 腿。') +
      '同一场比赛在同一玩法下的多个结果<b>合并为一条腿</b>（复式覆盖，如「001 总进球 · 2球、3球」，腿赔率取腿内最高的 SP）。' +
      '腿池即「今日预测」的推荐结果；若某玩法暂无推荐，开启「模型首选补充」后按该玩法模型概率最高的方向生成结构参考腿。</div>' +
      '</div></div>';
  }

  /* 一条腿 = 一场比赛 + 该玩法的若干结果（同场多结果合并展示，如 001 总进球 · 2球、3球） */
  function legSels(entry) {
    return entry.legs.map(function (l) { return U.esc(l.sel); }).join('、');
  }
  /* 腿赔率文本：单结果腿直接给 SP；多结果腿取最高，并把候选档位一并列出 */
  function legOddsTxt(entry) {
    if (entry.legs.length <= 1) return U.odds(entry.sp);
    return U.odds(entry.sp) + '（取最高，' +
      entry.legs.map(function (l) { return U.odds(l.sp); }).join('/') + '）';
  }
  function legTxt(entry) {
    return '<b>' + U.esc(entry.g.no) + '</b> ' + U.esc(entry.g.name) +
      '<span class="tiny muted"> ' + U.esc(entry.play) + ' · <b style="color:var(--accent)">' +
      legSels(entry) + '</b>@' + legOddsTxt(entry) + '</span>';
  }

  function resultsCard(cfg, groups, legTotal, combos, shown, lo, hi, k) {
    var ctext = compText(cfg, k);
    var body;
    if (groups.length < k) {
      body = '<div class="card-b center muted">候选场次不足 ' + k + ' 场，无法生成 ' + k + ' 串 1（' + k + ' 场）组合。' +
        (ctext ? '本模式每注构成为 ' + U.esc(ctext) + '，需要至少 ' + k + ' 场同时具备对应玩法。' : '') +
        '可切换日期、模式，或开启「模型首选补充」。</div>';
    } else if (!combos.length) {
      body = '<div class="card-b center muted">在 ' + rangeLabel(lo, hi) + '区间内没有符合条件的组合。' +
        (ctext ? '本模式每注构成为 ' + U.esc(ctext) + '，' : '') +
        '可放宽赔率区间或调整关数。</div>';
    } else {
      body = '<div class="card-b flush"><div class="scrollx"><table class="tbl tbl-dense">' +
        '<thead><tr><th>#</th><th>串关明细（每注 ' + k + ' 腿 · 每腿 1 场）</th><th class="num">组合赔率</th>' +
        '<th class="num">联合概率</th><th class="num">公平赔率</th><th class="num">EV</th><th>依据</th></tr></thead><tbody>' +
        shown.map(function (c, i) {
          var allRec = c.legs.every(function (x) {
            return x.legs.every(function (l) { return l.src === '今日预测' || l.src === '演示推荐'; });
          });
          var ev = evOf(c);
          return '<tr>' +
            '<td><b>' + (i + 1) + '</b></td>' +
            '<td style="max-width:430px"><div>' + legTxt(c.legs[0]) + '</div>' +
              c.legs.slice(1).map(function (x) { return '<div style="margin-top:4px">' + legTxt(x) + '</div>'; }).join('') +
            '</td>' +
            '<td class="num"><b style="color:var(--accent)">' + U.odds(c.sp) + '</b></td>' +
            '<td class="num"><b>' + U.pct(c.p, 2) + '</b></td>' +
            '<td class="num muted">' + U.num(1 / c.p, 2) + '</td>' +
            '<td class="num ' + (ev >= 0 ? 'pos' : 'neg') + '"><b>' + U.signed(ev, 1) + '</b></td>' +
            '<td>' + (allRec ? '<span class="tag t-win">今日预测依据</span>' : '<span class="tag t-brand">含模型首选</span>') + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="card-b" style="border-top:1px solid var(--line)">' +
          '<div class="mini-grid">' +
            '<div><div class="mg-l">候选结果 / 覆盖场次</div><div class="mg-v">' + legTotal + ' 条 / ' + groups.length + ' 场</div></div>' +
            '<div><div class="mg-l">区间内组合数</div><div class="mg-v">' + combos.length.toLocaleString('en-US') + '</div></div>' +
            '<div><div class="mg-l">最高组合赔率</div><div class="mg-v">' + U.odds(combos[0].sp) + '</div></div>' +
            '<div><div class="mg-l">展示</div><div class="mg-v">前 ' + shown.length + ' 组（EV 降序）</div></div>' +
          '</div>' +
          '<p class="tiny muted mt8 mb0">同一场比赛在同一玩法下的多个结果<b>合并为一条腿</b>（复式覆盖，如「001 总进球 · 2球、3球」），腿赔率 = <b>腿内最高的 SP</b>（同一场的多个结果是覆盖关系，不做相乘）；' +
          '组合赔率 = 各腿赔率相乘；联合概率 = 各腿模型概率相乘（假设独立，同联赛/同时段开赛存在正相关，实际命中率通常低于估算）。' +
          'EV = 联合概率 × 组合赔率 − 1，为负代表该组合在当前水位下长期期望亏损。</p>' +
        '</div></div>';
    }
    return '<div class="card mt16"><div class="card-h"><h2>模拟结果 · ' + U.esc(cfg.l) + '</h2>' +
      '<span class="hint">' + k + ' 串 1 · ' + k + ' 腿（每腿 1 场 · 同场结果合并为一条腿）· 组合赔率 ' + rangeLabel(lo, hi) + ' · EV 降序' +
        (ctext ? ' · 每注 ' + U.esc(ctext) : '') + '</span>' +
      (combos.length ? '<button class="btn-ghost" data-simexport style="margin-left:12px">导出结果图片（PNG 长图）</button>' : '') +
      '</div>' + body + '</div>';
  }

  function mathCard() {
    return '<div class="card mt16"><div class="card-h"><h3>串关的数学事实</h3>' +
      '<span class="hint">模拟之前请先读这一段</span></div><div class="card-b"><div class="grid-2">' +
      '<div class="callout c-warn"><h4>水位被乘起来了</h4>' +
        '<p class="small mb0">单关官方水位约 13%，两串约 24%，三串约 34%——关数越多，' +
        '你需要跨过的"市场抽水"越深。这也是 EV 几乎总是随关数增加而迅速变差的原因。</p></div>' +
      '<div class="callout c-warn"><h4>概率被乘下去了</h4>' +
        '<p class="small mb0">两条 70% 的腿串起来只有 49%，三条只有 34%。' +
        '组合赔率变高的代价是命中率按同样倍数下降，两者相乘（EV）并不改善。</p></div>' +
      '<div class="callout c-gold"><h4>模型自己的纪律</h4>' +
        '<p class="small mb0">本站资金规则限定<b>串关仅 2 串 1</b>、且需低相关：同联赛、同时段开赛的场次倾向同涨同跌，' +
        '联合概率会被独立性假设高估。3 串 1 以上仅作结构演示。</p></div>' +
      '<div class="callout"><h4>模拟的用途</h4>' +
        '<p class="small mb0">本页回答的是"这些推荐方向按不同玩法与赔率区间组合后，概率/赔率/EV 长什么样"，' +
        '不是"哪一串会中"。请把它当作理解串关结构的计算器，而不是选号器。</p></div>' +
      '</div></div></div>';
  }

  /* ============================================================ PNG 导出 */
  /* 纯 Canvas 手绘长图：1080px 逻辑宽、2x 物理像素，两段式布局
     （先量高度再画），所有文本先测宽再截断，保证不重叠。 */

  var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
  var EX = {
    bg: '#f2f5f9', panel: '#ffffff', line: '#e2e8f0',
    brand: '#123a6b', brand2: '#1b5296', accent: '#c8952c',
    ink: '#16202e', ink2: '#47566b', ink3: '#7d8b9e',
    pos: '#cf2b2b', neg: '#0f8a5f', goldSoft: '#fdf3dc'
  };
  var DAY_L = { today: '今日', tomorrow: '明日', after: '后天' };

  function fmtOdds(x) { return U.odds(x); }
  function fmtPct(x) { return U.pct(x, 2); }
  function nowStr2() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fileName() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'jingxi-sim-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.png';
  }

  function rr(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    var r2 = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r2, y);
    ctx.arcTo(x + w, y, x + w, y + h, r2);
    ctx.arcTo(x + w, y + h, x, y + h, r2);
    ctx.arcTo(x, y + h, x, y, r2);
    ctx.arcTo(x, y, x + w, y, r2);
    ctx.closePath();
  }
  function fit(ctx, txt, maxW) {
    txt = String(txt);
    if (ctx.measureText(txt).width <= maxW) return txt;
    while (txt.length > 1 && ctx.measureText(txt + '…').width > maxW) txt = txt.slice(0, -1);
    return txt + '…';
  }

  function exportPNG() {
    var S = lastSim;
    if (!S || !S.shown || !S.shown.length) {
      window.alert('当前没有可导出的模拟结果：请先调整参数生成组合。');
      return;
    }
    try {
      var url = drawSimPNG(S);
      showExportModal(url);
    } catch (e) {
      window.alert('导出失败：' + (e && e.message ? e.message : '当前浏览器不支持 Canvas 绘制。'));
    }
  }

  function drawSimPNG(S) {
    var W = 1080, PAD = 48, GAP = 16;
    var measure = document.createElement('canvas').getContext('2d');
    function f(sz, wt) { measure.font = (wt || 400) + ' ' + sz + 'px ' + FONT; return measure; }

    /* ---------- 两段式：先算每张卡高度与总高 ---------- */
    var items = S.shown.map(function (c) {
      return {
        rank: 0,
        odds: c.sp, p: c.p, fair: 1 / c.p, ev: evOf(c),
        src: c.legs.every(function (x) {
          return x.legs.every(function (l) { return l.src === '今日预测' || l.src === '演示推荐'; });
        }) ? '今日预测依据' : '含模型首选',
        legs: c.legs.map(function (x) {
          return {
            no: x.g.no, name: x.g.name, play: x.play,
            sel: x.legs.map(function (l) { return l.sel; }).join('、'),
            sp: x.sp,
            spTxt: x.legs.length > 1
              ? fmtOdds(x.sp) + '（取最高，' + x.legs.map(function (l) { return fmtOdds(l.sp); }).join('/') + '）'
              : fmtOdds(x.sp)
          };
        })
      };
    });
    items.forEach(function (it, i) { it.rank = i + 1; });

    var CARD_X = PAD, CARD_W = W - PAD * 2, IN = 26;
    var LEG_H = 36, STATS_W = 218, RANK_W = 68;
    /* 场次号统一取全图最宽测量值，保证各行正文左对齐且不与腿号重叠 */
    var noW = 0;
    items.forEach(function (it) {
      it.legs.forEach(function (lg) {
        noW = Math.max(noW, f(14.5, 600).measureText(lg.no).width + 12);
      });
    });
    var legsMaxW = CARD_W - IN * 2 - RANK_W - STATS_W - 20;
    items.forEach(function (it) {
      it.legs.forEach(function (lg) {
        lg.line = fit(f(15, 400), lg.name + '   ' + lg.play + ' · ' + lg.sel + ' @' + lg.spTxt, legsMaxW - noW);
      });
      it.h = IN + Math.max(it.legs.length * LEG_H + 6, 156) + IN - 8;
    });

    var kpis = [
      { l: '候选结果 / 覆盖场次', v: S.legTotal + ' 条 / ' + S.groups.length + ' 场' },
      { l: '区间内组合数', v: S.combos.length.toLocaleString('en-US') },
      { l: '最高组合赔率', v: fmtOdds(S.combos[0].sp) },
      { l: '展示方案', v: '前 ' + items.length + ' 组' }
    ];
    var KPI_W = (CARD_W - GAP * 3) / 4, KPI_H = 92;
    var HEAD_H = 188, KPI_TOP = 30, FOOT_H = 96, SECT_T = 26;
    var totalH = HEAD_H + KPI_TOP + KPI_H + SECT_T + SECT_T +
      items.reduce(function (s, it) { return s + it.h + GAP; }, -GAP) +
      SECT_T + FOOT_H;

    /* ---------- 画布 ---------- */
    var SCALE = 2;
    var cv = document.createElement('canvas');
    cv.width = W * SCALE; cv.height = Math.ceil(totalH) * SCALE;
    var ctx = cv.getContext('2d');
    ctx.scale(SCALE, SCALE);
    function sf(sz, wt) { ctx.font = (wt || 400) + ' ' + sz + 'px ' + FONT; }
    function ink(c) { ctx.fillStyle = c; }

    /* 背景 */
    ink(EX.bg); ctx.fillRect(0, 0, W, totalH);

    /* ---------- 头部（品牌渐变） ---------- */
    var grad = ctx.createLinearGradient(0, 0, W, HEAD_H);
    grad.addColorStop(0, EX.brand); grad.addColorStop(1, EX.brand2);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, HEAD_H);
    ink('rgba(255,255,255,.55)'); sf(15, 500);
    ctx.fillText('竞析 JINGXI · 串关模拟', PAD, 44);
    ink('#ffffff'); sf(38, 700);
    ctx.fillText(fit(ctx, S.cfg.l + ' · ' + S.k + ' 串 1（' + S.k + ' 腿 · 每腿 1 场）', W - PAD * 2 - 220), PAD, 96);
    sf(26, 700); ink(EX.accent);
    var tagTxt = '组合赔率 ' + rangeLabel(S.lo, S.hi);
    ctx.fillText(tagTxt, W - PAD - ctx.measureText(tagTxt).width, 60);
    ink('rgba(255,255,255,.78)'); sf(15, 400);
    ctx.fillText('日期：' + (S.dayL || state.day) + '　·　排序：EV 降序' +
      (S.compText ? '　·　每注 ' + S.compText : '') +
      '　·　生成时间：' + nowStr2(), PAD, 138);
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, 158); ctx.lineTo(W - PAD, 158); ctx.stroke();
    ink('rgba(255,255,255,.6)'); sf(12.5, 400);
    ctx.fillText('同一场同玩法的多个结果合并为一条腿（复式覆盖，腿赔率取腿内最高 SP）；组合赔率 = 各腿赔率相乘；联合概率 = 各腿概率相乘（独立性近似；半全场为官方赔率隐含概率口径）；EV = 联合概率 × 组合赔率 − 1。模拟为结构参考，不构成任何盈利承诺。', PAD, 180);

    /* ---------- KPI 行 ---------- */
    var y = HEAD_H + KPI_TOP;
    kpis.forEach(function (k, i) {
      var kx = PAD + i * (KPI_W + GAP);
      ink(EX.panel); rr(ctx, kx, y, KPI_W, KPI_H, 14); ctx.fill();
      ctx.strokeStyle = EX.line; ctx.stroke();
      ink(EX.ink3); sf(13, 400);
      ctx.fillText(fit(ctx, k.l, KPI_W - 28), kx + 14, y + 32);
      ink(EX.ink); sf(26, 700);
      ctx.fillText(fit(ctx, k.v, KPI_W - 28), kx + 14, y + 68);
    });
    y += KPI_H + SECT_T;

    /* ---------- 方案卡片 ---------- */
    items.forEach(function (it) {
      ink(EX.panel); rr(ctx, CARD_X, y, CARD_W, it.h, 16); ctx.fill();
      ctx.strokeStyle = it.rank === 1 ? EX.accent : EX.line; ctx.lineWidth = it.rank === 1 ? 1.6 : 1; ctx.stroke();
      ctx.lineWidth = 1;

      /* 名次徽章 */
      var bc = it.rank === 1 ? EX.accent : it.rank === 2 ? EX.brand2 : it.rank === 3 ? '#7d8b9e' : '#dfe6ef';
      ink(bc); ctx.beginPath(); ctx.arc(CARD_X + IN + 22, y + IN + 16, 21, 0, Math.PI * 2); ctx.fill();
      ink(it.rank <= 3 ? '#ffffff' : EX.ink2); sf(16, 700);
      var rs = String(it.rank);
      ctx.fillText(rs, CARD_X + IN + 22 - ctx.measureText(rs).width / 2, y + IN + 22);

      /* 右侧统计列 */
      var sx = CARD_X + CARD_W - IN, sw = STATS_W;
      var ty = y + IN + 8;
      ink(it.src === '今日预测依据' ? EX.neg : EX.brand); sf(11.5, 600);
      var tag = '· ' + it.src;
      ctx.fillText(tag, sx - ctx.measureText(tag).width, ty); ty += 34;
      ink(EX.brand); sf(34, 800);
      var od = fmtOdds(it.odds);
      ctx.fillText(od, sx - ctx.measureText(od).width, ty + 14); ty += 44;
      sf(14, 400); ink(EX.ink2);
      var row2 = '联合概率 ' + fmtPct(it.p);
      ctx.fillText(row2, sx - ctx.measureText(row2).width, ty); ty += 24;
      var row3 = '公平赔率 ' + (Math.round(it.fair * 100) / 100).toFixed(2);
      ctx.fillText(row3, sx - ctx.measureText(row3).width, ty); ty += 24;
      sf(15, 700); ink(it.ev >= 0 ? EX.pos : EX.neg);
      var row4 = 'EV ' + (it.ev >= 0 ? '+' : '') + (it.ev * 100).toFixed(1) + '%';
      ctx.fillText(row4, sx - ctx.measureText(row4).width, ty);

      /* 左侧腿清单（每腿一行，先截断保不重叠） */
      var lx = CARD_X + IN + RANK_W;
      var ly = y + IN + 6;
      it.legs.forEach(function (lg, li) {
        sf(14.5, 600); ink(EX.ink);
        ctx.fillText(lg.no, lx, ly + li * LEG_H + 14);
        sf(14.5, 400); ink(EX.ink2);
        ctx.fillText(lg.line, lx + noW, ly + li * LEG_H + 14);
        if (li < it.legs.length - 1) {
          ctx.strokeStyle = '#eef2f7';
          ctx.beginPath(); ctx.moveTo(lx, ly + li * LEG_H + 26); ctx.lineTo(lx + legsMaxW, ly + li * LEG_H + 26); ctx.stroke();
        }
      });

      y += it.h + GAP;
    });
    y += SECT_T - GAP;

    /* ---------- 页脚 ---------- */
    var ds = (global.JX.DS && global.JX.DS.state) ? global.JX.DS.state() : {};
    ink(EX.ink3); sf(12.5, 400);
    ctx.fillText('数据：中国体彩网官方接口 · 数据时间 ' + (ds.remoteUpdate || ds.updatedAt || '—') + ' · 模式 ' + (ds.mode || '—'), PAD, y + 24);
    ctx.fillText('水位随关数相乘、概率随关数相除：串关越多，期望越差。本图由模型自动计算生成，仅供结构参考，请理性购彩。', PAD, y + 48);

    return cv.toDataURL('image/png');
  }

  function showExportModal(url) {
    var old = document.getElementById('sim-export-mask');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var mask = document.createElement('div');
    mask.id = 'sim-export-mask';
    var name = fileName();
    mask.innerHTML =
      '<div class="sexp-box">' +
        '<div class="sexp-bar">' +
          '<div class="sexp-t"><b>结果长图已生成</b><span>手机长按图片即可保存 · 电脑可点「下载 PNG」或右键另存为</span></div>' +
          '<div class="sexp-acts"><a class="btn-brand" id="sexp-dl" href="' + url + '" download="' + name + '">下载 PNG</a>' +
          '<button class="btn-ghost" id="sexp-close">关闭</button></div>' +
        '</div>' +
        '<div class="sexp-scroll"><img class="sexp-img" alt="串关模拟结果长图"></div>' +
      '</div>';
    document.body.appendChild(mask);
    mask.querySelector('.sexp-img').src = url;
    function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    mask.querySelector('#sexp-close').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    var dl = mask.querySelector('#sexp-dl');
    dl.addEventListener('click', function (e) {
      /* 微信/部分浏览器不支持 download 属性：给出提示，保留长按保存路径 */
      var ua = navigator.userAgent || '';
      if (/MicroMessenger/i.test(ua)) {
        e.preventDefault();
        window.alert('在微信内无法直接下载：请长按上方图片，选择「保存图片」到手机相册。');
      }
    });
  }

  /* ------------------------------------------------------------ 事件绑定 */
  function bind() {
    U.on(document, 'click', '[data-sday]', function (e, t) {
      state.day = t.dataset.sday;
      U.$$('[data-sday]').forEach(function (b) { b.classList.toggle('on', b === t); });
      save(); renderSim();
    });
    U.on(document, 'click', '[data-scombo]', function (e, t) {
      state.combo = t.dataset.scombo;
      U.$$('[data-scombo]').forEach(function (b) { b.classList.toggle('on', b === t); });
      syncK();                       // 双玩法搭配模式：关数回到「今日预测结果数之和」那一档
      save(); renderSim();
    });
    U.on(document, 'click', '[data-sk]', function (e, t) {
      state.k = +t.dataset.sk;
      U.$$('[data-sk]').forEach(function (b) { b.classList.toggle('on', b === t); });
      save(); renderSim();
    });
    U.on(document, 'click', '[data-srange]', function (e, t) {
      var parts = t.dataset.srange.split('-');
      state.oddsMin = +parts[0]; state.oddsMax = +parts[1];
      save(); renderSim();
    });
    var incl = U.byId('sim-incl');
    if (incl) incl.addEventListener('change', function () { state.inclModel = this.checked; save(); renderSim(); });
    U.on(document, 'click', '[data-simexport]', function () { exportPNG(); });
  }

  JX.renderSim = renderSim;
  JX.simExportPNG = exportPNG;
  /* 供测试/外部调用：直接返回当前结果的 PNG dataURL（无结果时返回 null） */
  JX.simExportDataURL = function () { return lastSim ? drawSimPNG(lastSim) : null; };
})(window);

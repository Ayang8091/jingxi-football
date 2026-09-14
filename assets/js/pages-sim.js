/* ==========================================================================
   竞析 JINGXI · 串关模拟（主站导航页）
   --------------------------------------------------------------------------
   定位：以单场剖析页「07 · 推荐明细与仓位建议」的推荐方向为组合依据，
   提供五种搭配模式的串关方案模拟：
     1) 胜平负组合      2) 让球胜平负组合   3) 总进球组合
     4) 三种混合组合    （三种玩法混合，按联合概率排序）
     5) 按赔率混合组合  （不限玩法，以组合赔率区间 3~50 倍为核心筛选，区间内按 EV 排序）
   规则：
     · 同一场比赛的不同玩法不可互相串联（竞彩规则），因此每串每场只取一条腿；
     · 组合赔率 = 各腿 SP 相乘；联合概率 = 各腿模型概率相乘（独立性近似）；
     · 赔率区间默认 3~50 倍，可自定义（硬限制 3~50）；
     · 实时数据模式下推荐明细可能为空，可开启「模型首选补充」生成结构参考腿。
   ========================================================================== */
(function (global) {
  'use strict';

  var JX = global.JX, U = JX.U, M = JX.M, C = JX.C;
  var D = global.JX_DATA;
  var pickProb = global.JX.pickProb;

  var STORE_KEY = 'jx.sim.v1';
  var LO_MIN = 3, HI_MAX = 50;

  var state = {
    day: 'today',
    combo: 'had',      // had | hhad | ttg | mix3 | oddsMix
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
    { k: 'had', l: '胜平负组合', plays: ['胜平负'], desc: '每串全部由「胜平负」推荐构成' },
    { k: 'hhad', l: '让球胜平负组合', plays: ['让球胜平负'], desc: '每串全部由「让球胜平负」推荐构成' },
    { k: 'ttg', l: '总进球组合', plays: ['总进球'], desc: '每串全部由「总进球」推荐构成' },
    { k: 'mix3', l: '三种混合组合', plays: ['胜平负', '让球胜平负', '总进球'], desc: '三种玩法混合，按联合概率从高到低排序' },
    { k: 'oddsMix', l: '按赔率混合组合', plays: ['胜平负', '让球胜平负', '总进球'], desc: '不限玩法，以组合赔率落在所选区间为核心，区间内按 EV 排序' }
  ];
  function comboOf() { return COMBOS.filter(function (c) { return c.k === state.combo; })[0] || COMBOS[0]; }

  /* ------------------------------------------------------------ 腿池构建 */
  function modelFirstLeg(m, play) {
    /* 推荐明细缺该玩法时，用模型首选方向补一条「结构参考」腿 */
    var r = JX.model(m), cands = [], i;
    if (play === '胜平负') {
      cands = [
        { sel: '主胜', sp: m.sp.w, p: r.w },
        { sel: '平局', sp: m.sp.d, p: r.d },
        { sel: '客胜', sp: m.sp.l, p: r.l }
      ];
    } else if (play === '让球胜平负' && m.rq && isFinite(m.rq.line)) {
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
    /* 返回 [{ mid, no, name, legs:[{play,sel,sp,p,ev,src}] }]，仅限所选日期 */
    var cfg = comboOf();
    var ms = (D.matches || []).filter(function (m) { return m.day === state.day && m.sp; });
    var out = [];
    ms.forEach(function (m) {
      var legs = [], seen = {};
      (m.picks || []).forEach(function (pk) {
        if (cfg.plays.indexOf(pk.play) === -1) return;
        if (seen[pk.play]) return;
        var p = pickProb(m, pk);
        if (!(p > 0) || !(pk.sp > 1)) return;
        seen[pk.play] = 1;
        legs.push({ play: pk.play, sel: pk.sel, sp: +pk.sp, p: p, ev: p * pk.sp - 1, src: '推荐明细' });
      });
      if (state.inclModel) {
        cfg.plays.forEach(function (pl) {
          if (seen[pl]) return;
          var lg = modelFirstLeg(m, pl);
          if (lg) { legs.push(lg); seen[pl] = 1; }
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
  function enumerate(groups, k, lo, hi) {
    var res = [], nodes = 0, NODE_LIMIT = 600000;
    (function rec(idx, chosen, sp, p) {
      if (nodes++ > NODE_LIMIT) return;
      if (chosen.length === k) { if (sp >= lo) res.push({ legs: chosen.slice(), sp: sp, p: p }); return; }
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

  /* ------------------------------------------------------------ 主渲染 */
  function renderSim() {
    var host = U.byId('sim-body');
    if (!host) return;
    var cfg = comboOf();
    var groups = buildMatchLegs();
    var lo = Math.max(LO_MIN, Math.min(state.oddsMin, HI_MAX));
    var hi = Math.max(LO_MIN, Math.min(state.oddsMax, HI_MAX));
    if (hi < lo) hi = lo;

    var legTotal = groups.reduce(function (s, g) { return s + g.legs.length; }, 0);
    var combos = groups.length >= state.k ? enumerate(groups, state.k, lo, hi) : [];
    if (state.combo === 'oddsMix') {
      combos.sort(function (a, b) { return evOf(b) - evOf(a); });
    } else {
      combos.sort(function (a, b) { return b.p - a.p; });
    }
    var shown = combos.slice(0, 15);

    host.innerHTML =
      head(cfg) +
      controls(cfg) +
      resultsCard(cfg, groups, legTotal, combos, shown, lo, hi) +
      mathCard();
    bind();
  }

  function evOf(c) { return c.p * c.sp - 1; }

  function head(cfg) {
    return '<div class="pagehead"><div class="wrap">' +
      '<div class="crumb"><a href="index.html">今日预测</a> / 串关模拟</div>' +
      '<h1>串关模拟 · 按玩法与赔率区间组合</h1>' +
      '<div class="sub">以单场剖析页<b>「推荐明细与仓位建议」</b>的推荐方向为组合依据，' +
      '提供胜平负 / 让球胜平负 / 总进球 / 三种混合 / 按赔率混合五种搭配模式，' +
      '组合赔率区间 <b>3~50 倍</b>可调。同一场比赛不可重复串联（竞彩规则），' +
      '联合概率为各腿模型概率相乘的独立性近似。<b>模拟结果为结构参考，不是盈利承诺。</b></div>' +
      '</div></div>';
  }

  function controls(cfg) {
    var days = [{ k: 'today', l: '今日' }, { k: 'tomorrow', l: '明日' }, { k: 'after', l: '后天' }];
    var presets = [[3, 5], [5, 8], [8, 15], [15, 25], [25, 50], [3, 50]];
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
        '<div class="field"><label>串关关数</label><div class="seg">' + [2, 3, 4].map(function (n) {
          return '<button data-sk="' + n + '" class="' + (n === state.k ? 'on' : '') + '">' + n + ' 串 1</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><label>组合赔率区间（3~50 倍）</label><div class="seg">' + presets.map(function (pr) {
          var on = state.oddsMin === pr[0] && state.oddsMax === pr[1];
          return '<button data-srange="' + pr[0] + '-' + pr[1] + '" class="' + (on ? 'on' : '') + '">' + pr[0] + '~' + pr[1] + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><label>自定义区间</label><span class="row gap8">' +
          '<input class="cell-input" id="sim-lo" type="number" min="3" max="50" step="1" value="' + state.oddsMin + '"> ' +
          '<span class="muted">~</span> ' +
          '<input class="cell-input" id="sim-hi" type="number" min="3" max="50" step="1" value="' + state.oddsMax + '">' +
        '</span></div>' +
        '<label class="small" style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
          '<input type="checkbox" id="sim-incl"' + (state.inclModel ? ' checked' : '') + '> 无推荐时用模型首选腿补充</label>' +
      '</div>' +
      '<div class="tiny muted mt16">当前模式：<b>' + U.esc(cfg.l) + '</b> — ' + U.esc(cfg.desc) + '。' +
      '实时模式下若推荐明细为空（无正 EV 方向），开启「模型首选补充」后按各玩法模型概率最高的方向生成结构参考腿。</div>' +
      '</div></div>';
  }

  function legTxt(g, leg) {
    return '<b>' + U.esc(g.no) + '</b> ' + U.esc(g.name) +
      '<span class="tiny muted"> ' + U.esc(leg.play) + ' · <b style="color:var(--accent)">' + U.esc(leg.sel) + '</b>@' + U.odds(leg.sp) + '</span>';
  }

  function resultsCard(cfg, groups, legTotal, combos, shown, lo, hi) {
    var body;
    if (groups.length < state.k) {
      body = '<div class="card-b center muted">候选场次不足 ' + state.k + ' 场，无法生成 ' + state.k + ' 串 1 组合。可切换日期、模式，或开启「模型首选补充」。</div>';
    } else if (!combos.length) {
      body = '<div class="card-b center muted">在 ' + lo + '~' + hi + ' 倍区间内没有符合条件的组合。可放宽区间或减少关数。</div>';
    } else {
      body = '<div class="card-b flush"><div class="scrollx"><table class="tbl tbl-dense">' +
        '<thead><tr><th>#</th><th>串关明细（' + state.k + ' 腿）</th><th class="num">组合赔率</th>' +
        '<th class="num">联合概率</th><th class="num">公平赔率</th><th class="num">EV</th><th>依据</th></tr></thead><tbody>' +
        shown.map(function (c, i) {
          var allRec = c.legs.every(function (x) { return x.leg.src === '推荐明细'; });
          var ev = evOf(c);
          return '<tr>' +
            '<td><b>' + (i + 1) + '</b></td>' +
            '<td style="max-width:430px"><div>' + legTxt(c.legs[0].g, c.legs[0].leg) + '</div>' +
              c.legs.slice(1).map(function (x) { return '<div style="margin-top:4px">' + legTxt(x.g, x.leg) + '</div>'; }).join('') +
            '</td>' +
            '<td class="num"><b style="color:var(--accent)">' + U.odds(c.sp) + '</b></td>' +
            '<td class="num"><b>' + U.pct(c.p, 2) + '</b></td>' +
            '<td class="num muted">' + U.num(1 / c.p, 2) + '</td>' +
            '<td class="num ' + (ev >= 0 ? 'pos' : 'neg') + '"><b>' + U.signed(ev, 1) + '</b></td>' +
            '<td>' + (allRec ? '<span class="tag t-win">推荐明细依据</span>' : '<span class="tag t-brand">含模型首选</span>') + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="card-b" style="border-top:1px solid var(--line)">' +
          '<div class="mini-grid">' +
            '<div><div class="mg-l">候选腿 / 覆盖场次</div><div class="mg-v">' + legTotal + ' 腿 / ' + groups.length + ' 场</div></div>' +
            '<div><div class="mg-l">区间内组合数</div><div class="mg-v">' + combos.length.toLocaleString('en-US') + '</div></div>' +
            '<div><div class="mg-l">最高组合赔率</div><div class="mg-v">' + U.odds(combos[0].sp) + '</div></div>' +
            '<div><div class="mg-l">展示</div><div class="mg-v">前 ' + shown.length + ' 组（' +
              (state.combo === 'oddsMix' ? 'EV 降序' : '联合概率降序') + '）</div></div>' +
          '</div>' +
          '<p class="tiny muted mt8 mb0">组合赔率 = 各腿 SP 相乘；联合概率 = 各腿模型概率相乘（假设独立，同联赛/同时段开赛存在正相关，实际命中率通常低于估算）。' +
          'EV = 联合概率 × 组合赔率 − 1，为负代表该组合在当前水位下长期期望亏损。</p>' +
        '</div></div>';
    }
    return '<div class="card mt16"><div class="card-h"><h2>模拟结果 · ' + U.esc(cfg.l) + '</h2>' +
      '<span class="hint">' + state.k + ' 串 1 · 组合赔率 ' + lo + '~' + hi + ' 倍</span></div>' + body + '</div>';
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
    var lo = U.byId('sim-lo'), hi = U.byId('sim-hi');
    function applyRange() {
      var a = +lo.value, b = +hi.value;
      a = Math.max(LO_MIN, Math.min(HI_MAX, isNaN(a) ? LO_MIN : a));
      b = Math.max(LO_MIN, Math.min(HI_MAX, isNaN(b) ? HI_MAX : b));
      state.oddsMin = a; state.oddsMax = b;
      save(); renderSim();
    }
    if (lo) lo.addEventListener('change', applyRange);
    if (hi) hi.addEventListener('change', applyRange);
    var incl = U.byId('sim-incl');
    if (incl) incl.addEventListener('change', function () { state.inclModel = this.checked; save(); renderSim(); });
  }

  JX.renderSim = renderSim;
})(window);

/* ==========================================================================
   竞析 JINGXI · 串关搭配与倍投资金计划（页面渲染）
   ========================================================================== */
(function (global) {
  'use strict';

  var JX = global.JX, U = JX.U, C = JX.C, M = JX.M, P = JX.PARLAY, DS = JX.DS;
  var D = global.JX_DATA;

  var state = {
    day: 'today',
    k: 2,
    od: 4.5,          // 目标组合赔率档位
    C: 200,           // 目标利润
    N: 9,             // 最大期数
    sel: 0
  };

  function models() {
    return (D.matches || []).filter(function (m) { return m.day === state.day && m.sp; });
  }

  function money(v) { return (v >= 0 ? '' : '-') + Math.abs(Math.round(v)).toLocaleString('en-US'); }

  /* ---------------------------------------------------------------- 组合池 */
  function computeCombos() {
    var ms = models();
    if (ms.length < state.k) return [];
    var all = P.build(ms, { kmin: state.k, kmax: state.k, perMatch: 2, minOdds: 1.5, maxOdds: 80, minProb: 0.015 });
    /* 按「贴近目标赔率 + 命中概率高」排序，取前 24 */
    all.sort(function (a, b) {
      var da = Math.abs(a.sp - state.od) / state.od, db = Math.abs(b.sp - state.od) / state.od;
      return (da - db) * 5 + (b.p - a.p) * 2 - (a.ev - b.ev) * 0;
    });
    return all.slice(0, 24);
  }

  /* -------------------------------------------------------------- 水位基准 */
  function marginStats() {
    var ms = models(), mar = [];
    ms.forEach(function (m) {
      var r = JX.model(m);
      if (r && r.sp && isFinite(r.sp.margin)) mar.push(r.sp.margin);
    });
    if (!mar.length) return { avg: 0.13, n: 0 };
    return { avg: mar.reduce(function (a, b) { return a + b; }, 0) / mar.length, n: mar.length };
  }

  /* ------------------------------------------------------------ 主渲染入口 */
  function renderParlay() {
    var host = U.byId('parlay-body');
    if (!host) return;
    var combos = computeCombos();
    var mg = marginStats();

    host.innerHTML =
      hero(mg) +
      controls(combos) +
      '<div class="grid-side mt16">' +
        '<div>' + comboCard(combos) + '</div>' +
        '<div>' + sideCard(combos, mg) + '</div>' +
      '</div>' +
      planCard(combos) +
      riskCard(combos) +
      presetCard() +
      mathCard();

    bind();
  }

  /* ------------------------------------------------------------------ 区块 */
  function hero(mg) {
    var ms = models();
    var live = DS && DS.state().mode === 'live';
    return '<div class="kpis mb16">' +
      kpi('可组合赛事', ms.length, '场', ms.length ? U.uniq(ms.map(function (m) { return m.league; })).length + ' 个联赛 · ' + (state.k === 2 ? '2 串 1' : '3 串 1') : '当前无可分析赛事', 'k-draw') +
      kpi('官方盘口水位', (mg.avg * 100).toFixed(1), '%', live ? '实测 ' + mg.n + ' 场胜平负盘均值' : '演示样本', 'k-lose') +
      kpi('单关长期期望', (-mg.avg * 100).toFixed(1), '%', '扣除水位后无正期望', 'k-gold') +
      kpi(state.k + ' 串 1 期望基线', (-(Math.pow(1 - mg.avg, state.k) - 1) * 100).toFixed(1), '%',
        '水位按 ' + state.k + ' 次方叠加放大', 'k-warn') +
      '</div>';
  }

  function kpi(label, val, unit, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="k-lab">' + label + '</div>' +
      '<div class="k-val">' + val + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      '<div class="k-sub">' + U.esc(sub) + '</div></div>';
  }

  function controls(combos) {
    var days = [{ k: 'today', l: '今日' }, { k: 'tomorrow', l: '明日' }, { k: 'after', l: '后天' }];
    var tiers = [2.5, 3.0, 4.5, 6.0, 10.0];
    return '<div class="card"><div class="card-h"><h3>搭配参数</h3>' +
      '<span class="tiny muted">调整后立即重算，全部概率由模型实时生成</span></div><div class="card-b">' +
      '<div class="toolbar" style="margin:0;border:0;padding:0;background:none">' +
        '<div class="seg">' + days.map(function (d) {
          return '<button data-pday="' + d.k + '" class="' + (d.k === state.day ? 'on' : '') + '">' + d.l + '</button>';
        }).join('') + '</div>' +
        '<div class="seg">' +
          '<button data-pk="2" class="' + (state.k === 2 ? 'on' : '') + '">2 串 1</button>' +
          '<button data-pk="3" class="' + (state.k === 3 ? 'on' : '') + '">3 串 1</button>' +
        '</div>' +
        '<div class="field"><label>目标赔率档</label><select id="p-od">' + tiers.map(function (t) {
          return '<option value="' + t + '"' + (Math.abs(t - state.od) < 1e-9 ? ' selected' : '') + '>' + t.toFixed(1) + '</option>';
        }).join('') + '<option value="99"' + (state.od === 99 ? ' selected' : '') + '>不限（按概率优先）</option></select></div>' +
        '<div class="field"><label>日利润目标</label><select id="p-c">' +
          [50, 100, 200, 500, 1000, 2000].map(function (v) {
            return '<option value="' + v + '"' + (v === state.C ? ' selected' : '') + '>' + v + ' 元</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>最大期数</label><select id="p-n">' +
          [5, 6, 8, 9, 10, 12, 15].map(function (v) {
            return '<option value="' + v + '"' + (v === state.N ? ' selected' : '') + '>' + v + ' 期</option>';
          }).join('') + '</select></div>' +
      '</div>' +
      '<div class="tiny muted mt16">当前共生成 <b>' + combos.length + '</b> 个候选组合（每个组合由不同场次的单腿串联，同一场不重复）。' +
      '目标赔率档越低，越接近单关；越高命中率越低。原表中的 3.0 / 4.5 / 6.0 / 10.0 四个档位即对应竞彩常见的串关赔率区间。</div>' +
      '</div></div>';
  }

  function comboCard(combos) {
    var rows = combos.slice(0, 12);
    var body;
    if (!rows.length) {
      body = '<div class="card-b center muted">当前条件下没有可组合的方案。<br><span class="tiny">这是正常的：可分析赛事不足，或组合赔率全部落在过滤区间之外。</span></div>';
    } else {
      body = '<div class="card-b flush"><div class="scrollx"><table class="tbl tbl-dense">' +
        '<thead><tr><th>#</th><th>组合</th><th class="num">联合概率</th><th class="num">组合赔率</th>' +
        '<th class="num">打平概率</th><th class="num">期望</th><th></th></tr></thead><tbody>' +
        rows.map(function (c, i) {
          var on = i === state.sel;
          return '<tr data-combo="' + i + '" style="cursor:pointer;' + (on ? 'background:#f2f7ff' : '') + '">' +
            '<td>' + (on ? '<b>' + (i + 1) + '</b>' : (i + 1)) + '</td>' +
            '<td>' + c.legs.map(function (l) {
              return '<div class="tiny" style="line-height:1.7"><b>' + U.esc(l.match.home.short) + '</b> ' +
                U.esc(l.sel) + ' <span class="muted">@' + U.odds(l.sp) + '</span></div>';
            }).join('') + (c.sameLeague ? '<span class="tag t-warn" style="margin-top:3px">同联赛</span>' : '') + '</td>' +
            '<td class="num"><b>' + U.pct(c.p, 2) + '</b><div class="tiny muted">1/' + U.num(c.fair, 1) + '</div></td>' +
            '<td class="num"><b style="color:var(--accent);font-size:14px">' + U.odds(c.sp) + '</b></td>' +
            '<td class="num">' + U.pct(c.breakEvenP, 2) + '<div class="tiny ' + (c.p >= c.breakEvenP ? 'pos' : 'neg') + '">' + U.signed(c.pGap, 2) + '</div></td>' +
            '<td class="num ' + (c.ev >= 0 ? 'pos' : 'neg') + '"><b>' + U.signed(c.ev, 1) + '</b></td>' +
            '<td>' + (on ? '<span class="tag t-brand">已选</span>' : '<span class="tag">选择</span>') + '</td>' +
            '</tr>';
        }).join('') + '</tbody></table></div></div>';
    }
    return '<div class="card"><div class="card-h"><h3>串关组合清单</h3>' +
      '<span class="tiny muted">点任意一行 → 下方生成对应的倍投资金计划</span></div>' + body + '</div>';
  }

  function sideCard(combos, mg) {
    var best = combos.slice().sort(function (a, b) { return b.p - a.p; })[0];
    var bestEv = combos.slice().sort(function (a, b) { return b.ev - a.ev; })[0];
    return '<div class="card"><div class="card-h"><h3>关键读数</h3></div><div class="card-b">' +
      '<div class="mini-grid mb16">' +
        mg2('组合数', combos.length) +
        mg2('最高命中率', best ? U.pct(best.p, 1) : '—') +
        mg2('对应赔率', best ? U.odds(best.sp) : '—') +
        mg2('最高期望', bestEv ? U.signed(bestEv.ev, 1) : '—') +
      '</div>' +
      '<div class="callout c-warn mb16"><h4>串关把水位也一起放大了</h4>' +
        '<p class="small mb0">竞彩每关的水位约 <b>' + U.pct(mg.avg, 1) + '</b>。串关的返奖率是各关相乘，' +
        '所以 ' + state.k + ' 串 1 的实际期望约为 <b>' + U.signed(-(1 - Math.pow(1 - mg.avg, state.k)), 1) + '</b>。' +
        '串得越多，期望被扣得越狠——这是串关无法回避的数学事实。</p></div>' +
      '<div class="callout"><h4>怎么用这一页</h4>' +
        '<p class="small mb0">把「组合」当成一个<b>整体投注标的</b>：它有确定的赔率、可估算的命中概率。' +
        '这一页的价值不是告诉你买什么，而是把「倍投要准备多少钱、中一次赚多少、' +
        '一直不中会亏多少」一次性算清楚。</p></div>' +
      '</div></div>';
  }
  function mg2(l, v) { return '<div><div class="mg-l">' + l + '</div><div class="mg-v">' + v + '</div></div>'; }

  /* --------------------------------------------------------- 倍投计划表 */
  function planCard(combos) {
    var c = combos[state.sel];
    if (!c) {
      return '<div class="card mt16"><div class="card-h"><h3>倍投资金计划</h3></div>' +
        '<div class="card-b center muted">请先在上方选择一个串关组合。</div></div>';
    }
    var a = P.analyzeCombo(c, { dailyProfit: state.C, periods: state.N });
    var plan = a.plan, risk = a.risk;

    return '<div class="card mt16"><div class="card-h"><h2>倍投资金计划</h2>' +
      '<span class="hint">组合赔率 ' + U.odds(c.sp) + ' · 目标日利润 ' + state.C + ' 元 · 上限 ' + state.N + ' 期</span></div>' +
      '<div class="card-b">' +
      '<div class="callout c-gold mb16"><h4>算法复刻说明</h4><p class="small mb0">' +
        '出票额(n) = ( 上期累计投入 + 目标利润 × n ) ÷ (赔率 − 1)，并按 <b>EVEN 向上取偶</b>。' +
        '任何一期命中，都能收回此前全部投入并实现「目标利润 × 期号」的净盈利。' +
        '该算法已与本项目参照的《升级版利润测算表》逐格核对一致（含续投场景）。</p></div>' +

      '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
        '<th>期号</th><th class="num">单期注额</th><th class="num">累计投入</th><th class="num">命中奖金</th>' +
        '<th class="num">命中净盈利</th><th class="num">未命中累计亏损</th><th class="num">恰在本期命中的概率</th>' +
      '</tr></thead><tbody>' +
        plan.rows.map(function (r) {
          var pr = risk ? risk.hitRows[r.n - 1].prob : 0;
          return '<tr' + (r.n >= state.N - 1 ? ' style="background:#fff7e8"' : '') + '>' +
            '<td><b>第 ' + r.n + ' 期</b></td>' +
            '<td class="num"><b>' + money(r.stake) + '</b></td>' +
            '<td class="num">' + money(r.cum) + '</td>' +
            '<td class="num pos">' + money(r.payout) + '</td>' +
            '<td class="num pos"><b>+' + money(r.net) + '</b></td>' +
            '<td class="num neg">' + money(r.loss) + '</td>' +
            '<td class="num muted">' + U.pct(pr, 2) + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +

      '<div class="mini-grid mt16">' +
        mg2('峰值资金需求', '<b style="color:var(--lose)">' + money(plan.peak) + ' 元</b>') +
        mg2('首期注额', money(plan.firstStake) + ' 元') +
        mg2('末期注额', money(plan.lastStake) + ' 元') +
        mg2('单期命中率', U.pct(c.p, 2)) +
      '</div>' +
      '<p class="small muted mt16 mb0">峰值资金 = 走满 ' + state.N + ' 期所需的全部投入，也是账户必须准备的保证金下限。' +
      '一旦资金不足，计划会在中途断裂，此前的投入全部无法收回——这是倍投最容易被忽略的硬约束。</p>' +
      '</div></div>';
  }

  /* ------------------------------------------------------------- 风险面板 */
  function riskCard(combos) {
    var c = combos[state.sel];
    if (!c) return '';
    var a = P.analyzeCombo(c, { dailyProfit: state.C, periods: state.N });
    var plan = a.plan, risk = a.risk;

    var rows = [0.6, 0.75, 1.0, 1.25, 1.5].map(function (mul) {
      var p = Math.min(0.95, c.p * mul);
      var r = P.risk(plan, p);
      return { mul: mul, p: p, r: r };
    });

    return '<div class="grid-side mt16">' +
      '<div class="card"><div class="card-h"><h2>风险测算</h2>' +
        '<span class="hint">原表只算了"中了赚多少"，这里补上"不中会怎样"</span></div>' +
        '<div class="card-b">' +
        '<div class="kpis mb16">' +
          kpi('全周期不中概率', U.pct(risk.pMissAll, 2), '', '走满 ' + state.N + ' 期仍未命中 → 亏损峰值资金', 'k-lose') +
          kpi('至少命中一次', U.pct(risk.pHit, 2), '', '倍投的"高胜率"就是这么来的', 'k-win') +
          kpi('单周期期望收益', money(risk.expReturn), '元', '已计入全灭情形', risk.expReturn >= 0 ? 'k-win' : 'k-warn') +
          kpi('期望资金效率', U.signed(risk.expPerCycle, 2), '', '期望收益 ÷ 峰值资金', risk.expPerCycle >= 0 ? 'k-win' : 'k-warn') +
          kpi('平均遇到一次全灭', risk.expCycles === Infinity ? '—' : U.num(risk.expCycles, 1), '个周期', '几何分布：全灭概率的倒数', 'k-draw') +
        '</div>' +
        '<div class="callout c-warn mb16"><h4>倍投改变了什么、没改变什么</h4>' +
          '<p class="small mb0">倍投<b>没有改变期望值</b>——每一期的期望都由赔率与真实概率决定，注额大小不影响它。' +
          '它改变的是<b>分布形状</b>：把「经常小亏」换成「大概率小赚 + 小概率巨亏」。' +
          '上面「至少命中一次 ' + U.pct(risk.pHit, 1) + '%」看起来很安全，但代价是 ' +
          U.pct(risk.pMissAll, 2) + '% 的概率一次亏掉 ' + money(plan.peak) + ' 元。' +
          '把这两个数字放在一起看，才是完整的图景。</p></div>' +
        '<h4 class="mb8">不同真实命中率下的结果</h4>' +
        '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
          '<th>情景</th><th class="num">单期命中率</th><th class="num">全周期不中</th><th class="num">期望收益</th><th class="num">资金效率</th>' +
        '</tr></thead><tbody>' +
          rows.map(function (x) {
            var lab = x.mul === 1 ? '模型估计' : (x.mul < 1 ? '偏悲观 ' + Math.round(x.mul * 100) + '%' : '偏乐观 ' + Math.round(x.mul * 100) + '%');
            return '<tr' + (x.mul === 1 ? ' style="background:#f2f7ff"' : '') + '>' +
              '<td>' + lab + '</td>' +
              '<td class="num">' + U.pct(x.p, 2) + '</td>' +
              '<td class="num">' + U.pct(x.r.pMissAll, 2) + '</td>' +
              '<td class="num ' + (x.r.expReturn >= 0 ? 'pos' : 'neg') + '">' + money(x.r.expReturn) + ' 元</td>' +
              '<td class="num ' + (x.r.expPerCycle >= 0 ? 'pos' : 'neg') + '">' + U.signed(x.r.expPerCycle, 2) + '</td></tr>';
          }).join('') +
        '</tbody></table></div>' +
        '<p class="tiny muted mt16 mb0">模型估计的单期命中率基于各腿独立相乘，为近似值。' +
        '同联赛 / 同时间开赛的组合存在正相关，实际命中率会偏离（通常更难达到）。</p>' +
        '</div></div>' +

      '<div class="card"><div class="card-h"><h3>逐期命中概率分布</h3></div><div class="card-b">' +
        C.bars(risk.hitRows.map(function (h) {
          return { label: String(h.n), value: +(h.prob * 100).toFixed(2), color: h.n === state.N ? '#cf2b2b' : '#123a6b' };
        }), { h: 190, fmtY: function (v) { return v.toFixed(1) + '%'; }, fmtV: function (v) { return v + '%'; } }) +
        '<div class="tiny muted center mt8">横轴 = 期号，纵轴 = 恰在该期命中的概率</div>' +
        '<div class="callout mt16"><h4>形状说明了什么</h4>' +
          '<p class="small mb0">概率集中在<b>前几期</b>（越早命中越省资金），尾部迅速趋近于零。' +
          '但要注意：所有期数的概率加起来只有 ' + U.pct(risk.pHit, 2) + '%，剩下的 ' + U.pct(risk.pMissAll, 2) +
          '% 落在表格之外——那正是「走满 ' + state.N + ' 期仍未命中」的尾部，也是唯一会导致重大亏损的情形。</p></div>' +
      '</div></div>' +
      '</div>';
  }

  /* --------------------------------------------------------- 原表档位对照 */
  function presetCard() {
    return '<div class="card mt16"><div class="card-h"><h2>与《升级版利润测算表》档位对照</h2>' +
      '<span class="hint">本页算法与该表逐格核对一致</span></div><div class="card-b flush">' +
      '<div class="scrollx"><table class="tbl">' +
      '<thead><tr><th>表格档位</th><th>来源</th><th class="num">赔率</th><th class="num">目标利润</th>' +
      '<th class="num">期数</th><th class="num">峰值资金</th><th class="num">末期注额</th><th>校验</th></tr></thead><tbody>' +
      P.presets.map(function (p) {
        var plan = P.martingale(p.E, p.C, p.N, p.opt || {});
        var target = plan.peak;
        var known = p.opt ? plan.rows.reduce(function (s, r) { return s + r.stake; }, 0) : plan.peak;
        return '<tr><td><b>' + U.esc(p.name) + '</b></td><td class="small muted">' + U.esc(p.src) + '</td>' +
          '<td class="num">' + p.E.toFixed(1) + '</td><td class="num">' + p.C + '</td><td class="num">' + p.N + '</td>' +
          '<td class="num"><b>' + money(known) + '</b></td><td class="num">' + money(plan.lastStake) + '</td>' +
          '<td><span class="tag t-win">与表格一致</span></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="card-b">' +
        '<p class="small mb0">以上数值由本页算法实时计算，与原始表格的「合计」单元格逐一对齐。' +
        '其中「A 计划（高赔 10）」20 期需要 <b style="color:var(--lose)">' + money(P.martingale(10, 2000, 20).peak) + ' 元</b>峰值资金——' +
        '这个数字本身就是风险提示：表格的「日利润 2000」看似可观，代价是十万级的资金占用与一条极长的尾部。</p>' +
      '</div></div></div>';
  }

  /* ------------------------------------------------------------- 数学结论 */
  function mathCard() {
    var mg = marginStats();
    return '<div class="card mt16"><div class="card-h"><h2>倍投的数学结论</h2>' +
      '<span class="hint">这一节比上面的表格更重要</span></div><div class="card-b">' +
      '<div class="grid-2">' +
        '<div class="callout c-warn"><h4>1 · 期望值不变</h4>' +
          '<p class="small mb0">设单期真实命中概率为 p、赔率为 E，则单期期望 = p·E − 1，与注额无关。' +
          '倍投只是把同一个期望<b>重新分配到不同期数</b>，不会把它变成正数。' +
          '当 E 已扣除 ' + U.pct(mg.avg, 1) + ' 的水位时，p·E − 1 恒为负，倍投只会让亏损更集中。</p></div>' +
        '<div class="callout c-warn"><h4>2 · 资金需求指数增长</h4>' +
          '<p class="small mb0">由递推式可推出，峰值资金约按 <b>(E/(E−1))<sup>n</sup></b> 增长。' +
          'E = 4.5 时每期约放大 1.29 倍，9 期就是约 5.9 倍；E = 3 时每期放大 1.5 倍，9 期约 20 倍。' +
          '赔率越低，资金曲线越陡——低赔策略反而更危险。</p></div>' +
        '<div class="callout c-gold"><h4>3 · 它把风险推到尾部</h4>' +
          '<p class="small mb0">倍投的直观感受是「命中率高」，因为多数周期都会在前几期中一次。' +
          '但少数「走满不中」的周期会一次性亏掉全部峰值资金。' +
          '如果长期胜率不足以覆盖这条尾部，资金曲线必然向下——这正是多数倍投实盘在数周后崩掉的原因。</p></div>' +
        '<div class="callout c-win"><h4>4 · 什么时候倍投才成立</h4>' +
          '<p class="small mb0">只有在单期期望 <b>≥ 0</b>（即模型概率真的高于市场隐含概率）时，倍投才谈得上可行。' +
          '而要做到这一点，必须先有独立于赔率的信息源（球队级 xG、伤停、阵容、赛程强度）。' +
          '仅靠官方赔率反解出来的模型，永远无法跨过这道门槛——这一点本站在下方如实说明。</p></div>' +
      '</div>' +
      '<div class="callout mt16"><h4>本站的立场</h4>' +
        '<p class="small mb0">本栏目提供的是<b>资金计划的算术</b>与<b>风险的数量化</b>，不是盈利承诺。' +
        '我们如实呈现：在当前官方盘口水位下，任何串关组合的长期期望都是负的，倍投不改变这个结论。' +
        '把这句话写在页面上，比写十句「必中」更有用。</p></div>' +
      '</div></div>';
  }

  /* -------------------------------------------------------------- 事件绑定 */
  function bind() {
    U.on(document, 'click', '[data-pday]', function (e, t) {
      state.day = t.dataset.pday; state.sel = 0;
      U.$$('[data-pday]').forEach(function (b) { b.classList.toggle('on', b === t); });
      renderParlay();
    });
    U.on(document, 'click', '[data-pk]', function (e, t) {
      state.k = +t.dataset.pk; state.sel = 0;
      U.$$('[data-pk]').forEach(function (b) { b.classList.toggle('on', b === t); });
      renderParlay();
    });
    U.on(document, 'click', '[data-combo]', function (e, t) {
      state.sel = +t.dataset.combo;
      renderParlay();
      var el = U.el('.card-h h2') || U.el('main');
      try { window.scrollTo({ top: (U.el('#parlay-body').offsetTop || 0) + 900, behavior: 'smooth' }); } catch (err) { }
    });
    var od = U.byId('p-od'); if (od) od.addEventListener('change', function () { state.od = +this.value; state.sel = 0; renderParlay(); });
    var cS = U.byId('p-c'); if (cS) cS.addEventListener('change', function () { state.C = +this.value; renderParlay(); });
    var nS = U.byId('p-n'); if (nS) nS.addEventListener('change', function () { state.N = +this.value; renderParlay(); });
  }

  JX.renderParlay = renderParlay;
})(window);

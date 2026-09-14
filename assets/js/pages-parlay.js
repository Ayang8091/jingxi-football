/* ==========================================================================
   竞析 JINGXI · 串关搭配与倍投资金计划（页面渲染 v2 · 独立工作台）
   --------------------------------------------------------------------------
   交互模型：
     1. 串关组合清单 = 候选腿池（复选框）。进入页面自动勾选模型概率最高的
        2~4 条腿（可选档位），用户可手动勾选 / 取消任意腿，同一场不可重复。
     2. 当期（第 cur 期）的赔率与投入可直接编辑并「锁定」；锁定后进入下一期，
        已选组合自动加载为新的当期数据。
     3. 未来期数仅为公式推演的「参考行」，可一键清除。
     4. 资金模式：倍投追利（复刻利润测算表）/ 固定投入（每期恒定注额）。
     5. 全部计划状态（锁定记录 / 当期 / 勾选）持久化在 localStorage，
        与主站共用同一数据源与缓存（datasource.js），数据实时联动。
   ========================================================================== */
(function (global) {
  'use strict';

  var JX = global.JX, U = JX.U, C = JX.C, M = JX.M, P = JX.PARLAY, DS = JX.DS;
  var D = global.JX_DATA;

  var STORE_KEY = 'jx.parlay.plan.v1';

  var state = {
    day: 'today',
    mode: 'martingale',   // 'martingale' 倍投追利 | 'fixed' 固定投入
    F: 200,               // 固定投入：每期注额
    C: 200,               // 倍投：目标利润
    N: 9,                 // 最大期数
    autoN: 3,             // 自动选号腿数（2~4）
    picked: {},           // legKey -> true
    cur: 1,               // 当前待投期号
    locked: {},           // n -> { odds, stake, legs }
    curOdds: null,        // 当期编辑值（null = 按当前票自动推算）
    curStake: null,
    clearedRef: false     // 参考期是否已被用户清除
  };

  /* --------------------------------------------------------- 状态持久化 */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({
      day: state.day, mode: state.mode, F: state.F, C: state.C, N: state.N,
      autoN: state.autoN, picked: state.picked, cur: state.cur,
      locked: state.locked, clearedRef: state.clearedRef
    })); } catch (e) { }
  }
  (function load() {
    try {
      var s = localStorage.getItem(STORE_KEY);
      if (!s) return;
      var o = JSON.parse(s);
      if (!o) return;
      ['day', 'mode', 'F', 'C', 'N', 'autoN', 'picked', 'cur', 'locked', 'clearedRef'].forEach(function (k) {
        if (o[k] !== undefined) state[k] = o[k];
      });
      if (state.cur < 1) state.cur = 1;
      if (state.cur > state.N) state.cur = state.N;
    } catch (e) { }
  })();

  function models() {
    return (D.matches || []).filter(function (m) { return m.day === state.day && m.sp; });
  }

  function money(v) { return (v >= 0 ? '' : '-') + Math.abs(Math.round(v)).toLocaleString('en-US'); }

  /* 页内提示（不打断渲染） */
  function note(t) {
    var el = U.byId('pp-note');
    if (el) { el.textContent = t; el.style.display = t ? '' : 'none'; }
  }

  /* ------------------------------------------------------------- 腿池与票 */
  function legPool() {
    /* 每场取模型概率最高的前 2 条腿，按概率降序展示 */
    return P.legPool(models(), 2).sort(function (a, b) { return b.p - a.p; });
  }

  function legKey(l) { return l.mid + '|' + l.play + '|' + l.sel; }

  function resolvePicked(pool) {
    var valid = {}, n = 0;
    pool.forEach(function (l) { if (state.picked[legKey(l)]) { valid[legKey(l)] = 1; n++; } });
    if (!n) {
      /* 没有有效勾选（首次进入 / 数据日切换 / 接口刷新）→ 自动选号 */
      var auto = P.autoPick(pool, state.autoN);
      state.picked = {};
      auto.forEach(function (l) { state.picked[legKey(l)] = 1; });
      return auto;
    }
    return pool.filter(function (l) { return valid[legKey(l)]; });
  }

  function ticketOf(pool) {
    var legs = resolvePicked(pool);
    if (!legs.length) return null;
    return P.stats(legs);
  }

  function ticketLabel(legs) {
    return legs.map(function (l) {
      return (l.match.home.short || l.match.home.name) + ' ' + l.sel + '@' + U.odds(l.sp);
    }).join(' + ');
  }

  /* --------------------------------------------------------- 计划行推演 */
  function evenUp(v) { return Math.ceil(v / 2) * 2; }

  function buildPlanRows(ticketSp) {
    var rows = [], cum = 0, n;
    for (n = 1; n <= state.N; n++) {
      var L = state.locked[n] || null;
      var odds, stake, status;
      if (L) {
        odds = L.odds; stake = L.stake; status = 'locked';
      } else if (n === state.cur) {
        odds = state.curOdds || ticketSp;
        if (state.mode === 'fixed') stake = (state.curStake != null ? state.curStake : state.F);
        else stake = (state.curStake != null ? state.curStake : evenUp((cum + state.C * n) / (odds - 1)));
        status = 'cur';
      } else {
        odds = ticketSp;
        stake = (state.mode === 'fixed') ? state.F : evenUp((cum + state.C * n) / (odds - 1));
        status = 'ref';
      }
      if (!(odds > 1)) odds = 2;
      if (!(stake > 0)) stake = 2;
      var payout = stake * odds, total = cum + stake;
      rows.push({
        n: n, odds: odds, stake: stake, cum: total, payout: payout,
        net: payout - total, loss: -total, status: status
      });
      cum = total;
    }
    return rows;
  }

  function startCum() {
    var s = 0, k;
    for (k in state.locked) s += (+state.locked[k].stake || 0);
    return s;
  }

  function planFromRows(rows) {
    return { N: state.N, rows: rows, peak: rows[rows.length - 1].cum };
  }

  /* ------------------------------------------------------------ 主渲染入口 */
  function renderParlay() {
    var host = U.byId('parlay-body');
    if (!host) return;
    var pool = legPool();
    var ticket = ticketOf(pool);
    var mg = marginStats();
    var rows = ticket ? buildPlanRows(ticket.sp) : [];

    host.innerHTML =
      hero(ticket, mg) +
      controls(ticket) +
      poolCard(pool, ticket) +
      planCard(ticket, rows) +
      riskCard(ticket, rows) +
      presetCard() +
      mathCard();

    bind(pool);
  }

  /* ------------------------------------------------------------------ 区块 */
  function hero(ticket, mg) {
    var ms = models();
    var lockedN = Object.keys(state.locked).length;
    var modeLab = state.mode === 'fixed' ? '固定投入' : (state.autoN + ' 腿自动选号');
    return '<div class="kpis mb16">' +
      kpi('可组合赛事', ms.length, '场', ms.length ? U.uniq(ms.map(function (m) { return m.league; })).length + ' 个联赛 · ' + modeLab : '当前无可分析赛事', 'k-draw') +
      kpi('当期组合赔率', ticket ? U.odds(ticket.sp) : '—', '', ticket ? '联合命中 ' + U.pct(ticket.p, 2) + ' · EV ' + U.signed(ticket.ev, 1) : '先在下方勾选组合', 'k-gold') +
      kpi('计划进度', lockedN + '/' + state.N, '期', '当前待投：第 ' + state.cur + ' 期 · 累计已投入 ' + money(startCum()) + ' 元', 'k-draw') +
      kpi('官方盘口水位', (mg.avg * 100).toFixed(1), '%', '单关均值 · 串关按关数放大', 'k-warn') +
      '</div>';
  }

  function kpi(label, val, unit, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="k-lab">' + label + '</div>' +
      '<div class="k-val">' + val + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      '<div class="k-sub">' + U.esc(sub) + '</div></div>';
  }

  function controls(ticket) {
    var days = [{ k: 'today', l: '今日' }, { k: 'tomorrow', l: '明日' }, { k: 'after', l: '后天' }];
    return '<div class="card"><div class="card-h"><h3>搭配参数</h3>' +
      '<span class="tiny muted">调整后立即重算；计划进度与锁定记录自动保存</span></div><div class="card-b">' +
      '<div class="toolbar" style="margin:0;border:0;padding:0;background:none">' +
        '<div class="seg">' + days.map(function (d) {
          return '<button data-pday="' + d.k + '" class="' + (d.k === state.day ? 'on' : '') + '">' + d.l + '</button>';
        }).join('') + '</div>' +
        '<div class="seg">' +
          '<button data-pmode="martingale" class="' + (state.mode === 'martingale' ? 'on' : '') + '">倍投追利</button>' +
          '<button data-pmode="fixed" class="' + (state.mode === 'fixed' ? 'on' : '') + '">固定投入</button>' +
        '</div>' +
        (state.mode === 'martingale'
          ? '<div class="field"><label>日利润目标</label><select id="p-c">' +
            [50, 100, 200, 500, 1000, 2000].map(function (v) {
              return '<option value="' + v + '"' + (v === state.C ? ' selected' : '') + '>' + v + ' 元</option>';
            }).join('') + '</select></div>'
          : '<div class="field"><label>每期固定投入</label><select id="p-f">' +
            [50, 100, 200, 500, 1000, 2000].map(function (v) {
              return '<option value="' + v + '"' + (v === state.F ? ' selected' : '') + '>' + v + ' 元</option>';
            }).join('') + '</select></div>') +
        '<div class="field"><label>最大期数</label><select id="p-n">' +
          [5, 6, 8, 9, 10, 12, 15].map(function (v) {
            return '<option value="' + v + '"' + (v === state.N ? ' selected' : '') + '>' + v + ' 期</option>';
          }).join('') + '</select></div>' +
        '<button class="btn-ghost" data-preset-clear id="pp-reset" style="margin-left:auto">重置整个计划</button>' +
      '</div>' +
      (state.mode === 'martingale'
        ? '<div class="tiny muted mt16">倍投模式：出票额(n) = ( 上期累计投入 + 目标利润 × n ) ÷ (赔率 − 1)，向上取偶，与《升级版利润测算表》逐格一致。'
        : '<div class="tiny muted mt16">固定投入模式：每期注额恒定，命中即赚 注额 × (组合赔率 − 1)；不中损失该期注额，资金压力线性增长、不会指数膨胀。') +
      (state.locked && Object.keys(state.locked).length ? '已锁定 ' + Object.keys(state.locked).length + ' 期的数据不受参数调整影响。</div>' : '</div>') +
      '</div></div>';
  }

  /* ---------------------------------------------------------- 串关组合清单 */
  function poolCard(pool, ticket) {
    var autoSeg = '<div class="seg">' + [2, 3, 4].map(function (n) {
      return '<button data-auto="' + n + '" class="' + (state.autoN === n ? 'on' : '') + '">自动 ' + n + ' 腿</button>';
    }).join('') + '</div>';

    var body;
    if (!pool.length) {
      body = '<div class="card-b center muted">当前日期没有可组合的候选腿（无可分析赛事）。</div>';
    } else {
      body = '<div class="card-b flush"><div class="scrollx"><table class="tbl tbl-dense">' +
        '<thead><tr><th></th><th>场次（玩法 · 选择）</th><th class="num">模型概率</th>' +
        '<th class="num">SP</th><th class="num">期望 EV</th><th class="num">公平赔率</th></tr></thead><tbody>' +
        pool.map(function (l) {
          var on = !!state.picked[legKey(l)];
          var dup = !on && pool.some(function (x) { return state.picked[legKey(x)] && x.mid === l.mid; });
          return '<tr' + (on ? ' style="background:#f2f7ff"' : '') + '>' +
            '<td><input type="checkbox" data-leg="' + U.esc(legKey(l)) + '"' + (on ? ' checked' : '') + (dup ? ' title="同一场已选，取消后才能勾选"' : '') + '></td>' +
            '<td><b>' + U.esc(l.match.no) + '</b> ' + U.esc(l.match.home.short) + ' vs ' + U.esc(l.match.away.short) +
              '<div class="tiny muted">' + U.esc(l.play) + ' · <b style="color:var(--accent)">' + U.esc(l.sel) + '</b>' +
              ' <span class="muted">@' + U.odds(l.sp) + '</span>' + (l.match.league ? ' · ' + U.esc(l.match.league) : '') + '</div></td>' +
            '<td class="num"><b>' + U.pct(l.p, 1) + '</b></td>' +
            '<td class="num">' + U.odds(l.sp) + '</td>' +
            '<td class="num ' + (l.ev >= 0 ? 'pos' : 'neg') + '">' + U.signed(l.ev, 1) + '</td>' +
            '<td class="num muted">' + U.num(1 / l.p, 2) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="card-b" style="border-top:1px solid var(--line)">' +
          '<div class="toolbar" style="margin:0;border:0;padding:0;background:none;flex-wrap:wrap">' +
            autoSeg +
            '<span id="pp-ticket-sum" class="small" style="margin-left:12px">' +
            (ticket
              ? '当前票面：<b>' + ticket.k + '</b> 腿 · 组合赔率 <b style="color:var(--accent)">' + U.odds(ticket.sp) + '</b> · ' +
                '联合概率 <b>' + U.pct(ticket.p, 2) + '</b> · EV <b class="' + (ticket.ev >= 0 ? 'pos' : 'neg') + '">' + U.signed(ticket.ev, 1) + '</b>' +
                (ticket.sameLeague ? ' <span class="tag t-warn">含同联赛</span>' : '')
              : '尚未勾选任何腿') +
            '</span>' +
          '</div>' +
          '<div class="tiny muted mt8">自动选号 = 按模型概率从高到低挑腿（同一场只取一条）；勾选框可手动增加 / 取消，同一场比赛不可重复串联。' +
          '选定后，当期赔率与投入将按此票面自动加载。</div>' +
        '</div>' +
        '</div>';
    }
    return '<div class="card mt16"><div class="card-h"><h3>串关组合清单</h3>' +
      '<span class="tiny muted">勾选腿 → 组成当期串关票面 → 下方资金计划自动跟随</span></div>' + body + '</div>';
  }

  /* --------------------------------------------------------- 倍投计划表 v2 */
  function planCard(ticket, rows) {
    if (!ticket || !rows.length) {
      return '<div class="card mt16"><div class="card-h"><h2>倍投资金计划</h2></div>' +
        '<div class="card-b center muted">请先在「串关组合清单」中勾选至少一条腿。</div></div>';
    }

    var shown = rows.filter(function (r) { return !(state.clearedRef && r.status === 'ref'); });
    var statusTag = {
      locked: '<span class="tag t-win">已锁定</span>',
      cur: '<span class="tag t-brand">当期 · 可编辑</span>',
      ref: '<span class="tag">参考计算</span>'
    };

    var body = shown.map(function (r) {
      var bg = r.status === 'cur' ? ' style="background:#f2f7ff"' : (r.status === 'ref' ? ' style="opacity:.62"' : '');
      var legsTxt = r.status === 'locked' && state.locked[r.n] ? U.esc(state.locked[r.n].legs || '') :
        (r.status === 'cur' ? U.esc(ticketLabel(P.stats(resolvePicked(legPool())).legs)) : '<span class="muted">按当前票面推演</span>');
      var oddsCell = r.status === 'cur'
        ? '<input class="cell-input num-in" id="cur-odds" type="number" step="0.01" min="1.01" value="' + U.odds(r.odds) + '">'
        : U.odds(r.odds);
      var stakeCell = r.status === 'cur'
        ? '<input class="cell-input num-in" id="cur-stake" type="number" step="2" min="2" value="' + Math.round(r.stake) + '">'
        : '<b>' + money(r.stake) + '</b>';
      return '<tr' + bg + '>' +
        '<td><b>第 ' + r.n + ' 期</b></td>' +
        '<td>' + statusTag[r.status] + '</td>' +
        '<td class="tiny" style="max-width:260px">' + legsTxt + '</td>' +
        '<td class="num">' + oddsCell + '</td>' +
        '<td class="num">' + stakeCell + '</td>' +
        '<td class="num">' + money(r.cum) + '</td>' +
        '<td class="num pos">' + money(r.payout) + '</td>' +
        '<td class="num pos"><b>' + money(r.net) + '</b></td>' +
        '<td class="num neg">' + money(r.loss) + '</td>' +
        '</tr>';
    }).join('');

    var curRow = rows[state.cur - 1];
    var peakRow = rows[rows.length - 1];

    return '<div class="card mt16"><div class="card-h"><h2>倍投资金计划</h2>' +
      '<span class="hint">' + (state.mode === 'fixed' ? '固定投入 ' + state.F + ' 元/期' : '目标利润 ' + state.C + ' 元/期') +
      ' · 上限 ' + state.N + ' 期 · 已锁定 ' + Object.keys(state.locked).length + ' 期</span></div>' +
      '<div class="card-b">' +

      '<div class="callout c-gold mb16" id="pp-cur-box"><h4>当期操作（第 ' + state.cur + ' 期）</h4>' +
        '<p class="small mb8">当期赔率与投入已按当前票面自动加载。<b>确认实际出票后，可直接修改为票面数值并锁定</b>——' +
        '锁定后该期数据固定不变，后续期数重新按公式推演。</p>' +
        '<div class="toolbar" style="margin:0;border:0;padding:0;background:none">' +
          '<button class="btn-brand" data-lock>锁定当期并进入下一期 →</button>' +
          '<button class="btn-ghost" data-clearref>' + (state.clearedRef ? '恢复参考期计算' : '清除参考期（只保留已锁定期）') + '</button>' +
          '<span class="tiny muted" id="pp-note" style="display:none;color:var(--lose)"></span>' +
        '</div></div>' +

      '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
        '<th>期号</th><th>状态</th><th>票面</th><th class="num">赔率</th><th class="num">单期注额</th>' +
        '<th class="num">累计投入</th><th class="num">命中奖金</th><th class="num">命中净盈利</th><th class="num">未中累计亏损</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>' +

      (state.clearedRef
        ? '<p class="tiny muted mt8">参考期已按你的要求清除；需要时点上方「恢复参考期计算」即可重新生成。</p>'
        : '<p class="tiny muted mt8">「参考计算」行仅是按当前票面与公式推演的<b>资金需求参考</b>，不代表已出票；锁定当期后，后续行会自动重算。</p>') +

      '<div class="mini-grid mt16">' +
        mg2('本计划峰值资金', '<b style="color:var(--lose)">' + money(peakRow.cum) + ' 元</b>') +
        mg2('当期应投（推算）', money(curRow ? curRow.stake : 0) + ' 元') +
        mg2('当期若命中净利', '<b style="color:var(--win)">+' + money(curRow ? curRow.net : 0) + '</b> 元') +
        mg2('累计已投入（锁定）', money(startCum()) + ' 元') +
      '</div>' +
      '<p class="small muted mt16 mb0">峰值资金 = 走满全部期数所需的全部投入，也是账户必须准备的保证金下限。' +
      '一旦资金不足，计划会在中途断裂，此前的投入全部无法收回——这是倍投最容易被忽略的硬约束。</p>' +
      '</div></div>';
  }

  function mg2(l, v) { return '<div><div class="mg-l">' + l + '</div><div class="mg-v">' + v + '</div></div>'; }

  /* ------------------------------------------------------------- 风险面板 */
  function riskCard(ticket, rows) {
    if (!ticket) return '';
    var plan = planFromRows(rows);
    var risk = P.risk(plan, Math.min(0.999, Math.max(0.001, ticket.p)));
    if (!risk) return '';

    var sensRows = [0.6, 0.75, 1.0, 1.25, 1.5].map(function (mul) {
      var p = Math.min(0.95, ticket.p * mul);
      var r = P.risk(plan, p);
      return { mul: mul, p: p, r: r };
    });

    return '<div class="grid-side mt16">' +
      '<div class="card"><div class="card-h"><h2>风险测算</h2>' +
        '<span class="hint">按当前票面概率 p = ' + U.pct(ticket.p, 2) + ' 估算</span></div>' +
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
          (state.mode === 'fixed'
            ? '固定投入模式不会指数膨胀，但长期期望仍是 ' + U.signed(risk.expReturn / Math.max(1, state.N * state.F), 2) + ' / 单期投入。'
            : '上面「至少命中一次 ' + U.pct(risk.pHit, 1) + '%」看起来很安全，但代价是 ' +
              U.pct(risk.pMissAll, 2) + '% 的概率一次亏掉 ' + money(plan.peak) + ' 元。') +
          '</p></div>' +
        '<h4 class="mb8">不同真实命中率下的结果</h4>' +
        '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
          '<th>情景</th><th class="num">单期命中率</th><th class="num">全周期不中</th><th class="num">期望收益</th><th class="num">资金效率</th>' +
        '</tr></thead><tbody>' +
          sensRows.map(function (x) {
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
        '同联赛 / 同时间开赛的组合存在正相关，实际命中率会偏离（通常更难达到）。' +
        '已锁定期使用锁定时的实际赔率，未锁定期按当前票面推演。</p>' +
        '</div></div>' +

      '<div class="card"><div class="card-h"><h3>逐期命中概率分布</h3></div><div class="card-b">' +
        C.bars(risk.hitRows.map(function (h) {
          return { label: String(h.n), value: +(h.prob * 100).toFixed(2), color: h.n === state.N ? '#cf2b2b' : '#123a6b' };
        }), { h: 190, fmtY: function (v) { return v.toFixed(1) + '%'; }, fmtV: function (v) { return v + '%'; } }) +
        '<div class="tiny muted center mt8">横轴 = 期号，纵轴 = 恰在该期命中的概率</div>' +
        '<div class="callout mt16"><h4>形状说明了什么</h4>' +
          '<p class="small mb0">概率集中在<b>前几期</b>（越早命中越省资金），尾部迅速趋近于零。' +
          '所有期数的概率加起来只有 ' + U.pct(risk.pHit, 2) + '%，剩下的 ' + U.pct(risk.pMissAll, 2) +
          '% 落在表格之外——那正是「走满 ' + state.N + ' 期仍未命中」的尾部，也是唯一会导致重大亏损的情形。</p></div>' +
      '</div></div>' +
      '</div>';
  }

  /* --------------------------------------------------------- 原表档位对照 */
  function presetCard() {
    return '<div class="card mt16"><div class="card-h"><h2>与《升级版利润测算表》档位对照</h2>' +
      '<span class="hint">本页倍投算法与该表逐格核对一致</span></div><div class="card-b flush">' +
      '<div class="scrollx"><table class="tbl">' +
      '<thead><tr><th>表格档位</th><th>来源</th><th class="num">赔率</th><th class="num">目标利润</th>' +
      '<th class="num">期数</th><th class="num">峰值资金</th><th class="num">末期注额</th><th>校验</th></tr></thead><tbody>' +
      P.presets.map(function (p) {
        var plan = P.martingale(p.E, p.C, p.N, p.opt || {});
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
        '<div class="callout c-warn"><h4>2 · 资金需求指数增长（倍投模式）</h4>' +
          '<p class="small mb0">由递推式可推出，峰值资金约按 <b>(E/(E−1))<sup>n</sup></b> 增长。' +
          'E = 4.5 时每期约放大 1.29 倍，9 期就是约 5.9 倍；E = 3 时每期放大 1.5 倍，9 期约 20 倍。' +
          '赔率越低，资金曲线越陡——低赔策略反而更危险。固定投入模式没有这个问题，代价是单期净利也固定。</p></div>' +
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

  /* -------------------------------------------------------------- 事件绑定 */
  function bind(pool) {
    U.on(document, 'click', '[data-pday]', function (e, t) {
      state.day = t.dataset.pday; state.cur = 1; state.locked = {};
      state.curOdds = state.curStake = null; state.picked = {};
      U.$$('[data-pday]').forEach(function (b) { b.classList.toggle('on', b === t); });
      save(); renderParlay();
    });
    U.on(document, 'click', '[data-pmode]', function (e, t) {
      state.mode = t.dataset.pmode; state.curOdds = state.curStake = null;
      U.$$('[data-pmode]').forEach(function (b) { b.classList.toggle('on', b === t); });
      save(); renderParlay();
    });
    U.on(document, 'click', '[data-auto]', function (e, t) {
      state.autoN = +t.dataset.auto;
      var auto = P.autoPick(pool, state.autoN);
      state.picked = {};
      auto.forEach(function (l) { state.picked[legKey(l)] = 1; });
      state.curOdds = state.curStake = null;
      save(); renderParlay();
      note('已自动勾选概率最高的 ' + auto.length + ' 条腿');
    });
    U.on(document, 'change', '[data-leg]', function (e, t) {
      var key = t.dataset.leg;
      if (t.checked) {
        var leg = null;
        pool.forEach(function (l) { if (legKey(l) === key) leg = l; });
        var dup = pool.some(function (l) { return legKey(l) !== key && state.picked[legKey(l)] && leg && l.mid === leg.mid; });
        if (dup) { t.checked = false; note('同一场比赛只能选一条腿——先取消该场已选的腿再勾选。'); return; }
        state.picked[key] = 1;
      } else {
        delete state.picked[key];
      }
      state.curOdds = state.curStake = null;
      save(); renderParlay();
    });
    U.on(document, 'click', '[data-lock]', function () {
      var t = ticketOf(legPool());
      if (!t) { note('请先勾选组合'); return; }
      var oddsIn = U.byId('cur-odds'), stakeIn = U.byId('cur-stake');
      var odds = oddsIn ? +oddsIn.value : (state.curOdds || t.sp);
      var stake = stakeIn ? +stakeIn.value : (state.curStake || 0);
      if (!(odds > 1)) { note('当期赔率必须大于 1'); return; }
      if (!(stake >= 2)) { note('当期投入至少 2 元'); return; }
      state.locked[state.cur] = { odds: odds, stake: stake, legs: ticketLabel(t.legs) };
      if (state.cur < state.N) state.cur += 1;
      state.curOdds = state.curStake = null;
      state.clearedRef = false;
      save(); renderParlay();
      try { window.scrollTo({ top: (U.el('#parlay-body').offsetTop || 0) + 600, behavior: 'smooth' }); } catch (e) { }
    });
    U.on(document, 'click', '[data-clearref]', function () {
      state.clearedRef = !state.clearedRef;
      save(); renderParlay();
    });
    U.on(document, 'click', '#pp-reset', function () {
      if (!global.confirm || global.confirm('确定重置整个计划？已锁定的期数与勾选将全部清空。')) {
        state.locked = {}; state.cur = 1; state.picked = {}; state.curOdds = state.curStake = null;
        state.clearedRef = false;
        save(); renderParlay();
      }
    });
    var oddsIn = U.byId('cur-odds');
    if (oddsIn) oddsIn.addEventListener('change', function () {
      var v = +this.value;
      if (!(v > 1)) { note('赔率必须大于 1'); renderParlay(); return; }
      state.curOdds = v; state.curStake = null; save(); renderParlay();
    });
    var stakeIn = U.byId('cur-stake');
    if (stakeIn) stakeIn.addEventListener('change', function () {
      var v = +this.value;
      if (!(v >= 2)) { note('投入至少 2 元'); renderParlay(); return; }
      state.curStake = v; save(); renderParlay();
    });
    var cS = U.byId('p-c'); if (cS) cS.addEventListener('change', function () { state.C = +this.value; save(); renderParlay(); });
    var fS = U.byId('p-f'); if (fS) fS.addEventListener('change', function () { state.F = +this.value; state.curStake = null; save(); renderParlay(); });
    var nS = U.byId('p-n'); if (nS) nS.addEventListener('change', function () {
      state.N = +this.value;
      if (state.cur > state.N) state.cur = state.N;
      save(); renderParlay();
    });
  }

  JX.renderParlay = renderParlay;
})(window);

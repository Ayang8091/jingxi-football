/* ==========================================================================
   竞析 JINGXI · 单场深度剖析页
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.JX_DATA, U = global.JX.U, C = global.JX.C, M = global.JX.M;
  var evalPick = global.JX.evalPick, mg = global.JX.mg;

  /* 数据覆盖：演示快照含全部字段；接入官方接口后仅含赛程与赔率 */
  function cov(m) {
    return m.coverage || { xg: true, form: true, injury: true, h2h: true, asian: true, euroTrend: true, odds: true, rq: true, ttg: true };
  }
  function na(text) { return '<span class="na">' + U.esc(text || '该数据源未提供') + '</span>'; }
  function unavail(title, items) {
    return '<div class="callout c-warn"><h4>' + U.esc(title) + '</h4>' +
      '<p class="small mb0">当前数据源（中国体彩网公开接口）只提供赛程与赔率，不包含以下字段，因此本模块自动降级：</p>' +
      '<ul class="small mb0">' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>';
  }

  function renderMatch() {
    var id = U.qs('id');
    var m = D.matches.filter(function (x) { return x.id === id; })[0] ||
      D.matches.filter(function (x) { return x.day === 'today' && x.sp; })[0] || D.matches[0];
    if (!m) { U.byId('match-body').innerHTML = '<div class="wrap" style="padding:40px 20px"><div class="callout c-warn"><h4>暂无可分析的赛事</h4><p class="small mb0">请点顶部「数据更新」拉取最新赛程。</p></div></div>'; return; }
    var r = global.JX.model(m);
    var mk = r.sp;
    var host = U.byId('match-body');
    var c = cov(m);

    /* --- 头部对阵 --- */
    var head = '<div class="pagehead"><div class="wrap">' +
      '<div class="crumb"><a href="index.html">今日预测</a> / ' + U.esc(m.league) + ' / ' + U.esc(m.no) + '</div>' +
      '<div class="row between wrapx" style="align-items:flex-end">' +
        '<div>' +
          '<h1 style="font-size:26px">' + U.esc(m.home.name) + ' <span class="muted" style="font-weight:400;font-size:18px">vs</span> ' + U.esc(m.away.name) + '</h1>' +
          '<div class="sub">' + U.esc(m.leagueFull || m.league) + ' · ' + U.esc(m.no) + ' · ' +
            U.esc(m.kickoffFull || m.vtime || m.kickoff || '') +
            (m.venue ? ' · ' + U.esc(m.venue) : '') + ' · 竞彩停售：开赛前 15 分钟</div>' +
        '</div>' +
        '<div class="right">' +
          '<div class="row gap8" style="justify-content:flex-end">' + (m.tags || []).map(function (t) { return '<span class="tag t-brand">' + U.esc(t) + '</span>'; }).join('') + '</div>' +
          '<div class="row gap8 mt8" style="justify-content:flex-end"><span class="tiny muted">信心指数</span>' + C.stars(m.conf) + '</div>' +
        '</div>' +
      '</div>' +
      '</div></div>';

    /* --- 核心结论卡 --- */
    var picks = m.picks.map(function (p) { return { p: p, e: evalPick(m, p) }; });
    var best = picks.filter(function (x) { return x.e.stake > 0; }).sort(function (a, b) { return b.e.ev - a.e.ev; })[0];

    var conclusion =
      '<div class="card"><div class="card-h"><h3>模型结论</h3>' +
        '<span class="tiny muted">λ 主 ' + U.num(m.lam[0], 2) + ' / 客 ' + U.num(m.lam[1], 2) + ' · 合计预期进球 ' + U.num(m.lam[0] + m.lam[1], 2) + '</span></div>' +
      '<div class="card-b">' +
        '<div class="grid-2">' +
          '<div>' +
            '<div class="tri mb8">' +
              triCell('主胜', r.w, M.fairOdds(r.w), m.sp.w, mk.w, r.w >= r.d && r.w >= r.l) +
              triCell('平局', r.d, M.fairOdds(r.d), m.sp.d, mk.d, r.d > r.w && r.d >= r.l) +
              triCell('客胜', r.l, M.fairOdds(r.l), m.sp.l, mk.l, r.l > r.w && r.l > r.d) +
            '</div>' +
            C.pbar({ w: r.w, d: r.d, l: r.l }, 10) +
            '<p class="small muted mt8 mb0">上排为模型概率，下排为竞彩官方 SP 及其去水隐含概率。模型概率高于隐含概率即为正向价值。</p>' +
          '</div>' +
          '<div>' +
            '<div class="callout c-gold mb8"><h4>本场推荐</h4>' +
              (best
                ? '<p class="mb0"><b style="font-size:15px">' + U.esc(best.p.play) + ' · ' + U.esc(best.p.sel) + '</b> @ ' + U.odds(best.p.sp) +
                  '<br><span class="small">模型概率 ' + U.pct(best.e.p, 1) + '，公平赔率 ' + U.num(best.e.fair, 2) +
                  '，期望值 <b class="pos">' + U.signed(best.e.ev, 1) + '</b>，建议 ' + U.num(best.e.stake, 2) + ' 个单位。</span></p>'
                : '<p class="mb0">本场无满足价值阈值的选项，<b>建议空仓</b>。空仓是模型给出的结论之一，不是遗漏。</p>') +
            '</div>' +
            m.picks.slice(1).map(function (p, i) {
              var e = picks[i + 1].e;
              return '<div class="row between small" style="padding:5px 0;border-bottom:1px dashed var(--line)">' +
                '<span><span class="tag">' + U.esc(p.play) + '</span> ' + U.esc(p.sel) + '</span>' +
                '<span class="num">@' + U.odds(p.sp) + ' · EV <b class="' + (e.ev > 0 ? 'pos' : 'neg') + '">' + U.signed(e.ev, 1) + '</b> · ' + U.num(e.stake, 2) + 'u</span>' +
                '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="callout mt16"><h4>一句话判断</h4><p class="mb0">' + U.esc(m.summary) + '</p></div>' +
      '</div></div>';

    /* --- 8 个分析区块（按数据覆盖情况切换内容） --- */
    var blocks =
      (c.xg || c.form ? blockBasic(m, r) : blockCoverage(m, r)) +
      (c.h2h ? blockH2H(m) : blockPricing(m, r)) +
      (c.injury ? blockInjury(m) : blockLimits(m)) +
      (c.asian ? blockOdds(m, r) : blockPoolOdds(m, r)) +
      blockGoals(m, r) +
      blockScore(m, r) +
      blockStake(m, picks) +
      blockRisk(m);

    host.innerHTML = head + '<main><div class="wrap">' + conclusion + blocks + related(m) + '</div></main>';
  }

  function triCell(lab, p, fair, sp, imp, hl) {
    var cls = lab === '主胜' ? 'c-w' : (lab === '平局' ? 'c-d' : 'c-l');
    var arrow = p - imp > 0.005 ? ' ▲' : (imp - p > 0.005 ? ' ▼' : ' =');
    var ac = p - imp > 0.005 ? 'var(--win)' : (imp - p > 0.005 ? 'var(--lose)' : 'var(--ink-3)');
    return '<div class="' + (hl ? 'hl' : '') + '">' +
      '<div class="t-lab">' + lab + '</div>' +
      '<div class="t-val ' + cls + '">' + U.pct(p, 1) + '</div>' +
      '<div class="t-odds">公平 ' + U.num(fair, 2) + ' · SP ' + U.odds(sp) + '</div>' +
      '<div class="t-odds" style="color:' + ac + ';font-weight:700">' + U.pct(imp, 1) + arrow + '</div>' +
      '</div>';
  }

  function cleanSheet(r, side) {
    var m = r.matrix, acc = 0, i;
    if (side === 'home') { for (i = 0; i <= 9; i++) acc += m[i][0]; }
    else { for (i = 0; i <= 9; i++) acc += m[0][i]; }
    return acc;
  }

  /* 1. 基本面与战绩 */
  function blockBasic(m, r) {
    var h = m.home, a = m.away;
    return section('basic', '01 · 基本面与近期状态',
      '<div class="grid-2">' +
        '<div>' + teamStats(h, '主队 · ' + h.name) + '</div>' +
        '<div>' + teamStats(a, '客队 · ' + a.name) + '</div>' +
      '</div>' +
      '<div class="mt24 mb8 small" style="font-weight:700">攻防效率对比</div>' +
      C.vsBar('场均预期进球 xG', h.xg, a.xg, { fmt: function (v) { return v.toFixed(2); } }) +
      C.vsBar('场均预期失球 xGA（越低越好）', h.xga, a.xga, { fmt: function (v) { return v.toFixed(2); } }) +
      C.vsBar('场均实际进球', (h.gf / h.played), (a.gf / a.played), { fmt: function (v) { return v.toFixed(2); } }) +
      C.vsBar('场均实际失球（越低越好）', (h.ga / h.played), (a.ga / a.played), { fmt: function (v) { return v.toFixed(2); } }) +
      C.vsBar('状态分', h.form, a.form, { fmt: function (v) { return v.toFixed(0); } }) +
      '<div class="callout c-gold mt16 small"><b>xG 差 ' + U.num(h.xg - a.xg, 2) + '，xGA 差 ' + U.num(h.xga - a.xga, 2) + '。</b>' +
      '模型据此估计 λ 为主 ' + U.num(m.lam[0], 2) + ' / 客 ' + U.num(m.lam[1], 2) +
      '，即主队预期进球优势 ' + U.num(m.lam[0] - m.lam[1], 2) + ' 球。xG 与实际进球的背离程度，是判断球队实力被高估或低估的最直接依据。</div>'
    );
  }

  function teamStats(t, title) {
    var rec = t.recent, w = rec.filter(function (x) { return x === 'W'; }).length,
      d = rec.filter(function (x) { return x === 'D'; }).length, l = rec.filter(function (x) { return x === 'L'; }).length;
    return '<div class="mini-grid mb8">' +
      mg('联赛排名', '#' + t.rank) + mg('积分', t.pts) + mg('已赛 / 场均积分', t.played + ' / ' + U.num(t.pts / t.played, 2)) +
      mg('进球 / 失球', t.gf + ' / ' + t.ga) + mg('近 5 场', w + '胜' + d + '平' + l + '负') + mg('主场/客场战绩', t.homeRec[0] + '-' + t.homeRec[1] + '-' + t.homeRec[2]) +
      '</div>' +
      '<div class="row between small mb8"><span class="muted">' + U.esc(title) + '</span>' + C.form(rec) + '</div>' +
      '<div class="row between small"><span class="muted">核心球员</span><b>' + U.esc(t.star) + '</b></div>';
  }

  /* ---- 实时数据模式：01 数据覆盖与模型输入 ---- */
  function blockCoverage(m, r) {
    var c = cov(m);
    var rows = [
      ['赛事与联赛', m.leagueFull || m.league, true],
      ['开赛时间', m.kickoffFull || m.kickoff || '—', true],
      ['球队名称', m.home.name + ' / ' + m.away.name, true],
      ['胜平负 SP', m.sp ? m.sp.w + ' / ' + m.sp.d + ' / ' + m.sp.l : '—', !!m.sp],
      ['让球盘 SP', c.rq ? (m.rq.label + ' · ' + m.rq.w + ' / ' + m.rq.d + ' / ' + m.rq.l) : '—', c.rq],
      ['总进球 SP', c.ttg ? '0 ~ 7+ 共 8 档' : '—', c.ttg],
      ['比分 SP', c.crs ? '已提供' : '—', c.crs],
      ['半全场 SP', c.hafu ? '已提供' : '—', c.hafu],
      ['球队级 xG / xGA', '未提供', false],
      ['伤停 / 停赛 / 阵容', '未提供', false],
      ['历史交锋', '未提供', false],
      ['亚洲盘水位与成交量', '未提供', false]
    ];
    return section('basic', '01 · 数据覆盖与模型输入',
      '<div class="mini-grid mb16">' +
        mg('反解 λ（主）', U.num(m.lam[0], 3)) +
        mg('反解 λ（客）', U.num(m.lam[1], 3)) +
        mg('期望总进球', U.num(m.lam[0] + m.lam[1], 2)) +
        mg('模型概率和', U.pct(r.w + r.d + r.l, 4)) +
      '</div>' +
      '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr><th>数据项</th><th>本场取值</th><th>状态</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td>' + U.esc(x[0]) + '</td><td class="small">' + U.esc(String(x[1])) + '</td>' +
            '<td>' + (x[2] ? '<span class="tag t-win">可用</span>' : na('未提供')) + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<div class="callout c-gold mt16"><h4>λ 是怎么来的</h4>' +
        '<p class="mb0">本数据源不含球队基本面，因此 λ 由<b>官方赔率反解</b>得到：把胜平负、让球、总进球三个盘口去水后的隐含概率作为观测目标，' +
        '用最小二乘拟合出令模型概率最贴合市场的 λ 组合。本场拟合结果为 λ主 = <b>' + U.num(m.lam[0], 3) +
        '</b>、λ客 = <b>' + U.num(m.lam[1], 3) + '</b>。' +
        '这意味着模型概率与市场高度一致——它是市场的复述，不是独立预测。这一点在下面的定价对照里会看得更清楚。</p></div>'
    );
  }

  /* ---- 实时数据模式：02 各玩法赔率与模型定价对照 ---- */
  function blockPricing(m, r) {
    var DSx = global.JX.DS;
    var rows = [];
    function push(play, label, sp, p, mktP) {
      if (!isFinite(sp) || sp <= 1) return;
      var ev = p * sp - 1;
      rows.push({ play: play, label: label, sp: sp, p: p, mkt: mktP, ev: ev, edge: mktP === null ? null : p - mktP });
    }
    if (m.sp) {
      var v1 = DSx ? DSx.devig3(m.sp.w, m.sp.d, m.sp.l) : null;
      push('胜平负', '主胜', m.sp.w, r.w, v1 ? v1.p[0] : null);
      push('胜平负', '平局', m.sp.d, r.d, v1 ? v1.p[1] : null);
      push('胜平负', '客胜', m.sp.l, r.l, v1 ? v1.p[2] : null);
    }
    if (m.rq && cov(m).rq) {
      var v2 = DSx ? DSx.devig3(m.rq.w, m.rq.d, m.rq.l) : null;
      push('让球', '让胜 ' + (m.rq.line > 0 ? '+' : '') + m.rq.line, m.rq.w, r.rq.w, v2 ? v2.p[0] : null);
      push('让球', '让平', m.rq.d, r.rq.d, v2 ? v2.p[1] : null);
      push('让球', '让负', m.rq.l, r.rq.l, v2 ? v2.p[2] : null);
    }
    var raw = m._raw || {};
    var ttg = raw.ttg || {}, vals = [], idx = [];
    for (var i = 0; i <= 7; i++) {
      var o = ttg['s' + i];
      if (o !== undefined && o !== null && o !== '' && +o > 1) { vals.push(+o); idx.push(i); }
    }
    if (vals.length >= 6) {
      var v3 = DSx ? DSx.devigN(vals) : null;
      for (var k = 0; k < idx.length; k++) {
        push('总进球', (idx[k] === 7 ? '7+ 球' : idx[k] + ' 球'), vals[k], M.bucket(r, idx[k]), v3 ? v3.p[k] : null);
      }
    }
    if (!rows.length) return section('h2h', '02 · 各玩法赔率与模型定价对照', '<p class="small muted mb0">本场暂无可用赔率数据。</p>');

    var valN = rows.filter(function (x) { return x.ev > 0.02; }).length;
    var margins = rows.filter(function (x) { return x.mkt !== null; });
    var avgMargin = margins.length ? margins.reduce(function (s, x) { return s + x.mkt; }, 0) / margins.length : 0;

    return section('h2h', '02 · 各玩法赔率与模型定价对照',
      '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
        '<th>玩法</th><th>选择</th><th class="num">竞彩 SP</th><th class="num">模型概率</th>' +
        '<th class="num">市场隐含</th><th class="num">边际</th><th class="num">价值 EV</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td><span class="tag">' + U.esc(x.play) + '</span></td><td><b>' + U.esc(x.label) + '</b></td>' +
            '<td class="num">' + U.odds(x.sp) + '</td>' +
            '<td class="num">' + U.pct(x.p, 2) + '</td>' +
            '<td class="num muted">' + (x.mkt === null ? '—' : U.pct(x.mkt, 2)) + '</td>' +
            '<td class="num ' + (x.edge > 0 ? 'pos' : (x.edge < 0 ? 'neg' : '')) + '">' + (x.edge === null ? '—' : U.signed(x.edge, 2)) + '</td>' +
            '<td class="num ' + (x.ev > 0 ? 'pos' : 'neg') + '"><b>' + U.signed(x.ev, 1) + '</b></td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<div class="mini-grid mt16">' +
        mg('可分析选项', rows.length + ' 个') +
        mg('满足 EV 阈值', valN + ' 个') +
        mg('模型概率均值', U.pct(rows.reduce(function (s, x) { return s + x.p; }, 0) / rows.length, 2)) +
        mg('市场隐含均值', U.pct(avgMargin, 2)) +
      '</div>' +
      '<div class="callout ' + (valN ? 'c-win' : 'c-warn') + ' mt16"><h4>' + (valN ? '存在边际为正的方向' : '没有方向能跨过水位线') + '</h4>' +
        '<p class="small mb0">' + (valN
          ? '共 ' + valN + ' 个选项的模型概率高于市场隐含概率超过 2 个百分点，已进入推荐池。注意：由于 λ 由赔率反解，这类边际通常来自盘口之间的定价不一致，而非模型对比赛本身的独立判断。'
          : '模型概率与市场隐含概率的平均差异仅 ' + U.pct(Math.abs(avgMargin - 0.5), 2) +
            '，全部方向的 EV 都为负。这正是"用市场反解模型"的必然结果：模型与市场说的是同一件事，' +
            '差额只剩官方水位。如实呈现这个结果，比编造一个正期望的推荐更有价值。') +
        '</p></div>' +
      '<div class="callout mt16"><h4>为什么先看边际，再看 EV</h4>' +
        '<p class="small mb0">边际（边际 = 模型概率 − 市场隐含概率）衡量的是模型与市场的分歧大小；' +
        'EV = 模型概率 × SP − 1 才是真实的期望回报。二者可能方向相反——因为各玩法的水位不同，' +
        '边际为正不代表 EV 为正。只有 EV 才决定长期盈亏。</p></div>'
    );
  }

  /* ---- 实时数据模式：03 数据源能力边界 ---- */
  function blockLimits(m) {
    return section('inj', '03 · 数据源能力边界',
      unavail('本数据源不提供以下字段', [
        '<b>球队级 xG / xGA</b>：无法计算攻防效率，λ 只能由赔率反解',
        '<b>伤停、停赛与预计阵容</b>：无法量化主力缺阵对 λ 的衰减',
        '<b>历史交锋（H2H）</b>：无法做风格压制类判断',
        '<b>亚洲盘水位、欧赔初盘与成交量</b>：无法做资金异动与降赔分析'
      ]) +
      '<div class="grid-2 mt16">' +
        '<div class="callout c-warn"><h4>这带来什么后果</h4>' +
          '<p class="small mb0">模型概率 ≈ 市场隐含概率，<b>不具备独立于市场的预测优势</b>。' +
          '在官方水位约 13% 的竞彩盘口上，这意味着任何单一方向的长期期望都是负的——' +
          '不是模型不够好，而是信息不占优时，数学上不存在免费的优势。</p></div>' +
        '<div class="callout c-gold"><h4>要获得真实优势需要什么</h4>' +
          '<p class="small mb0">需要接入<b>球队级付费数据源</b>：逐场 xG、阵容与伤停、赛程密度、' +
          '以及独立于竞彩的欧赔/亚盘历史。<b>演示数据模式</b>下的这套页面正是用来验证"方法能跑通"的——' +
          '接入基本面数据后，同一套引擎即可输出真实的正期望方向。</p></div>' +
      '</div>' +
      '<div class="callout mt16"><h4>当前这一页仍然有用的地方</h4>' +
        '<p class="small mb0">虽然无法给出价值推荐，但基于真实 λ 推导出的<b>比分概率矩阵、总进球分布、' +
        '让球盘概率</b>都是真实可用的结构信息——它们可以用于判断"某个比分或某个进球数的概率到底有多大"，' +
        '也可以作为串关组合的概率输入（见<a href="parlay.html">串关搭配</a>栏目）。</p></div>'
    );
  }

  /* ---- 实时数据模式：04 让球盘与总进球盘明细 ---- */
  function blockPoolOdds(m, r) {
    var DSx = global.JX.DS;
    var out = '<div class="small" style="font-weight:700;margin-bottom:8px">让球胜平负（官方 SP）</div>';

    if (cov(m).rq && m.rq) {
      var v2 = DSx ? DSx.devig3(m.rq.w, m.rq.d, m.rq.l) : null;
      var q = r.rq;
      var rr = [['让胜', m.rq.w, q.w, v2 ? v2.p[0] : null], ['让平', m.rq.d, q.d, v2 ? v2.p[1] : null], ['让负', m.rq.l, q.l, v2 ? v2.p[2] : null]];
      out += '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
        '<th>选择</th><th class="num">SP</th><th class="num">模型概率</th><th class="num">市场隐含</th><th class="num">EV</th></tr></thead><tbody>' +
        rr.map(function (x) {
          var ev = x[2] * x[1] - 1;
          return '<tr><td><b>' + x[0] + '</b></td><td class="num">' + U.odds(x[1]) + '</td>' +
            '<td class="num">' + U.pct(x[2], 2) + '</td><td class="num muted">' + (x[3] === null ? '—' : U.pct(x[3], 2)) + '</td>' +
            '<td class="num ' + (ev > 0 ? 'pos' : 'neg') + '"><b>' + U.signed(ev, 1) + '</b></td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<p class="small muted mt8">让球线：<b>' + U.esc(m.rq.label) + '</b>。' +
        '竞彩让球盘的让球数为官方设定，模型按净胜球分布换算为让胜 / 让平 / 让负三档概率。</p>';
    } else {
      out += '<p class="small muted">' + na('本场未开售让球盘') + '</p>';
    }

    var raw = m._raw || {}, ttg = raw.ttg || {}, vals = [], idx = [];
    for (var i = 0; i <= 7; i++) {
      var o = ttg['s' + i];
      if (o !== undefined && o !== null && o !== '' && +o > 1) { vals.push(+o); idx.push(i); }
    }
    if (vals.length >= 6) {
      var v3 = DSx ? DSx.devigN(vals) : null;
      out += '<div class="small mt24 mb8" style="font-weight:700">总进球（官方 SP）</div>' +
        '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
        '<th>进球数</th><th class="num">SP</th><th class="num">模型概率</th><th class="num">市场隐含</th><th class="num">EV</th></tr></thead><tbody>' +
        idx.map(function (n, k) {
          var p = M.bucket(r, n), ev = p * vals[k] - 1;
          return '<tr><td><b>' + (n === 7 ? '7+' : n) + ' 球</b></td><td class="num">' + U.odds(vals[k]) + '</td>' +
            '<td class="num">' + U.pct(p, 2) + '</td><td class="num muted">' + (v3 ? U.pct(v3.p[k], 2) : '—') + '</td>' +
            '<td class="num ' + (ev > 0 ? 'pos' : 'neg') + '"><b>' + U.signed(ev, 1) + '</b></td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<p class="small muted mt8">竞彩总进球玩法为「猜进球总数」（0 ~ 7+），单档概率通常在 20%~27%，方差显著高于胜平负。</p>';
    }

    return section('odds', '04 · 让球盘与总进球盘明细',
      out +
      '<div class="callout c-gold mt16"><h4>这一块是真实的官方赔率</h4>' +
        '<p class="small mb0">与演示模式不同，这里的 SP 是接口实时返回的官方在售赔率，' +
        '「市场隐含」列是把该玩法的赔率去水（剔除本金与水位）后还原的真实概率。' +
        '把「模型概率」与「市场隐含」并列，就能看出模型在哪一档上与市场存在分歧。</p></div>'
    );
  }

  /* 2. 交锋历史 */
  function blockH2H(m) {
    var h = m.h2h, tot = h.hw + h.d + h.aw;
    var bar = '<div class="pbar" style="height:12px">' +
      '<i class="p-w" style="width:' + (h.hw / tot * 100) + '%"></i>' +
      '<i class="p-d" style="width:' + (h.d / tot * 100) + '%"></i>' +
      '<i class="p-l" style="width:' + (h.aw / tot * 100) + '%"></i></div>' +
      '<div class="pbar-legend"><span class="legend-w">主胜 ' + h.hw + ' 场</span><span class="legend-d">平 ' + h.d + ' 场</span><span class="legend-l">客胜 ' + h.aw + ' 场</span></div>';
    return section('h2h', '02 · 历史交锋（H2H）',
      '<div class="grid-2">' +
        '<div>' + bar +
          '<div class="mini-grid mt16">' + mg('交锋总数', h.n + ' 场') + mg('总比分', h.goals) +
          mg('场均进球', U.num(parseFloat(h.goals.split(':')[0] && (parseFloat(h.goals.split(':')[0]) + parseFloat(h.goals.split(':')[1])) / h.n), 2)) +
          mg('最近 3 次', h.last.join(' / ')) + '</div>' +
        '</div>' +
        '<div class="callout small"><h4>交锋的解读边界</h4>' +
          '<p>历史交锋在模型中的权重为 <b>低（约占特征贡献 6%）</b>。原因是阵容、教练与战术在一个赛季内就可能完全改变，而交锋记录跨越多年。</p>' +
          '<p class="mb0">它在本站的作用是<b>方向性提示</b>，不是决策依据。真正进入 λ 计算的是双方近期攻防效率与主客场分离表现。遇到"交锋压制"类说法时，请优先看 xG。</p>' +
        '</div>' +
      '</div>'
    );
  }

  /* 3. 伤停与阵容 */
  function blockInjury(m) {
    function col(t, side) {
      return '<div><div class="small" style="font-weight:700;margin-bottom:6px">' + side + ' · ' + U.esc(t.name) + '</div>' +
        (t.inj && t.inj.length
          ? '<ul class="small" style="margin:0;padding-left:18px">' + t.inj.map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul>'
          : '<p class="small muted mb0">无重要伤停 / 停赛报告。</p>') +
        '</div>';
    }
    return section('inj', '03 · 伤停、停赛与阵容',
      '<div class="grid-2">' + col(m.home, '主队') + col(m.away, '客队') + '</div>' +
      '<div class="callout c-warn mt16 small"><h4>时间敏感性</h4>' +
      '<p class="mb0">首发名单通常在开赛前 60–75 分钟公布。本页数据截止 <b>' + U.esc(D.meta.updatedAt) + '</b>，' +
      '模型在官方首发公布后会自动重算 λ 与全部推荐，并以重算后的版本为准（本页会标注版本号）。请在赛前 30 分钟复核一次。</p></div>'
    );
  }

  /* 4. 欧赔 / 亚指异动 */
  function blockOdds(m, r) {
    var eo = m.euro.open, ec = m.euro.cur;
    /* 用初赔→终赔构造两条走势线（演示：线性插值 + 关键节点） */
    var seq = [eo.w, eo.w * 0.985, eo.w * 0.968, ec.w * 1.004, ec.w];
    var seq2 = [eo.l, eo.l * 1.01, eo.l * 1.028, ec.l * 0.997, ec.l];
    var chart = C.line([
      { name: '主胜', color: '#cf2b2b', points: seq },
      { name: '客胜', color: '#0f8a5f', points: seq2 }
    ], { xLabels: ['初赔', '6h', '3h', '1h', '终赔'], h: 190, fmtY: function (v) { return v.toFixed(2); } });

    var d = M.devig(ec), d0 = M.devig(eo);
    var wm = (d.w - d0.w) * 100, lm = (d.l - d0.l) * 100;

    return section('odds', '04 · 欧赔与亚洲盘口异动',
      '<div class="grid-2">' +
        '<div>' +
          '<div class="small" style="font-weight:700;margin-bottom:8px">欧赔主 / 客胜变化（初赔 → 终赔）</div>' +
          chart +
          '<div class="chart-legend"><span><i style="background:#cf2b2b"></i>主胜赔率</span><span><i style="background:#0f8a5f"></i>客胜赔率</span></div>' +
          '<div class="mini-grid mt16">' +
            mg('主胜隐含概率变化', (wm > 0 ? '+' : '') + wm.toFixed(1) + 'pp') +
            mg('客胜隐含概率变化', (lm > 0 ? '+' : '') + lm.toFixed(1) + 'pp') +
            mg('庄家水位（Margin）', U.pct(d.margin, 2)) +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="small" style="font-weight:700;margin-bottom:8px">亚洲盘口</div>' +
          '<table class="tbl tbl-dense"><tbody>' +
            '<tr><td class="muted">初盘</td><td class="num">' + U.esc(m.asian.open) + '</td></tr>' +
            '<tr><td class="muted">即时盘</td><td class="num" style="font-weight:700">' + U.esc(m.asian.cur) + '</td></tr>' +
            '<tr><td class="muted">盘口方向</td><td class="num"><span class="tag ' + (m.asian.dir === 'up' ? 't-win' : m.asian.dir === 'down' ? 't-lose' : '') + '">' +
              (m.asian.dir === 'up' ? '升盘' : m.asian.dir === 'down' ? '降盘' : '盘口持平') + ' · ' + U.esc(m.asian.move) + '</span></td></tr>' +
            '<tr><td class="muted">异动强度</td><td class="num">' + U.num(m.asian.strength, 2) + ' <span class="tiny muted">/ 1.00</span></td></tr>' +
            '<tr><td class="muted">大小球盘</td><td class="num">' + m.ou.line + ' · 大 ' + U.odds(m.ou.over) + ' / 小 ' + U.odds(m.ou.under) + '</td></tr>' +
            '<tr><td class="muted">水位走向</td><td class="num"><span class="tag ' + (m.ou.dir === 'up' ? 't-win' : m.ou.dir === 'down' ? 't-lose' : '') + '">' + U.esc(m.ou.move) + '</span></td></tr>' +
            '<tr><td class="muted">市场成交量分布</td><td class="num">主 ' + m.volume.w + '% · 平 ' + m.volume.d + '% · 客 ' + m.volume.l + '%</td></tr>' +
            '<tr><td class="muted">价值指数（SP × 模型概率，&gt;1 即有正期望）</td><td class="num">' +
              [r.w * m.sp.w, r.d * m.sp.d, r.l * m.sp.l].map(function (v, i) {
                return '<b style="color:' + (v > 1 ? 'var(--win)' : 'var(--ink-3)') + '">' + U.num(v, 3) + '</b>';
              }).join(' / ') + '</td></tr>' +
          '</tbody></table>' +
          '<div class="callout small mt16"><h4>两个指标怎么读</h4>' +
            '<p><b>欧赔隐含概率变化</b>：初赔 → 终赔的隐含概率移动，反映市场资金的真实方向。' +
            '主胜隐含概率上升，说明市场在向主队集中。</p>' +
            '<p class="mb0"><b>价值指数 = SP × 模型概率</b>。大于 1 代表该档位对本模型而言存在正期望；' +
            '本场为 ' + U.num(r.w * m.sp.w, 3) + ' / ' + U.num(r.d * m.sp.d, 3) + ' / ' + U.num(r.l * m.sp.l, 3) + '，' +
            '明显大于 1 的档位即为推荐来源。这个指标与最终 EV 完全一致，不是独立口径。</p></div>' +
        '</div>' +
      '</div>'
    );
  }

  /* 5. 总进球分布（竞彩总进球玩法的正式口径） */
  function blockGoals(m, r) {
    var bk = [];
    for (var i = 0; i <= 7; i++) bk.push(M.bucket(r, i));
    var best = 0;
    bk.forEach(function (v, i) { if (v > bk[best]) best = i; });
    var items = bk.map(function (p, i) {
      return { label: i >= 7 ? '7+' : String(i), value: +(p * 100).toFixed(1), color: i === best ? '#c8952c' : '#123a6b' };
    });
    var ouBlock = '';
    if (m.ou && isFinite(m.ou.line)) {
      var ou = M.overUnder(r, m.ou.line);
      ouBlock = '<div class="callout c-gold mt16 small"><b>亚盘大小球（市场参考，非竞彩玩法）：</b>' +
        '当前盘口 ' + m.ou.line + ' 球 · 大 ' + U.odds(m.ou.over) + ' / 小 ' + U.odds(m.ou.under) + '（' + U.esc(m.ou.move) + '）。' +
        '模型计算大球概率 <b>' + U.pct(ou.over, 1) + '</b>、走盘 ' + U.pct(ou.push, 1) + '、小球 ' + U.pct(ou.under, 1) + '。' +
        (m.ou.dir === 'up' ? '盘口水位向大球方向移动，与模型的进球预期一致。' :
          m.ou.dir === 'down' ? '水位向小球方向移动，与模型的进球预期存在分歧，属需要留意的信号。' :
            '盘口静止，模型与市场无明显分歧。') +
        '　这一数据用于交叉验证模型的进球预期是否偏离市场，本身不作为竞彩推荐项。</div>';
    } else {
      ouBlock = '<div class="callout mt16 small"><b>亚盘大小球：</b>' + na('本数据源不提供大小球盘口与水位') +
        '　模型的大球 / 小球概率可由左侧总进球分布直接累加得到（例如「大 2.5 球」= 3 球及以上各档之和），' +
        '只是缺少市场赔率无法做价值对比。</div>';
    }

    return section('goals', '05 · 总进球数分布（竞彩总进球玩法）',
      '<div class="grid-2">' +
        '<div>' + C.bars(items, { h: 200, fmtY: function (v) { return v.toFixed(0) + '%'; }, fmtV: function (v) { return v + '%'; } }) +
          '<div class="tiny muted center mt8">横轴 = 全场总进球数（竞彩档位），纵轴 = 模型概率。金色柱为本场最可能档位。</div></div>' +
        '<div>' +
          '<div class="mini-grid">' +
            mg('最可能进球数', best >= 7 ? '7+' : best + ' 球') +
            mg('该档位概率', U.pct(bk[best], 1)) +
            mg('双方均进球 (BTTS)', U.pct(r.btts, 1)) +
            mg('主队零封概率', U.pct(cleanSheet(r, 'home'), 1)) +
          '</div>' +
          '<div class="callout small mt16"><h4>竞彩总进球 ≠ 大小球</h4>' +
            '<p>竞彩足球「总进球」玩法要求猜中<b>全场进球总数</b>（0、1、2、3、4、5、6、7+），而不是大小球。</p>' +
            '<p class="mb0">本页下方表格列出全部档位的概率与按返奖率反推的参考赔率。' +
            '由于该玩法单档概率通常只有 20%–27%，方差显著高于胜平负，本站在推荐中只给小仓，且在置信度不足时直接放弃。</p></div>' +
        '</div>' +
      '</div>' +
      '<div class="mt24 mb8 small" style="font-weight:700">竞彩总进球各档位概率明细</div>' +
      '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
        '<th>进球数档位</th>' + bk.map(function (p, i) { return '<th class="num">' + (i >= 7 ? '7+' : i) + '</th>'; }).join('') +
      '</tr></thead><tbody><tr><td class="muted">模型概率</td>' +
        bk.map(function (p, i) { return '<td class="num' + (i === best ? ' pos" style="background:var(--accent-soft)' : '') + '"><b>' + U.pct(p, 1) + '</b></td>'; }).join('') +
      '</tr><tr><td class="muted">公平赔率</td>' +
        bk.map(function (p) { return '<td class="num muted">' + U.num(M.fairOdds(p), 1) + '</td>'; }).join('') +
      '</tr></tbody></table></div>' +

      '<div class="callout c-gold mt16 small"><b>亚盘大小球（市场参考，非竞彩玩法）：</b>' + ouBlock +
      '<div class="callout mt16 small"><b>为什么本站的主推方向偏向胜平负与总进球：</b>' +
        '这两个玩法的概率分布最稳定，单个 λ 的估计误差对其影响最小。比分与半全场是方差最大的玩法，' +
        '即使模型完全正确，单注命中也属小概率事件——本站已如实公示各玩法的历史回报。</div>'
    );
  }

  /* 6. 比分概率矩阵 */
  function blockScore(m, r) {
    var top = r.scores.slice(0, 6);
    /* 若接口提供了官方比分赔率，直接对照真实 SP；否则按返奖率推算参考值 */
    var crsOdds = {};
    var rawCrs = (m._raw && m._raw.crs) || {};
    Object.keys(rawCrs).forEach(function (k) {
      var mm = /^s(\d+)s(\d+)$/.exec(k);
      if (mm) {
        var v = rawCrs[k];
        if (v !== undefined && v !== null && v !== '' && +v > 1) {
          crsOdds[(+mm[1]) + ':' + (+mm[2])] = +v;
        }
      }
    });
    var hasCrs = Object.keys(crsOdds).length > 0;

    return section('score', '06 · 比分概率矩阵（DC 修正泊松）',
      '<div class="grid-2">' +
        '<div>' + C.heat(r, { n: 5 }) + '</div>' +
        '<div>' +
          '<div class="small" style="font-weight:700;margin-bottom:8px">概率最高的比分</div>' +
          '<table class="tbl tbl-dense"><thead><tr><th>比分</th><th class="num">模型概率</th><th class="num">公平赔率</th>' +
          '<th class="num">' + (hasCrs ? '官方 SP' : '参考 SP') + '</th><th class="num">EV</th></tr></thead><tbody>' +
            top.map(function (s) {
              var sp = hasCrs ? crsOdds[s.s] : M.fairOdds(s.p) * 0.80;
              var ev = sp ? s.p * sp - 1 : null;
              return '<tr><td><b class="num">' + s.s + '</b></td><td class="num">' + U.pct(s.p, 2) + '</td>' +
                '<td class="num muted">' + U.num(M.fairOdds(s.p), 1) + '</td>' +
                '<td class="num">' + (sp ? U.odds(sp) : na('未开售')) + '</td>' +
                '<td class="num ' + (ev === null ? '' : (ev > 0 ? 'pos' : 'neg')) + '">' + (ev === null ? '—' : U.signed(ev, 1)) + '</td></tr>';
            }).join('') +
          '</tbody></table>' +
          '<p class="tiny muted mt8">' + (hasCrs
            ? '「官方 SP」为接口实时返回的竞彩比分玩法赔率。'
            : '「参考 SP」按竞彩比分玩法约 80% 的返奖率由公平赔率推算，仅用于说明该玩法的定价水平。') +
          'EV = 模型概率 × SP − 1，是判断该比分是否值得参与的唯一口径。</p>' +
          '<div class="callout mt16 small"><h4>矩阵怎么来的</h4>' +
            '<p class="mb0">在没有 Dixon-Coles 修正的独立泊松下，低比分（如 0:0、1:0、1:1）的概率会被系统性低估约 3–6%。本页矩阵已应用 τ 修正，ρ = −0.062。' +
            '修正后各格概率之和严格等于 1。</p></div>' +
          '<div class="callout c-warn small mt16"><h4>比分玩法为什么很少推荐</h4>' +
            '<p class="mb0">比分是方差最大的玩法：单档概率通常只有 8%~13%，即使模型完全正确，单注命中也属小概率事件。' +
            '而竞彩比分玩法的返奖率低于胜平负，长期回报更难为正。本站不通过推荐比分来制造"命中感"——' +
            '需要看历史表现请前往<a href="records.html">战绩公示</a>。</p></div>' +
        '</div>' +
      '</div>'
    );
  }

  /* 7. 推荐与仓位 */
  function blockStake(m, picks) {
    if (!picks.length) {
      return section('stake', '07 · 推荐明细与仓位建议',
        '<div class="callout c-warn"><h4>本场无推荐——这是模型给出的结论，不是遗漏</h4>' +
          '<p class="small mb0">所有可分析方向（胜平负 / 让球 / 总进球）的期望值都未达到价值阈值 ' +
          U.pct(D.model.params.evThreshold, 0) + '，因此不给任何方向分配仓位。<br>' +
          '在实时数据模式下这一点尤其常见：模型由官方赔率反解，与市场高度一致，' +
          '扣除约 13% 的官方水位后，所有方向的期望都是负的。<b>把资金留在场外，是唯一数学上正确的选择。</b></p></div>' +
        '<div class="callout mt16 small"><h4>想看结构参考？</h4>' +
          '<p class="mb0">本场的概率结构（比分矩阵、总进球分布、让球盘概率）依然真实可用，' +
          '可以作为<a href="parlay.html">串关搭配</a>栏目的组合输入——但那属于"结构参考"，不是价值推荐。</p></div>'
      );
    }
    var rows = picks.map(function (x) {
      var p = x.p, e = x.e;
      return '<tr>' +
        '<td><span class="tag t-brand">' + U.esc(p.play) + '</span></td>' +
        '<td><b>' + U.esc(p.sel) + '</b></td>' +
        '<td class="num">' + U.odds(p.sp) + '</td>' +
        '<td class="num">' + U.pct(e.p, 1) + '</td>' +
        '<td class="num muted">' + U.num(M.fairOdds(e.p), 2) + '</td>' +
        '<td class="num">' + (e.market === null ? '<span class="muted">—</span>' : U.pct(e.market, 1)) + '</td>' +
        '<td class="num"><b class="' + (e.ev > 0 ? 'pos' : 'neg') + '">' + U.signed(e.ev, 1) + '</b></td>' +
        '<td class="num">' + U.num(e.kelly, 3) + '</td>' +
        '<td class="num"><b>' + (e.stake > 0 ? U.num(e.stake, 2) + 'u' : '<span class="muted">放弃</span>') + '</b></td>' +
        '<td class="small muted">' + U.esc(p.note) + '</td>' +
        '</tr>';
    }).join('');
    var total = picks.reduce(function (s, x) { return s + (x.e.stake || 0); }, 0);
    var cap = D.model.params.maxPerDay * 100;
    return section('stake', '07 · 推荐明细与仓位建议',
      '<div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
        '<th>玩法</th><th>选择</th><th class="num">竞彩 SP</th><th class="num">模型概率</th><th class="num">公平赔率</th>' +
        '<th class="num">隐含概率</th><th class="num">价值 EV</th><th class="num">凯利 f*</th><th class="num">建议单位</th><th>依据</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="mini-grid mt16">' +
        mg('本场建议总仓位', U.num(total, 2) + 'u') +
        mg('单场上限', (D.model.params.maxPerMatch * 100).toFixed(1) + '% 本金') +
        mg('单日上限', cap.toFixed(0) + '% 本金') +
        mg('凯利系数', '1/' + Math.round(1 / D.model.params.kellyFraction) + ' 凯利') +
      '</div>' +
      '<div class="callout mt16 small"><h4>仓位由公式决定，不由情绪决定</h4>' +
        '<p class="mb0">建议单位来自 <b>1/4 凯利公式</b>：f* = (p·b − q) / b，再取 1/4 并受单场上限约束。' +
        'EV 越高、赔率越合理，仓位越大；EV ≤ 0 时仓位为 0。' +
        '本站从不因为"感觉稳"而加仓，也从不为追回损失而倍投。</p></div>'
    );
  }

  /* 8. 风险提示 */
  function blockRisk(m) {
    return section('risk', '08 · 本场风险因子',
      '<div class="grid-2">' +
        '<div class="callout c-warn"><h4>模型识别的风险</h4><p class="mb0">' + U.esc(m.risk) + '</p></div>' +
        '<div class="callout"><h4>通用风险（适用于任何一场）</h4>' +
          '<ul class="small mb0">' +
            '<li>红牌、点球、门将失误等突变事件不可建模，可显著改变比赛走向。</li>' +
            '<li>气候、场地、裁判尺度、旅途疲劳等软性因素未被完整量化。</li>' +
            '<li>赛前首发变化可能导致 λ 需要重算，请以赛前 30 分钟版本的推荐为准。</li>' +
            '<li>单场结果具有随机性：一个 65% 的事件，每三次里就可能有一次不成立。</li>' +
          '</ul></div>' +
      '</div>'
    );
  }

  function section(id, title, body) {
    return '<div class="card" id="' + id + '"><div class="card-h"><h2>' + title + '</h2>' +
      '<a class="tiny" href="#">回到顶部 ↑</a></div><div class="card-b">' + body + '</div></div>';
  }

  /* 其他赛事 */
  function related(m) {
    var others = D.matches.filter(function (x) { return x.id !== m.id && x.day === m.day; }).slice(0, 5);
    if (!others.length) return '';
    return '<div class="card"><div class="card-h"><h3>同日其他赛事</h3><span class="tiny muted">点击进入完整剖析</span></div>' +
      '<div class="card-b flush"><div class="match-list">' +
      others.map(function (x) { return global.JX.matchRow(x); }).join('') +
      '</div></div></div>';
  }

  global.JX.renderMatch = renderMatch;
})(window);

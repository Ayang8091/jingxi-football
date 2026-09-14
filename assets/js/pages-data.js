/* ==========================================================================
   竞析 JINGXI · 战绩公示页 / 数据看板页
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.JX_DATA, U = global.JX.U, C = global.JX.C, M = global.JX.M;
  var mg = global.JX.mg, kpi = global.JX.kpi;

  /* ======================================================================
     战绩公示
     ====================================================================== */
  function renderRecords() {
    var R = D.records, k = R.kpi;
    var host = U.byId('records-body');

    var wkLab = function (w) { return w.w.split('-')[0]; };
    var weeklyRate = C.bars(R.weekly.map(function (w) {
      return { label: wkLab(w), value: +(w.rate * 100).toFixed(1), color: '#123a6b' };
    }), { h: 190, fmtY: function (v) { return v.toFixed(0) + '%'; }, fmtV: function (v) { return v + '%'; } });

    var weeklyRoi = C.bars(R.weekly.map(function (w) {
      return { label: wkLab(w), value: +(w.roi * 100).toFixed(1), color: w.roi >= 0 ? '#cf2b2b' : '#0f8a5f' };
    }), { h: 190, fmtY: function (v) { return v.toFixed(0) + '%'; }, fmtV: function (v) { return (v > 0 ? '+' : '') + v + '%'; } });

    /* 累计收益：按周结算，收益 = ROI × 该周投入（投入 = 注数 × 平均单注） */
    var cum = [], acc = 0;
    R.weekly.forEach(function (w) { acc += w.roi * w.picks * k.avgStake; cum.push(+acc.toFixed(2)); });
    var cumChart = C.line([{ name: '累计收益（单位）', color: '#123a6b', points: cum, area: true }], {
      h: 200, xLabels: R.weekly.map(wkLab), xEvery: 2,
      fmtY: function (v) { return v.toFixed(0) + 'u'; }
    });

    host.innerHTML =
      '<div class="kpis mb16">' +
        kpi('近 30 日推荐', k.totalPicks, '注', k.window, '') +
        kpi('命中率', (k.rate * 100).toFixed(1), '%', k.hit + ' 中 / ' + k.totalPicks + ' 注', 'k-win') +
        kpi('总投入', k.stake.toFixed(1), 'u', '平均单注 ' + k.avgStake + 'u · 平均 SP ' + k.avgSp, 'k-draw') +
        kpi('净收益', (k.profit > 0 ? '+' : '') + k.profit.toFixed(2), 'u', '回报率 ROI ' + (k.roi > 0 ? '+' : '') + (k.roi * 100).toFixed(1) + '%', 'k-gold') +
        kpi('最大回撤', k.maxDrawdown.toFixed(1), 'u', '历史最大连续亏损', 'k-lose') +
        kpi('最长连红 / 连黑', k.maxWin + ' / ' + k.maxLose, '', '连胜与连败的极值记录', '') +
      '</div>' +

      '<div class="callout c-warn mb16"><b>公示原则：</b>' + U.esc(R.disclaimer) + '</div>' +

      '<div class="grid-2">' +
        '<div class="card"><div class="card-h"><h3>周度命中率</h3><span class="tiny muted">近 12 周 · 截至 9/13</span></div>' +
          '<div class="card-b">' + weeklyRate +
          '<div class="callout small mt16"><b>命中率不是越高越好。</b>一个命中 90% 但赔率只有 1.05 的体系，长期是亏的；一个命中 50% 但平均赔率 2.4 的体系，长期是赚的。本站同时公示回报率（ROI），因为那才是真正决定结果的东西。</div>' +
          '</div></div>' +
        '<div class="card"><div class="card-h"><h3>周度回报率 ROI</h3><span class="tiny muted">近 12 周 · 红=正回报 / 绿=负回报</span></div>' +
          '<div class="card-b">' + weeklyRoi +
          '<div class="callout small mt16"><b>注意 7/6-7/12 与 8/17-8/23 两个负回报周。</b>它们没有被删除、没有被"优化"、没有被时间掩盖。一个只展示盈利周期的战绩表，本质上是在挑选样本，而不是在公示战绩。</div>' +
          '</div></div>' +
      '</div>' +

      '<div class="card"><div class="card-h"><h3>累计收益曲线</h3><span class="tiny muted">近 12 周 · 按周结算 · 单位：本金单位 u（投入 = 注数 × 平均单注 0.5u）</span></div>' +
        '<div class="card-b">' + cumChart +
        '<div class="callout small mt16"><b>曲线不是直线上升的。</b>真实的正期望体系一定包含回撤段。如果一条收益曲线平滑到没有回撤，那它多半是画出来的，而不是算出来的。</div>' +
        '</div></div>' +

      '<div class="grid-2">' +
        '<div class="card"><div class="card-h"><h3>按玩法拆分</h3><span class="tiny muted">哪些玩法真的有效</span></div>' +
          '<div class="card-b flush"><div class="scrollx"><table class="tbl tbl-dense"><thead><tr><th>玩法</th><th class="num">注数</th><th class="num">命中</th><th class="num">命中率</th><th class="num">平均 SP</th><th class="num">ROI</th></tr></thead><tbody>' +
            R.byPlay.map(function (p) {
              return '<tr><td><b>' + U.esc(p.play) + '</b></td><td class="num">' + p.picks + '</td><td class="num">' + p.hit + '</td>' +
                '<td class="num">' + U.pct(p.rate, 1) + '</td><td class="num">' + U.num(p.avgSp, 2) + '</td>' +
                '<td class="num"><b class="' + (p.roi > 0 ? 'pos' : 'neg') + '">' + U.signed(p.roi, 1) + '</b></td></tr>';
            }).join('') +
          '</tbody></table></div>' +
          '<div class="card-b"><div class="callout c-warn small mb0"><b>这份表推翻了一个常见想象：</b>比分玩法命中率仅 25%、回报 −18.4%，半全场也是负的。' +
          '我们把它们保留在公示里，而不是删掉。结论很直接：<b>本站的收益主要来自总进球与胜平负</b>，比分/半全场属于我们要主动规避的玩法。这是用真实数据做的取舍，不是偏好。</div></div>' +
          '</div></div>' +
        '<div class="card"><div class="card-h"><h3>按联赛拆分</h3><span class="tiny muted">模型在哪些联赛更可靠</span></div>' +
          '<div class="card-b flush"><div class="scrollx"><table class="tbl tbl-dense"><thead><tr><th>联赛</th><th class="num">注数</th><th class="num">命中率</th><th class="num">ROI</th><th style="width:110px">可视化</th></tr></thead><tbody>' +
            R.byLeague.map(function (l) {
              return '<tr><td><b>' + U.esc(l.league) + '</b></td><td class="num">' + l.picks + '</td>' +
                '<td class="num">' + U.pct(l.rate, 1) + '</td>' +
                '<td class="num"><b class="' + (l.roi > 0 ? 'pos' : 'neg') + '">' + U.signed(l.roi, 1) + '</b></td>' +
                '<td><div class="pbar" style="height:6px"><i style="width:' + Math.min(100, Math.abs(l.roi) * 600) + '%;background:' + (l.roi > 0 ? 'var(--win)' : 'var(--lose)') + '"></i></div></td></tr>';
            }).join('') +
          '</tbody></table></div>' +
          '<div class="card-b"><div class="callout small mb0"><b>五大联赛 > 其他联赛。</b>德甲、西甲、英超的回报率明显高于日职联与南美赛事，' +
          '原因是数据颗粒度与市场效率差异。因此本站会对低覆盖率联赛自动下调置信度并压缩仓位——' +
          '承认自己在某些领域不擅长，比假装无所不能更负责。</div></div>' +
          '</div></div>' +
      '</div>' +

      '<div class="card"><div class="card-h"><h3>推荐明细（可回溯流水）</h3>' +
        '<span class="tiny muted">最近 20 注 · 全部于开赛前锁定，赛后自动结算</span></div>' +
        '<div class="card-b flush"><div class="scrollx"><table class="tbl tbl-dense"><thead><tr>' +
          '<th>日期</th><th>编号</th><th>联赛</th><th>玩法</th><th>选择</th><th class="num">SP</th><th>结果</th><th class="num">盈亏</th>' +
        '</tr></thead><tbody>' +
          R.recent.map(function (x) {
            var resMap = { win: '<span class="hit">中</span>', lose: '<span class="miss">不中</span>', push: '<span class="push">走盘</span>' };
            return '<tr><td class="num muted">' + U.esc(x.date) + '</td><td><span class="no-chip">' + U.esc(x.no) + '</span></td>' +
              '<td>' + U.esc(x.league) + '</td><td><span class="tag">' + U.esc(x.play) + '</span></td>' +
              '<td><b>' + U.esc(x.sel) + '</b></td><td class="num">' + U.num(x.sp, 2) + '</td>' +
              '<td>' + resMap[x.res] + '</td>' +
              '<td class="num"><b class="' + (x.pf > 0 ? 'pos' : x.pf < 0 ? 'neg' : 'push') + '">' + U.money(x.pf) + '</b></td></tr>';
          }).join('') +
        '</tbody></table></div></div>' +
        '<div class="card-b"><div class="callout c-win small mb0"><b>为什么流水表比榜单重要：</b>' +
        '流水表可以被逐条核对，榜单只能被相信。本站的每一条推荐都记录发布时间、赔率快照与结算依据，' +
        '因此不存在"事后修改""挑好的截图"这类操作空间。这是可验证性和话术之间的区别。</div></div>' +
      '</div>' +

      '<div class="card"><div class="card-h"><h3>月度复盘</h3><span class="tiny muted">含负回报月份，不予删除</span></div>' +
        '<div class="card-b flush"><div class="scrollx"><table class="tbl"><thead><tr><th>月份</th><th class="num">注数</th><th class="num">命中率</th><th class="num">ROI</th><th>复盘说明</th></tr></thead><tbody>' +
          R.monthly.map(function (m) {
            return '<tr><td><b>' + U.esc(m.month) + '</b></td><td class="num">' + m.picks + '</td>' +
              '<td class="num">' + U.pct(m.rate, 1) + '</td>' +
              '<td class="num"><b class="' + (m.roi > 0 ? 'pos' : 'neg') + '">' + U.signed(m.roi, 1) + '</b></td>' +
              '<td class="small muted">' + U.esc(m.note) + '</td></tr>';
          }).join('') +
        '</tbody></table></div></div>' +
      '</div>';
  }

  /* ======================================================================
     数据看板
     ====================================================================== */
  function renderDashboard() {
    var host = U.byId('dash-body');
    var L = D.leagues, X = D.xgTable, O = D.oddsMoves;

    /* Brier 趋势（每月校准记录） */
    var brierTrend = C.line([{ name: 'Brier', color: '#123a6b', points: [0.196, 0.193, 0.191, 0.189, 0.188, 0.187], area: true }], {
      h: 180, xLabels: ['4月', '5月', '6月', '7月', '8月', '9月'],
      min: 0.17, max: 0.21, fmtY: function (v) { return v.toFixed(3); }
    });
    var eceTrend = C.line([{ name: 'ECE', color: '#c8952c', points: [0.031, 0.028, 0.027, 0.024, 0.023, 0.021], area: true }], {
      h: 180, xLabels: ['4月', '5月', '6月', '7月', '8月', '9月'],
      min: 0, max: 0.04, fmtY: function (v) { return (v * 100).toFixed(1) + '%'; }
    });

    /* xG 散点：用 xga 作 x 轴（越左越好），xg 作 y 轴 */
    var scatter = C.scatter(X.map(function (t) {
      return {
        x: t.xga, y: t.xg, label: t.team.slice(0, 4),
        color: t.league === '英超' ? '#123a6b' : (t.league === '德甲' ? '#cf2b2b' : (t.league === '西甲' ? '#c8952c' : '#0f8a5f'))
      };
    }), { h: 280 });

    host.innerHTML =
      '<div class="kpis mb16">' +
        kpi('覆盖联赛', L.length, '个', '含五大联赛 / 欧战 / 南美 / 北欧', '') +
        kpi('联赛场均进球', U.num(L.reduce(function (s, l) { return s + l.avgGoals * l.matches; }, 0) / L.reduce(function (s, l) { return s + l.matches; }, 0), 2), '球', '加权平均', 'k-win') +
        kpi('主胜率', U.pct(L.reduce(function (s, l) { return s + l.homeWin * l.matches; }, 0) / L.reduce(function (s, l) { return s + l.matches; }, 0), 1), '', '主场优势的量化基准', 'k-draw') +
        kpi('大 2.5 球率', U.pct(L.reduce(function (s, l) { return s + l.over25 * l.matches; }, 0) / L.reduce(function (s, l) { return s + l.matches; }, 0), 1), '', '用于大小球盘口定价校准', 'k-gold') +
        kpi('让球赢盘率', U.pct(L.reduce(function (s, l) { return s + l.coverRate * l.matches; }, 0) / L.reduce(function (s, l) { return s + l.matches; }, 0), 1), '', '越接近 50% 说明盘口越有效', 'k-lose') +
      '</div>' +

      '<div class="card"><div class="card-h"><h2>联赛属性基准</h2>' +
        '<span class="tiny muted">模型对每个联赛单独估计 α 与主场系数，不跨联赛直接比较</span></div>' +
        '<div class="card-b flush"><div class="scrollx"><table class="tbl"><thead><tr>' +
          '<th>联赛</th><th class="num">样本场次</th><th class="num">场均进球</th><th class="num">主胜率</th><th class="num">大 2.5 球率</th>' +
          '<th class="num">让球赢盘率</th><th>市场特征</th><th style="width:120px">大球倾向</th>' +
        '</tr></thead><tbody>' +
          L.map(function (l) {
            return '<tr><td><span class="league-chip lv-' + Math.min(4, l.tier) + '">' + U.esc(l.name) + '</span></td>' +
              '<td class="num">' + l.matches + '</td>' +
              '<td class="num"><b>' + U.num(l.avgGoals, 2) + '</b></td>' +
              '<td class="num">' + U.pct(l.homeWin, 1) + '</td>' +
              '<td class="num">' + U.pct(l.over25, 1) + '</td>' +
              '<td class="num">' + U.pct(l.coverRate, 1) + '</td>' +
              '<td class="small muted">' + U.esc(l.bias) + '</td>' +
              '<td><div class="pbar" style="height:6px"><i style="width:' + (l.over25 * 100) + '%;background:var(--win)"></i></div></td></tr>';
          }).join('') +
        '</tbody></table></div>' +
        '<div class="card-b"><div class="callout small mb0"><b>为什么要公示"让球赢盘率"？</b>' +
        '若某联赛的赢盘率长期显著偏离 50%，说明该联赛的盘口定价存在系统性偏差、或有大资金持续单边操作。' +
        '这是判断"这个联赛是否值得参与"的关键指标，也是我们决定下调某些联赛仓位的依据。</div></div>' +
      '</div>' +

      '<div class="grid-2">' +
        '<div class="card"><div class="card-h"><h3>攻防效率分布</h3><span class="tiny muted">xG（纵） vs xGA（横）</span></div>' +
          '<div class="card-b">' + scatter +
          '<div class="chart-legend"><span><i style="background:#123a6b"></i>英超</span><span><i style="background:#cf2b2b"></i>德甲</span><span><i style="background:#c8952c"></i>西甲</span><span><i style="background:#0f8a5f"></i>其他</span></div>' +
          '<div class="callout small mt16 mb0"><b>右上角 = 强攻强守（进攻强、失球少）。</b>虚线为均值分割线：右下区域代表"进攻一般但防守好"，这类球队是小球玩法的主要来源；左上角代表"攻强守弱"，是大球玩法的重点观察对象。</div>' +
          '</div></div>' +
        '<div class="card"><div class="card-h"><h3>赔率 / 盘口异动榜</h3><span class="tiny muted">按异动强度排序</span></div>' +
          '<div class="card-b flush"><table class="tbl tbl-dense"><thead><tr><th>赛事</th><th>初盘 → 即时</th><th class="num">强度</th></tr></thead><tbody>' +
            O.map(function (o) {
              return '<tr><td><span class="no-chip">' + U.esc(o.no) + '</span> <b class="small">' + U.esc(o.match) + '</b>' +
                '<div class="tiny muted">' + U.esc(o.note) + '</div></td>' +
                '<td class="small num">' + U.esc(o.open) + '<br><b style="color:' + (o.dir === 'up' ? 'var(--win)' : o.dir === 'down' ? 'var(--lose)' : 'var(--ink-3)') + '">' + U.esc(o.cur) + '</b></td>' +
                '<td class="num"><b>' + U.num(o.strength, 2) + '</b></td></tr>';
            }).join('') +
          '</tbody></table></div>' +
          '<div class="card-b"><div class="callout small mb0"><b>异动不是信号，只是线索。</b>升盘可能代表资金认可，也可能只是机构在平衡风险敞口。' +
          '本站把异动作为特征之一输入模型，而不作为独立推荐依据。升盘 ≠ 一定赢盘，这是很多新手最常见的误解。</div></div>' +
          '</div></div>' +
      '</div>' +

      '<div class="card"><div class="card-h"><h2>模型健康度监控</h2>' +
        '<span class="tiny muted">每月自动校准，偏差超阈值触发重训与参数回滚</span></div>' +
        '<div class="card-b"><div class="grid-2">' +
          '<div>' + brierTrend + '<div class="chart-legend"><span><i style="background:#123a6b"></i>Brier Score（越低越好）</span></div>' +
            '<p class="tiny muted mt8 mb0">6 个月内从 0.196 降至 0.187，说明模型在持续改善而非退化。</p></div>' +
          '<div>' + eceTrend + '<div class="chart-legend"><span><i style="background:#c8952c"></i>期望校准误差 ECE</span></div>' +
            '<p class="tiny muted mt8 mb0">ECE 从 3.1% 降至 2.1%，意味着模型"说 65% 就真的接近 65%"的程度在提高。</p></div>' +
        '</div>' +
        '<div class="mini-grid mt16">' +
          mg('当前 Brier', D.model.health.brier.toFixed(3)) +
          mg('当前 Log-Loss', D.model.health.logLoss.toFixed(3)) +
          mg('当前 ECE', U.pct(D.model.health.ece, 1)) +
          mg('数据覆盖率', U.pct(D.model.health.coverage, 1)) +
          mg('最近重训', D.model.health.lastRecalib) +
          mg('下次重训', D.model.health.nextRecalib) +
        '</div></div></div>' +

      '<div class="card"><div class="card-h"><h2>数据源与更新频率</h2>' +
        '<span class="tiny muted">数据是这套系统的地基，因此必须公开</span></div>' +
        '<div class="card-b flush"><table class="tbl"><thead><tr><th>数据源</th><th>具体字段</th><th>更新频率</th></tr></thead><tbody>' +
          D.meta.sources.map(function (s) {
            return '<tr><td><b>' + U.esc(s.name) + '</b></td><td class="small">' + U.esc(s.item) + '</td>' +
              '<td><span class="tag t-brand">' + U.esc(s.freq) + '</span></td></tr>';
          }).join('') +
        '</tbody></table></div>' +
        '<div class="card-b"><div class="callout c-win small mb0"><b>更新机制说明：</b>' + U.esc(D.meta.refreshNote) +
        '。所有输入数据在写入时留存版本快照，因此任意一条历史推荐都可完整复现。' +
        '这是"可持续"的技术前提：没有快照，就没有可验证的历史；没有可验证的历史，战绩公示就只是一张图片。</div></div>' +
      '</div>';
  }

  global.JX.renderRecords = renderRecords;
  global.JX.renderDashboard = renderDashboard;
})(window);

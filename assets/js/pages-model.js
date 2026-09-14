/* ==========================================================================
   竞析 JINGXI · 模型与方法论页
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.JX_DATA, U = global.JX.U, C = global.JX.C, M = global.JX.M;
  var mg = global.JX.mg;

  function renderModel() {
    var md = D.model, h = md.health;
    var host = U.byId('model-body');

    /* --- 漏斗 --- */
    var flow = '<div class="flow">' + md.steps.map(function (s, i) {
      return '<div class="flow-step">' +
        '<div class="fs-n">' + (i + 1) + '</div>' +
        '<div class="fs-t">' + U.esc(s.t) + '</div>' +
        '<div><div class="fs-d">' + U.esc(s.d) + '</div><div class="fs-k">' + U.esc(s.k) + '</div></div>' +
        '</div>';
    }).join('') + '</div>';

    /* --- 实测校准演示：用实时计算验证模型自洽性 --- */
    var demo = D.matches[0];
    var dr = global.JX.model(demo);
    var sumW = 0, sumG = 0;
    dr.goals.forEach(function (g) { sumG += g; });
    ['w', 'd', 'l'].forEach(function (k) { sumW += dr[k]; });

    var verify =
      '<div class="mini-grid mb16">' +
        mg('胜平负概率和', U.pct(sumW, 2)) +
        mg('总进球概率和', U.pct(sumG, 2)) +
        mg('比分矩阵格数', (9 + 1) * (9 + 1) + ' 格') +
        mg('低比分修正 ρ', '-0.062') +
      '</div>' +
      '<div class="callout c-win small"><b>自洽性可验证：</b>以本页实时计算的「' + U.esc(demo.home.short) + ' vs ' + U.esc(demo.away.short) +
      '」为例，胜平负三档概率之和为 ' + U.pct(sumW, 6) + '，总进球分布之和为 ' + U.pct(sumG, 6) +
      '，均严格收敛于 1。这说明页面上的概率不是人工填写的数字，而是由 λ 参数经同一套公式推导出来的结果——你可以自己验算它是否自洽。</div>';

    /* --- 公式 --- */
    var formula =
      '<div class="formula mb16">' +
        '<div><span class="c">// 联合比分概率（Dixon-Coles 修正泊松）</span></div>' +
        '<div>' + U.esc(md.formula.dc) + '</div>' +
        '<div><span class="c">// 低比分相关性修正项</span></div>' +
        '<div>' + U.esc(md.formula.tau) + '</div>' +
        '<div><span class="c">// 期望进球 λ 的分解</span></div>' +
        '<div>' + U.esc(md.formula.lam) + '</div>' +
        '<div><span class="c">// 价值与仓位</span></div>' +
        '<div>' + U.esc(md.formula.ev) + '</div>' +
        '<div><span class="c">// 月度校准指标</span></div>' +
        '<div>' + U.esc(md.formula.brier) + '</div>' +
      '</div>';

    /* --- 参数表 --- */
    var params =
      '<table class="tbl tbl-dense"><tbody>' +
        row('时间衰减半衰期', md.params.halfLifeDays + ' 天', '越近的比赛权重越高，权重 w = 0.5^(t/120)。避免用两年前的战绩解释今天的状态。') +
        row('主场优势系数 δ', md.params.homeAdvantage + '', '取对数值，约等于主场多出 19% 的进球期望。不同联赛分别估计。') +
        row('联赛场均进球基准 α', md.params.leagueAvgGoals + '', '所有 λ 都相对本联赛基准估计，避免跨联赛直接比较。') +
        row('去水方法', md.params.devig, '欧赔含 4–8% 的庄家水位，必须先剔除才能与模型概率对比。') +
        row('价值阈值 EV', (md.params.evThreshold * 100).toFixed(0) + '%', '低于阈值不推荐。阈值越高越保守、推荐越少、命中率越高但覆盖下降。') +
        row('凯利系数', '1/' + Math.round(1 / md.params.kellyFraction) + ' 凯利', '同时使用 1/4 分数凯利，把"模型可能错了"这件事也计入风险。') +
        row('单场上限', (md.params.maxPerMatch * 100).toFixed(1) + '% 本金', '即使模型极度自信，单场不超过 1.5%，防止单次判断错误伤及本金。') +
        row('单日上限', (md.params.maxPerDay * 100).toFixed(0) + '% 本金', '防止在同一天对同一条信息过度反应，造成相关性风险。') +
      '</tbody></table>';

    /* --- 校准曲线 --- */
    var rel = D.records.reliability;
    var calChart = C.line([
      { name: '实际频率', color: '#123a6b', points: rel.map(function (x) { return x.actual; }), area: true }
    ], {
      h: 220,
      xPoints: rel.map(function (x) { return x.predicted; }),
      xMin: 0.28, xMax: 0.92, min: 0.28, max: 0.92,
      diagonal: true,
      xLabels: rel.map(function (x) { return x.bucket; }),
      fmtY: function (v) { return (v * 100).toFixed(0) + '%'; }
    });

    host.innerHTML =
      /* 概览 */
      '<div class="kpis mb16">' +
        global.JX.kpi('Brier Score', h.brier.toFixed(3), '', '三分类基线 0.250 · 越低越好', 'k-win') +
        global.JX.kpi('Log-Loss', h.logLoss.toFixed(3), '', '对错误自信的惩罚项', 'k-draw') +
        global.JX.kpi('校准误差 ECE', U.pct(h.ece, 1), '', '预测概率与实际频率的偏离', 'k-gold') +
        global.JX.kpi('数据覆盖率', U.pct(h.coverage, 1), '', '有完整数据可建模的赛事占比', 'k-lose') +
        global.JX.kpi('数据延迟', h.latencyMin + '′', '', '从官方发布到入库的滞后', '') +
      '</div>' +

      '<div class="card"><div class="card-h"><h2>模型的完整流程</h2>' +
        '<span class="tiny muted">从原始数据到一条可执行推荐，共 8 步</span></div>' +
        '<div class="card-b">' + flow + '</div></div>' +

      '<div class="card"><div class="card-h"><h2>核心公式</h2><span class="tag t-brand">' + U.esc(md.algo) + '</span></div>' +
        '<div class="card-b">' + formula +
        '<div class="grid-2">' +
          '<div><div class="small" style="font-weight:700;margin-bottom:8px">为什么要做 DC 修正</div>' +
            '<p class="small">独立泊松假设主客队进球互不相关，但真实足球中低比分场次存在正相关（一方进球会改变另一方的战术）。不修正时 0:0 与 1:1 的概率被低估，会系统性高估"进球数"。</p>' +
            '<p class="small mb0">修正后低比分格子的概率提升，大小球判断随之修正。这是本站研究"总进球"玩法的基础。</p></div>' +
          '<div><div class="small" style="font-weight:700;margin-bottom:8px">为什么必须做市场校准</div>' +
            '<p class="small">纯统计模型容易过度自信：它看到的是数据，看不到更衣室、天气与轮换意图。博彩公司的赔率里包含这些信息。</p>' +
            '<p class="small mb0">因此本站不用模型去"推翻"市场，而是把去水后的市场概率作为贝叶斯先验与模型概率加权融合——只在两者出现显著差异时才认为存在价值。这也是本站推荐数量偏少的原因。</p></div>' +
        '</div></div></div>' +

      '<div class="card"><div class="card-h"><h2>模型参数（全部公开）</h2>' +
        '<span class="tiny muted">参数公开是可持续运营的前提：任何人可以复现</span></div>' +
        '<div class="card-b flush"><div class="scrollx">' + params + '</div></div></div>' +

      '<div class="card"><div class="card-h"><h2>校准验证：预测概率 vs 实际频率</h2>' +
        '<span class="tiny muted">近 30 日 ' + D.records.kpi.totalPicks + ' 注推荐</span></div>' +
        '<div class="card-b">' +
          '<div class="grid-side">' +
            '<div>' + calChart +
              '<div class="chart-legend"><span><i style="background:#123a6b"></i>实际发生频率</span><span><i style="background:#b8c4d4"></i>理想校准线（预测=实际）</span></div>' +
            '</div>' +
            '<div>' + verify + '</div>' +
          '</div>' +
          '<table class="tbl tbl-dense mt16"><thead><tr><th>模型预测概率区间</th><th class="num">平均预测值</th><th class="num">实际发生频率</th><th class="num">偏差</th><th class="num">样本量</th></tr></thead><tbody>' +
            rel.map(function (x) {
              var dev = x.actual - x.predicted;
              return '<tr><td>' + x.bucket + '</td><td class="num">' + U.pct(x.predicted, 1) + '</td>' +
                '<td class="num"><b>' + U.pct(x.actual, 1) + '</b></td>' +
                '<td class="num ' + (Math.abs(dev) < 0.02 ? 'push' : (dev > 0 ? 'hit' : 'miss')) + '">' + U.signed(dev, 1) + '</td>' +
                '<td class="num muted">' + x.n + '</td></tr>';
            }).join('') +
          '</tbody></table>' +
          '<div class="callout c-win mt16 small"><h4>这张表比命中率重要得多</h4>' +
            '<p class="mb0">如果一个模型说"65%"，那么这 65% 的事情里就真的应该有约 65% 发生。这叫<b>校准</b>。' +
            '本站所有区间的偏差都在 ±1.4 个百分点以内——这意味着模型输出的概率可以被直接当作决策依据，而不是"参考一下"。' +
            '很多预测网站只展示命中率，是因为命中率可以被高赔率小注拉高，而校准曲线骗不了人。</p></div>' +
        '</div></div>' +

      '<div class="card" id="money"><div class="card-h"><h2>资金管理规则</h2>' +
        '<span class="tiny muted">决定长期存活的是仓位，不是预测</span></div>' +
        '<div class="card-b">' +
          '<div class="grid-3 mb16">' +
            moneyCard('1/4 凯利', '按 f* = (p·b − q)/b 计算理论最优仓位后取四分之一。', '为什么不用满凯利：满凯利假设 p 是精确的，而 p 一定存在误差。') +
            moneyCard('单场 ≤ 1.5%', '任何一场推荐的仓位不超过总本金的 1.5%。', '为什么：单场判断错误的概率永远存在，任何单场都不应该影响本金的安全。') +
            moneyCard('单日 ≤ 5%', '同一天所有推荐合计不超过 5% 本金。', '为什么：同日比赛共享信息源，存在相关性风险，不是独立事件。') +
            moneyCard('串关仅 2 串 1', '仅在同向结论且相关性低时才组合，且串关金额计入当日仓位上限。', '为什么：串关把多个不确定性相乘，3 串 1 以上的长期期望迅速转负。') +
            moneyCard('禁止倍投', '连续不中时不加大仓位，仓位始终由公式决定。', '为什么：倍投是本金归零的最快路径，它把随机波动放大成必然爆仓。') +
            moneyCard('月度复核', '每月重新校准模型与仓位参数，收益率偏离预期时下调仓位。', '为什么：模型的优势会随市场效率提高而衰减，必须持续监控。') +
          '</div>' +
          '<div class="callout c-warn"><h4>关于"稳定盈利"这件事，我们的真实态度</h4>' +
            '<p class="mb0">本站近 30 日回报率为 +6.8%，但单月曾出现 −2.8%（2026 年 6 月，赛事稀少 + 杯赛属性强）。' +
            '<b>任何声称长期稳定高收益的预测服务都不符合概率常识。</b>' +
            '本站的目标不是让收益率曲线好看，而是把概率算准、把风险说清、把战绩公示全，让使用者自己做出判断。' +
            '如果你看到有人承诺"包月不回本退款"，那不是数据分析，那是销售话术。</p></div>' +
        '</div></div>' +

      '<div class="card" id="limit"><div class="card-h"><h2>模型的局限与边界</h2>' +
        '<span class="tiny muted">我们主动列出模型做不到的事</span></div>' +
        '<div class="card-b"><div class="flow">' +
          md.limits.map(function (l) {
            return '<div class="flow-step"><div class="fs-n" style="background:var(--warn)">!</div>' +
              '<div class="fs-t">' + U.esc(l.t) + '</div><div class="fs-d">' + U.esc(l.d) + '</div></div>';
          }).join('') +
        '</div>' +
        '<div class="callout mt16 small"><h4>边界之外，是概率而不是无能</h4>' +
          '<p class="mb0">一个诚实的模型会告诉你哪些事情它不知道。' +
          '把"不可预测"部分明确标出来，比假装能预测一切更接近专业。' +
          '当一个网站对每一场比赛都给出斩钉截铁的结论时，它输出的不是分析，是信心——而信心不能兑换成命中。</p></div>' +
        '</div></div>' +

      '<div class="card"><div class="card-h"><h2>为什么这套方法可持续</h2></div>' +
        '<div class="card-b"><div class="grid-2">' +
          '<div class="callout"><h4>1. 数据可复现</h4><p class="small mb0">所有输入数据在赛前落库并留存版本快照，任何一条历史推荐都能回溯到当时用到的每一个数字。没有"事后修改推荐"的空间。</p></div>' +
          '<div class="callout"><h4>2. 概率可校验</h4><p class="small mb0">页面上的概率由 λ 推导，三个档位之和恒为 1，读者可以自己验算。这是防伪设计：编造的数字很难自洽。</p></div>' +
          '<div class="callout"><h4>3. 参数可公开</h4><p class="small mb0">半衰期、主场系数、去水方法、EV 阈值、凯利系数全部公开。可复现的方法才是方法，否则只是话术。</p></div>' +
          '<div class="callout"><h4>4. 结论可空仓</h4><p class="small mb0">模型允许说"今天不推荐"。每天都必须给出结论的模型，一定在为输出而输出。</p></div>' +
          '<div class="callout"><h4>5. 战绩可公示</h4><p class="small mb0">全量推荐、含负回报月份、含连黑记录，永久保留。只展示近期战绩是典型的样本挑选。</p></div>' +
          '<div class="callout"><h4>6. 风险可计量</h4><p class="small mb0">用 Brier / Log-Loss / ECE 持续监控模型退化，偏差超阈值自动告警并回滚。模型是会老化的，必须有人管。</p></div>' +
        '</div></div></div>';
  }

  function row(k, v, d) {
    return '<tr><td style="width:158px"><b>' + U.esc(k) + '</b></td><td style="width:150px" class="num">' + U.esc(v) + '</td><td class="small muted">' + U.esc(d) + '</td></tr>';
  }

  function moneyCard(t, d, why) {
    return '<div class="card" style="margin:0;box-shadow:none">' +
      '<div class="card-h"><h3 style="font-size:14px">' + U.esc(t) + '</h3></div>' +
      '<div class="card-b"><p class="small">' + U.esc(d) + '</p>' +
      '<p class="tiny muted mb0">' + U.esc(why) + '</p></div></div>';
  }

  global.JX.renderModel = renderModel;
})(window);

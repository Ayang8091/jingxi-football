/* ==========================================================================
   竞析 JINGXI · 页面渲染层
   依赖 core.js（提供 JX.U 工具 / JX.C 图表 / JX.M 模型计算）
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.JX_DATA, U = global.JX.U, C = global.JX.C, M = global.JX.M;
  if (!D || !U) { console.error('[竞析] core.js 未加载'); return; }

  var NAV = [
    { href: 'index.html', label: '今日预测', key: 'home' },
    { href: 'match.html', label: '单场剖析', key: 'match' },
    { href: 'model.html', label: '模型与方法', key: 'model' },
    { href: 'records.html', label: '战绩公示', key: 'records' },
    { href: 'dashboard.html', label: '数据看板', key: 'dash' },
    { href: 'compliance.html', label: '合规与数据源', key: 'law' }
  ];
  /* 串关搭配（parlay.html）为独立工作台：不在主站导航/页脚显示，
     通过直接访问 parlay.html 打开，仅与主站共用数据源与缓存。 */

  /* 数据状态条上的临时提示（重新渲染时保留） */
  var lastMsg = { text: '', cls: '' };

  /* ======================================================================
     布局：导航 / 数据状态条 / 页脚（全站唯一来源）
     ====================================================================== */
  function layout(active) {
    /* 幂等：数据更新后重渲染页面时不再重复注入外壳 */
    if (document.body.getAttribute('data-shell') === '1') return;
    document.body.setAttribute('data-shell', '1');

    var h =
      '<div class="statusbar" id="jx-statusbar"><div class="wrap sb-in">' +
        '<div class="sb-left">' +
          '<span class="sb-dot"></span>' +
          '<span class="sb-txt" id="sb-txt">正在连接数据接口…</span>' +
          '<span class="sb-meta" id="sb-meta"></span>' +
          '<span class="sb-msg" id="sb-msg"></span>' +
        '</div>' +
        '<div class="sb-right">' +
          '<button class="btn-refresh" id="jx-refresh" type="button">↻ 数据更新</button>' +
          '<a class="sb-link" href="compliance.html#data">数据来源</a>' +
        '</div>' +
      '</div></div>' +
      '<header class="topbar"><div class="wrap topbar-in">' +
        '<div class="topbar-top">' +
          '<a class="brand" href="index.html" style="text-decoration:none;color:inherit">' +
            '<span class="brand-mark">析</span>' +
            '<span class="brand-txt"><strong>竞析 JINGXI</strong><span>中国竞彩足球数据分析中心</span></span>' +
          '</a>' +
          '<div class="topbar-meta">' +
            '<span class="pill-live" id="pill-mode">数据加载中</span>' +
            '<span class="hide-sm">模型 ' + U.esc(D.model.name) + '</span>' +
          '</div>' +
        '</div>' +
        '<nav class="nav">' +
          NAV.map(function (n) {
            return '<a href="' + n.href + '" class="' + (n.key === active ? 'on' : '') + '">' + n.label + '</a>';
          }).join('') +
        '</nav>' +
      '</div></header>';

    var f =
      '<footer><div class="wrap">' +
        '<div class="foot-grid">' +
          '<div>' +
            '<h4>竞析 JINGXI</h4>' +
            '<p>面向中国竞彩足球的数据分析与概率研究平台。我们只做三件事：把概率算清楚、把战绩公示全、把仓位管到底。</p>' +
            '<p class="tiny" style="color:#7f96b4">模型 ' + U.esc(D.model.name) + ' · 算法 ' + U.esc(D.model.algo) + '<br>最近重训：' + U.esc(D.model.trainedAt) + ' · 样本 ' + U.esc(D.model.sampleSize) + '</p>' +
          '</div>' +
          '<div><h4>内容</h4><ul>' +
            '<li><a href="index.html">今日赛事预测</a></li>' +
            '<li><a href="match.html">单场深度剖析</a></li>' +
            '<li><a href="records.html">战绩公示与复盘</a></li>' +
            '<li><a href="dashboard.html">数据看板</a></li>' +
          '</ul></div>' +
          '<div><h4>方法</h4><ul>' +
            '<li><a href="model.html">模型方法论</a></li>' +
            '<li><a href="model.html#money">资金管理规则</a></li>' +
            '<li><a href="model.html#limit">模型局限与边界</a></li>' +
            '<li><a href="compliance.html#data">数据来源与更新</a></li>' +
          '</ul></div>' +
          '<div><h4>风险提示</h4>' +
            '<p class="tiny" style="color:#b8cbe4;line-height:1.9">' +
            '本站内容为基于公开数据的统计分析与概率研究，<b style="color:#e8eefa">不构成任何投注建议</b>，不承诺任何结果。' +
            '彩票具有随机性，任何预测都无法保证命中。竞彩足球为国家批准的体育彩票，请通过官方渠道购彩。' +
            '</p>' +
            '<p class="foot-warn small">未满 18 周岁禁止购彩 · 理性购彩 · 量力而行</p>' +
            '<p class="tiny" style="color:#7f96b4">本站不提供任何形式的代购、返奖、私彩或境外博彩服务。</p>' +
          '</div>' +
        '</div>' +
        '<div class="foot-note">' +
          '© 2026 竞析 JINGXI。数据来自中国体育彩票公开发布信息，页面加载时自动获取，可通过顶部「数据更新」立即重新拉取。' +
          '模型输出的概率是长期统计意义上的期望，不代表单场结果。历史表现不代表未来收益。' +
          '<br>监管提示：中国体育彩票竞彩足球由国家体育总局体育彩票管理中心统一管理，请在具备合法资质的彩票销售网点购买。未满 18 周岁禁止购彩。' +
        '</div>' +
      '</div></footer>';

    document.body.insertAdjacentHTML('afterbegin', h);
    document.body.insertAdjacentHTML('beforeend', f);

    /* 绑定「数据更新」按钮 */
    var btn = U.byId('jx-refresh');
    if (btn) btn.addEventListener('click', onRefresh);
    renderStatus();
  }

  /* -------------------------------------------------- 数据状态条渲染 / 更新 */
  function msg(text, cls) { lastMsg = { text: text || '', cls: cls || '' }; paintMsg(); }
  function paintMsg() {
    var el = U.byId('sb-msg');
    if (el) { el.textContent = lastMsg.text; el.className = 'sb-msg' + (lastMsg.cls ? ' ' + lastMsg.cls : ''); }
  }

  function renderStatus() {
    var bar = U.byId('jx-statusbar');
    if (!bar) return;
    var DSx = global.JX.DS;
    var st = DSx ? DSx.state() : { mode: 'demo', loading: false, count: 0, fetchedAt: '', remoteUpdate: '', error: '' };

    bar.className = 'statusbar' + (st.loading ? ' is-busy' : (st.mode === 'live' ? '' : ' is-demo'));

    var txt = U.byId('sb-txt'), meta = U.byId('sb-meta'), pill = U.byId('pill-mode');
    if (st.loading) {
      txt.textContent = st.progress || '正在更新数据…';
      meta.textContent = '';
    } else if (st.mode === 'live') {
      txt.textContent = '实时数据 · 中国体彩网官方接口';
      meta.textContent = '更新 ' + (st.fetchedAt || st.updatedAt || '—') + ' · 可分析 ' + st.count + ' 场';
    } else {
      txt.textContent = '演示数据';
      meta.textContent = st.source === '本地缓存快照（官方接口历史数据）'
        ? '实时接口暂不可达，已展示上次成功获取的数据'
        : '实时接口暂不可达，已按演示数据展示 · 点右侧可重试';
    }
    if (pill) {
      pill.innerHTML = st.loading
        ? '<i class="dot-live"></i>更新中'
        : (st.mode === 'live'
          ? '<i class="dot-live"></i>实时数据'
          : '演示数据');
      pill.className = 'pill-live' + (st.mode === 'live' && !st.loading ? '' : ' pill-demo');
    }
    paintMsg();
  }

  /* ------------------------------------------------------- 手动更新（按钮） */
  function onRefresh() {
    var DSx = global.JX.DS;
    if (!DSx || DSx.state().loading) return;
    var btn = U.byId('jx-refresh');
    if (btn) { btn.disabled = true; btn.textContent = '更新中…'; }
    var t0 = Date.now();
    DSx.refresh().then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = '↻ 数据更新'; }
      if (r && r.ok) {
        msg('更新成功：' + r.count + ' 场 · 接口数据时间 ' + (r.remoteUpdate || '—') + ' · 耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's', 'ok');
      } else {
        msg((r && r.reason) || '接口暂时不可达，已保持当前数据展示', 'err');
      }
      renderStatus();
    });
  }

  function pageHead(crumb, title, sub) {
    return '<div class="pagehead"><div class="wrap">' +
      (crumb ? '<div class="crumb">' + crumb + '</div>' : '') +
      '<h1>' + title + '</h1>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') +
      '</div></div>';
  }

  /* ======================================================================
     通用：一场比赛的概率对象与推荐解析
     ====================================================================== */
  function probOf(m) { var r = global.JX.model(m); return { w: r.w, d: r.d, l: r.l }; }

  /* 竞彩官方 SP 返回的隐含概率（去水后），用于和模型对比 */
  function marketOf(m) { var r = global.JX.model(m); return r.sp; }

  /* 给定玩法和选择的模型概率 */
  function pickProb(m, pick) {
    var r = global.JX.model(m);
    var pl = pick.play;
    if (pl === '胜平负') return pick.sel.indexOf('主胜') === 0 ? r.w : (pick.sel.indexOf('平') === 0 ? r.d : r.l);
    if (pl === '让球胜平负') return pick.sel.indexOf('让胜') === 0 ? r.rq.w : (pick.sel.indexOf('让平') === 0 ? r.rq.d : r.rq.l);
    if (pl === '总进球') {
      /* 竞彩总进球玩法为「猜进球总数」：0 / 1 / 2 / 3 / 4 / 5 / 6 / 7+ */
      var mt = pick.sel.match(/(\d+)\s*\+?/);
      if (mt) {
        var n = parseInt(mt[1], 10);
        if (pick.sel.indexOf('+') > -1) {
          var acc = 0;
          for (var k = n; k <= 7; k++) acc += M.bucket(r, k);
          return acc;
        }
        return M.bucket(r, n);
      }
      return 0.2;
    }
    if (pl === '半全场') return 0.26;
    if (pl === '比分') return 0.10;
    return 0.3;
  }

  /* 推荐对象 → 完整评估（模型概率 / 市场概率 / EV / 凯利 / 单位） */
  function evalPick(m, pick) {
    var p = pickProb(m, pick);
    var mk = marketOf(m);
    var mkP = null;
    if (pick.play === '胜平负') mkP = pick.sel.indexOf('主胜') === 0 ? mk.w : (pick.sel.indexOf('平') === 0 ? mk.d : mk.l);
    var ev = M.ev(p, pick.sp);
    var k = M.kelly(p, pick.sp);
    var stake = Math.min(Math.max(0, k * D.model.params.kellyFraction), D.model.params.maxPerMatch) * 100;
    return {
      p: p, market: mkP, ev: ev, kelly: k, fair: M.fairOdds(p),
      stake: pick.stake !== undefined ? pick.stake : Math.round(stake * 100) / 100,
      edge: mkP === null ? null : p - mkP
    };
  }
  global.JX.evalPick = evalPick;
  global.JX.pickProb = pickProb;

  /* ======================================================================
     页面 1：首页 · 赛事预测列表
     ====================================================================== */
  function renderHome() {
    var state = { day: 'today', play: '全部', league: '全部', sort: 'conf' };
    var DAYS = [{ k: 'today', l: '今日' }, { k: 'tomorrow', l: '明日' }, { k: 'after', l: '后天' }];
    var PLAYS = ['全部', '胜平负', '让球胜平负', '总进球', '半全场', '比分'];

    function dayList() { return D.matches.filter(function (m) { return m.day === state.day; }); }

    function filtered() {
      var arr = dayList();
      if (state.league !== '全部') arr = arr.filter(function (m) { return m.league === state.league; });
      if (state.play !== '全部') {
        arr = arr.filter(function (m) {
          return m.picks.some(function (p) { return p.play === state.play; });
        });
      }
      arr = arr.slice();
      if (state.sort === 'conf') arr.sort(function (a, b) { return b.conf - a.conf; });
      if (state.sort === 'time') arr.sort(function (a, b) { return a.kickoff.localeCompare(b.kickoff); });
      if (state.sort === 'ev') {
        arr.sort(function (a, b) {
          var ea = Math.max.apply(null, a.picks.map(function (p) { return evalPick(a, p).ev; }));
          var eb = Math.max.apply(null, b.picks.map(function (p) { return evalPick(b, p).ev; }));
          return eb - ea;
        });
      }
      return arr;
    }

    /* --- 顶部 KPI --- */
    var rk = D.records.kpi;
    var isLive = global.JX.DS && global.JX.DS.state().mode === 'live';
    var todayMs = D.matches.filter(function (m) { return m.day === 'today'; });
    var liveMar = 0, liveN = 0;
    if (isLive) {
      todayMs.forEach(function (m) {
        var rr = global.JX.model(m);
        if (rr && rr.sp && isFinite(rr.sp.margin)) { liveMar += rr.sp.margin; liveN++; }
      });
      liveMar = liveN ? liveMar / liveN : 0;
    }
    var kpis =
      '<div class="kpis mb16">' +
        kpi('今日可分析赛事', todayMs.length, '场', '覆盖 ' + uniq(todayMs.map(function (m) { return m.league; })).length + ' 个联赛', 'k-draw') +
        (isLive
          ? kpi('官方盘口水位', (liveMar * 100).toFixed(1), '%', '实测 ' + liveN + ' 场胜平负盘均值', 'k-lose') +
            kpi('单关长期期望', (-liveMar * 100).toFixed(1), '%', '扣除水位后无正期望——如实呈现', 'k-warn') +
            kpi('满足价值阈值的推荐', '0', '条', '本数据源不含基本面，模型无法优于市场', 'k-lose') +
            kpi('串关搭配参考', '有', '', '见「串关搭配」栏目与倍投计划', 'k-gold')
          : kpi('近 30 日命中率', (rk.rate * 100).toFixed(1), '%', rk.window, 'k-win') +
            kpi('近 30 日回报率', (rk.roi * 100).toFixed(1), '%', '总投入 ' + rk.stake.toFixed(1) + 'u · 净收益 ' + rk.profit.toFixed(2) + 'u', 'k-gold') +
            kpi('模型校准误差 (Brier)', D.model.health.brier.toFixed(3), '', '基线 0.250，越低越好', 'k-lose') +
            kpi('推荐总数（可回溯）', rk.totalPicks, '注', '每注开赛前锁定公示', '')
        ) +
      '</div>';

    /* --- 实时数据模式下的口径说明 --- */
    var notice = isLive
      ? '<div class="notice-strip"><div><b>当前为官方实时数据模式。</b>' +
        '赛程、双方球队、联赛与各玩法赔率（胜平负 / 让球 / 总进球 / 比分 / 半全场）均来自中国体彩网公开接口，点顶部「数据更新」可随时重新拉取。' +
        '由于该接口<b>不提供球队级基本面</b>（xG、伤停、阵容、交锋），模型只能由赔率反解 λ，因此不具备独立于市场的预测优势——' +
        '这也是为什么「满足价值阈值的推荐」显示为 0。要产生真实的正期望，需要接入球队级数据源；在那之前，本站选择如实呈现负期望，而不是编造推荐。' +
        '<a href="compliance.html#data">查看数据源说明 →</a></div></div>'
      : '';

    /* --- 工具栏 --- */
    var leagues = uniq(D.matches.map(function (m) { return m.league; }));
    var toolbar =
      '<div class="toolbar">' +
        '<div class="seg">' + DAYS.map(function (d) {
          return '<button data-day="' + d.k + '" class="' + (d.k === 'today' ? 'on' : '') + '">' + d.l + '</button>';
        }).join('') + '</div>' +
        '<div class="chips">' + PLAYS.map(function (p) {
          return '<button class="chip ' + (p === '全部' ? 'on' : '') + '" data-play="' + p + '">' + p + '</button>';
        }).join('') + '</div>' +
        '<div class="field" style="margin-left:auto"><label>联赛</label><select id="f-league">' +
          '<option>全部</option>' + leagues.map(function (l) { return '<option>' + U.esc(l) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>排序</label><select id="f-sort">' +
          '<option value="conf">按信心指数</option>' +
          '<option value="ev">按价值 EV</option>' +
          '<option value="time">按开赛时间</option>' +
        '</select></div>' +
      '</div>';

    /* --- 当日核心推荐 --- */
    function topPicks() {
      var all = [];
      dayList().forEach(function (m) {
        m.picks.forEach(function (p) {
          var e = evalPick(m, p);
          if (e.ev > 0 && e.stake > 0) all.push({ m: m, p: p, e: e });
        });
      });
      all.sort(function (a, b) { return b.e.ev - a.e.ev || b.m.conf - a.m.conf; });
      return all.slice(0, 3);
    }

    var host = U.byId('home-body');
    host.innerHTML =
      notice + kpis + toolbar +
      '<div class="grid-side">' +
        '<div>' +
          '<div class="card" id="list-card">' +
            '<div class="card-h"><h3>赛事预测清单 <span class="hint" id="list-count"></span></h3>' +
              '<span class="tiny muted">推荐按"模型概率 × 竞彩 SP"计算价值，无正期望则空仓</span></div>' +
            '<div class="card-b flush"><div class="match-list" id="match-list"></div></div>' +
          '</div>' +
          '<div class="callout mt16"><h4>怎么读这张表</h4>' +
            '<ul class="small">' +
              '<li><b>模型概率</b>：由 Dixon-Coles 修正泊松模型按双方期望进球 λ 计算，页面实时生成，非人工填写。</li>' +
              '<li><b>竞彩 SP</b>：竞彩足球官方胜平负奖金值。与"公平赔率"对比即是价值判断的依据。</li>' +
              '<li><b>价值 EV</b> = 模型概率 × SP − 1。EV ≤ 0 的选项一律不作推荐，宁可空仓。</li>' +
              '<li><b>建议单位</b>：以 1/4 凯利定仓，单场上限 1.5% 本金。单位是相对仓位，不是金额。</li>' +
            '</ul></div>' +
        '</div>' +
        '<div>' +
          '<div class="card"><div class="card-h"><h3>当日核心推荐</h3><span class="tiny muted">EV 排序 Top 3</span></div>' +
            '<div class="card-b" id="top-picks"></div></div>' +
          '<div class="card"><div class="card-h"><h3>模型健康度</h3><span class="tag t-brand">' + U.esc(D.model.name) + '</span></div>' +
            '<div class="card-b">' +
              '<div class="mini-grid mb16">' +
                mg('Brier', D.model.health.brier.toFixed(3)) +
                mg('Log-Loss', D.model.health.logLoss.toFixed(3)) +
                mg('校准误差 ECE', U.pct(D.model.health.ece, 1)) +
                mg('数据覆盖率', U.pct(D.model.health.coverage, 1)) +
                mg('数据延迟', D.model.health.latencyMin + '′') +
                mg('下次重训', D.model.health.nextRecalib.slice(5)) +
              '</div>' +
              '<p class="small muted mb0">模型每 30 天以全部历史推荐做一次校准复核；若 Brier 恶化超过 2% 即触发重训并回滚参数。全部指标公开。</p>' +
            '</div></div>' +
          '<div class="callout c-warn"><h4>风险提示</h4>' +
            '<p class="small mb0">概率是长期期望，不是单场保证。本站曾出现连续 4 日负回报、单月 −2.8% 的记录，均已在<a href="records.html">战绩公示</a>中原样保留。任何以"必中""包赢"为卖点的网站，都是用结果掩盖概率。</p>' +
          '</div>' +
        '</div>' +
      '</div>';

    function renderList() {
      var arr = filtered();
      var box = U.byId('match-list');
      U.byId('list-count').textContent = '共 ' + arr.length + ' 场 · ' +
        DAYS.filter(function (d) { return d.k === state.day; })[0].l;
      if (!arr.length) { box.innerHTML = '<div class="card-b center muted">该条件下暂无赛事。无条件推荐也是一种答案。</div>'; return; }
      box.innerHTML = arr.map(function (m) { return matchRow(m); }).join('');
    }

    function renderTop() {
      var tp = topPicks();
      var box = U.byId('top-picks');
      if (!tp.length) { box.innerHTML = '<p class="muted small mb0">当日无满足价值阈值的推荐，建议空仓观望。</p>'; return; }
      box.innerHTML = tp.map(function (t, i) {
        var m = t.m, p = t.p, e = t.e;
        return '<div style="padding:11px 0;border-bottom:1px dashed var(--line)">' +
          '<div class="row between mb8">' +
            '<div class="row gap8"><span class="no-chip">' + U.esc(m.no) + '</span><span class="league-chip lv-' + (i + 1) + '">' + U.esc(m.league) + '</span></div>' +
            '<span class="tag t-gold">EV ' + U.signed(e.ev, 1) + '</span>' +
          '</div>' +
          '<div class="mb8" style="font-weight:700;font-size:14.5px">' + U.esc(m.home.short) + ' <span class="muted" style="font-weight:400">vs</span> ' + U.esc(m.away.short) + '</div>' +
          '<div class="row between">' +
            '<div><span class="tag t-brand">' + U.esc(p.play) + '</span> <b style="font-size:14px">' + U.esc(p.sel) + '</b></div>' +
            '<div class="right"><div class="odds" style="font-size:16px;font-weight:800;color:var(--win)">' + U.odds(p.sp) + '</div>' +
            '<div class="tiny muted">模型 ' + U.pct(e.p, 1) + ' · 建议 ' + U.num(e.stake, 2) + 'u</div></div>' +
          '</div>' +
          '<div class="pbar mt8" style="height:6px"><i class="p-w" style="width:' + Math.min(100, e.p * 100) + '%;background:linear-gradient(90deg,var(--accent),#e8c477)"></i></div>' +
          '<a class="tiny" href="match.html?id=' + m.id + '">查看完整剖析 →</a>' +
        '</div>';
      }).join('');
    }

    U.on(document, 'click', '[data-day]', function (e, t) {
      state.day = t.dataset.day;
      U.$$('.seg [data-day]').forEach(function (b) { b.classList.toggle('on', b === t); });
      renderList(); renderTop();
    });
    U.on(document, 'click', '[data-play]', function (e, t) {
      state.play = t.dataset.play;
      U.$$('[data-play]').forEach(function (b) { b.classList.toggle('on', b === t); });
      renderList();
    });
    U.byId('f-league').addEventListener('change', function () { state.league = this.value; renderList(); });
    U.byId('f-sort').addEventListener('change', function () { state.sort = this.value; renderList(); });

    renderList(); renderTop();
  }

  /* --- 单行赛事 --- */
  function rankHtml(team) {
    return team.rank === null || team.rank === undefined ? '' : '<span class="trank">#' + team.rank + '</span>';
  }
  /* 数据源未提供基本面时，用模型可解释的量替代（避免空白行，也不编造数据） */
  function hintHtml(m, r) {
    var parts = [];
    var c = m.coverage || {};
    if (m.home.xg !== null && m.home.xg !== undefined) parts.push('xG ' + U.num(m.home.xg, 2) + ' vs ' + U.num(m.away.xg, 2));
    if (m.h2h) parts.push('交锋 ' + m.h2h.hw + '胜' + m.h2h.d + '平' + m.h2h.aw + '负');
    parts.push('λ ' + U.num(r.lam[0], 2) + ' / ' + U.num(r.lam[1], 2));
    parts.push('期望总进球 ' + U.num(r.lam[0] + r.lam[1], 2));
    if (m.venue) parts.push(U.esc(m.venue));
    if (!c.xg && !c.form) parts.push('基本面数据源未提供');
    return '<div class="m-hint">' + parts.join(' · ') + '</div>';
  }

  function matchRow(m) {
    var r = global.JX.model(m);
    var best = m.picks.map(function (p) { return { p: p, e: evalPick(m, p) }; })
      .filter(function (x) { return x.e.ev > 0 && x.e.stake > 0; })
      .sort(function (a, b) { return b.e.ev - a.e.ev; })[0];
    var mk = r.sp;
    /* 只高亮"存在正期望"的那一档；三档全为负则不highlight，避免误导 */
    var evs = [r.w * m.sp.w - 1, r.d * m.sp.d - 1, r.l * m.sp.l - 1];
    var top = evs[0] >= evs[1] && evs[0] >= evs[2] ? 0 : (evs[1] >= evs[2] ? 1 : 2);
    var hi = evs[top] > 0 ? ['w', 'd', 'l'][top] : '';

    var lg = D.leagues.filter(function (l) { return l.name === m.league; })[0];

    return '<div class="mrow">' +
      '<div class="m-meta">' +
        '<span class="no-chip">' + U.esc(m.no) + '</span>' +
        '<span class="m-time">' + U.esc(m.kickoff) + '</span>' +
        '<span class="league-chip lv-' + (lg ? Math.min(4, lg.tier) : 3) + '">' + U.esc(m.league) + '</span>' +
      '</div>' +
      '<div class="m-teams">' +
        '<div class="m-team"><span class="tname">' + U.esc(m.home.short) + '</span>' + rankHtml(m.home) + C.form(m.home.recent || [], '主队近5场') + '</div>' +
        '<div class="m-team" style="margin-top:3px"><span class="tname">' + U.esc(m.away.short) + '</span>' + rankHtml(m.away) + C.form(m.away.recent || [], '客队近5场') + '</div>' +
        hintHtml(m, r) +
      '</div>' +
      '<div class="m-prob">' +
        C.pbar({ w: r.w, d: r.d, l: r.l }, 8) +
        '<div class="pbar-legend">' +
          '<span class="legend-w">胜 <b>' + U.pct(r.w, 1) + '</b></span>' +
          '<span class="legend-d">平 <b>' + U.pct(r.d, 1) + '</b></span>' +
          '<span class="legend-l">负 <b>' + U.pct(r.l, 1) + '</b></span>' +
        '</div>' +
        '<div class="row between tiny muted"><span>公平赔率</span><span class="num">' + U.num(M.fairOdds(r.w), 2) + ' / ' + U.num(M.fairOdds(r.d), 2) + ' / ' + U.num(M.fairOdds(r.l), 2) + '</span></div>' +
      '</div>' +
      '<div class="m-odds">' +
        oddsCell('胜', m.sp.w, mk.w, hi === 'w') +
        oddsCell('平', m.sp.d, mk.d, hi === 'd') +
        oddsCell('负', m.sp.l, mk.l, hi === 'l') +
      '</div>' +
      '<div class="m-side">' +
        (best
          ? '<div class="pick-badge"><span class="p-main" style="color:var(--win)">' + U.esc(best.p.sel) + '</span>' +
            '<span class="p-sp">' + U.esc(best.p.play) + ' @ ' + U.odds(best.p.sp) + '</span></div>' +
            '<span class="tag t-win">EV ' + U.signed(best.e.ev, 1) + '</span>'
          : '<span class="tag t-warn">无正期望 · 空仓</span>') +
        '<div>' + C.stars(m.conf) + '</div>' +
        '<a class="tiny" href="match.html?id=' + m.id + '">完整剖析 →</a>' +
      '</div>' +
    '</div>';
  }

  function oddsCell(lab, sp, imp, sel) {
    return '<div class="' + (sel ? 'sel-' + (lab === '胜' ? 'w' : lab === '平' ? 'd' : 'l') : '') + '">' +
      '<div class="o-l">' + lab + '</div>' +
      '<div class="o-v">' + U.odds(sp) + '</div>' +
      '<div class="o-l" style="font-size:9.5px">' + U.pct(imp, 0) + '</div>' +
      '</div>';
  }

  function kpi(label, val, unit, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="k-lab">' + label + '</div>' +
      '<div class="k-val">' + val + (unit ? '<small>' + unit + '</small>' : '') + '</div>' +
      '<div class="k-sub">' + sub + '</div></div>';
  }
  function mg(label, val) {
    return '<div><div class="mg-l">' + label + '</div><div class="mg-v">' + val + '</div></div>';
  }
  function uniq(a) { var s = [], o = {}; a.forEach(function (x) { if (!o[x]) { o[x] = 1; s.push(x); } }); return s; }

  global.JX.renderHome = renderHome;
  global.JX.renderStatus = renderStatus;
  global.JX.statusMsg = msg;
  global.JX.layout = layout;
  global.JX.pageHead = pageHead;
  global.JX.kpi = kpi;
  global.JX.mg = mg;
  global.JX.uniq = uniq;
  global.JX.matchRow = matchRow;
  global.JX.NAV = NAV;
})(window);

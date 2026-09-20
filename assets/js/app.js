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
    { href: 'sim.html', label: '串关模拟', key: 'sim' },
    { href: 'records.html', label: '战绩公示', key: 'records' },
    { href: 'dashboard.html', label: '数据看板', key: 'dash' }
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
      /* parlay 独立工作台：隐藏全部站点导航栏（品牌栏 + 主导航），仅保留数据状态条 */
      (active === 'parlay' ? '' :
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
      '</div></header>');

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
            '<li><a href="sim.html">串关模拟</a></li>' +
            '<li><a href="records.html">战绩公示与复盘</a></li>' +
            '<li><a href="dashboard.html">数据看板</a></li>' +
          '</ul></div>' +
          '<div><h4>工具</h4><ul>' +
            '<li><a href="parlay.html">串关搭配工作台</a></li>' +
            '<li><a href="model.html">模型方法论</a></li>' +
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
          return (m.recs || []).some(function (p) { return p.play === state.play; }) ||
            m.picks.some(function (p) { return p.play === state.play; });
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
    var liveMar = 0, liveN = 0, pickN = 0, valN = 0;
    if (isLive) {
      todayMs.forEach(function (m) {
        var rr = global.JX.model(m);
        if (rr && rr.sp && isFinite(rr.sp.margin)) { liveMar += rr.sp.margin; liveN++; }
        (m.recs || m.picks || []).forEach(function (p) { pickN++; });
      });
      liveMar = liveN ? liveMar / liveN : 0;
    }
    var kpis =
      '<div class="kpis mb16">' +
        kpi('今日可分析赛事', todayMs.length, '场', '覆盖 ' + uniq(todayMs.map(function (m) { return m.league; })).length + ' 个联赛', 'k-draw') +
        (isLive
          ? kpi('官方盘口水位', (liveMar * 100).toFixed(1), '%', '实测 ' + liveN + ' 场胜平负盘均值', 'k-lose') +
            kpi('今日推荐方向', pickN, '条', '胜平负/让球各1 · 总进球/半全场各2 · 比分3', 'k-gold') +
            kpi('单关长期期望', (-liveMar * 100).toFixed(1), '%', '扣除水位后的真实期望', 'k-warn') +
            kpi('串关搭配参考', '有', '', '串关模拟页与独立工作台可用', 'k-gold')
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
        '模型由官方赔率反解 λ 后重算各玩法概率：胜平负、让球胜平负各取概率最高的 1 个方向，总进球、半全场各取 2 个，比分取 3 个，均按概率从高到低排列。' +
        '其中半全场因模型无法分解半场进程，概率取该玩法官方赔率去水后的隐含概率，已在条目中标注。' +
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

    /* --- 当日核心推荐（按概率排序 Top 3） --- */
    function topPicks() {
      var all = [];
      dayList().forEach(function (m) {
        (m.recs || []).forEach(function (p) {
          all.push({ m: m, p: p, ev: p.sp ? p.p * p.sp - 1 : null });
        });
      });
      all.sort(function (a, b) { return b.p.p - a.p.p; });
      return all.slice(0, 3);
    }

    var host = U.byId('home-body');
    host.innerHTML =
      notice + kpis + toolbar +
      '<div class="grid-side">' +
        '<div>' +
          '<div class="card" id="list-card">' +
            '<div class="card-h"><h3>赛事预测清单 <span class="hint" id="list-count"></span></h3>' +
              '<button class="btn-ghost" data-homexport style="margin-left:12px;padding:3px 12px;font-size:12px;flex-shrink:0">导出结果图片（PNG 长图）</button>' +
              '<span class="tiny muted" style="margin-left:12px">各玩法按概率从高到低推荐：胜平负/让球 1 · 总进球/半全场 2 · 比分 3</span></div>' +
            '<div class="card-b flush"><div class="match-list" id="match-list"></div></div>' +
          '</div>' +
          '<div class="callout mt16"><h4>怎么读这张表</h4>' +
            '<ul class="small">' +
              '<li><b>模型概率</b>：由 Dixon-Coles 修正泊松模型按双方期望进球 λ 计算，页面实时生成，非人工填写。</li>' +
              '<li><b>各玩法推荐</b>：胜平负、让球胜平负各取概率最高的 1 个方向；总进球、半全场各取 2 个；比分取 3 个，均按概率从高到低排列。</li>' +
              '<li><b>半全场口径</b>：模型无法分解半场进程，该项概率取官方赔率去水后的隐含概率（条目中已标注「市场」）。</li>' +
              '<li><b>价值 EV</b> = 模型概率 × SP − 1，同步展示供参考：EV 为正代表模型概率高于市场定价，为负仅说明水位覆盖。</li>' +
            '</ul></div>' +
        '</div>' +
        '<div>' +
          '<div class="card"><div class="card-h"><h3>当日核心推荐</h3><span class="tiny muted">按概率排序 Top 3</span></div>' +
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
      if (!tp.length) { box.innerHTML = '<p class="muted small mb0">当日暂无可分析赛事或该玩法未开售，拉取数据后自动生成推荐。</p>'; return; }
      box.innerHTML = tp.map(function (t, i) {
        var m = t.m, p = t.p, ev = t.ev;
        return '<div style="padding:11px 0;border-bottom:1px dashed var(--line)">' +
          '<div class="row between mb8">' +
            '<div class="row gap8"><span class="no-chip">' + U.esc(m.no) + '</span><span class="league-chip lv-' + (i + 1) + '">' + U.esc(m.league) + '</span></div>' +
            (ev === null ? '<span class="tag">未开售 SP</span>' : '<span class="tag ' + (ev > 0 ? 't-win' : 't-gold') + '">EV ' + U.signed(ev, 1) + '</span>') +
          '</div>' +
          '<div class="mb8" style="font-weight:700;font-size:14.5px">' + U.esc(m.home.short) + ' <span class="muted" style="font-weight:400">vs</span> ' + U.esc(m.away.short) + '</div>' +
          '<div class="row between">' +
            '<div><span class="tag t-brand">' + U.esc(p.play) + '</span> <b style="font-size:14px">' + U.esc(p.sel) + '</b></div>' +
            '<div class="right"><div class="odds" style="font-size:16px;font-weight:800;color:var(--win)">' + (p.sp ? U.odds(p.sp) : '—') + '</div>' +
            '<div class="tiny muted">' + (p.basis === 'market' ? '市场隐含 ' : '模型 ') + U.pct(p.p, 1) + '</div></div>' +
          '</div>' +
          '<div class="pbar mt8" style="height:6px"><i class="p-w" style="width:' + Math.min(100, p.p * 100) + '%;background:linear-gradient(90deg,var(--accent),#e8c477)"></i></div>' +
          '<a class="tiny" href="match.html?id=' + m.id + '">查看完整剖析 →</a>' +
        '</div>';
      }).join('');
    }

    /* ============================================================ PNG 导出 */
    /* 与串关模拟页同一套方案：1080px 逻辑宽、2x 物理像素、两段式布局
      （先量高再画），所有文本先测宽再截断/降级，保证数字不重叠。 */
    var EXFONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
    var EXC = {
      bg: '#f2f5f9', panel: '#ffffff', line: '#e2e8f0',
      brand: '#123a6b', brand2: '#1b5296', accent: '#c8952c', accentSoft: '#eaf1fb',
      ink: '#16202e', ink2: '#47566b', ink3: '#7d8b9e',
      pos: '#cf2b2b', neg: '#0f8a5f', rowLine: '#eef2f7'
    };

    function expNow() {
      var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function expFileName() {
      var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
      return 'jingxi-prediction-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.png';
    }
    function stars5(conf) {
      var n = Math.max(1, Math.min(5, conf | 0)), s = '';
      for (var i = 1; i <= 5; i++) s += (i <= n ? '★' : '☆');
      return s;
    }

    /* 演示快照没有 recs 字段：按模型实时结果兜底生成（胜平负/让球各 1 条） */
    function exportRecsOf(m) {
      if (m.recs && m.recs.length) return m.recs;
      var r = global.JX.model(m), out = [];
      if (!r) return out;
      if (m.sp) {
        var a1 = [['主胜', m.sp.w, r.w], ['平局', m.sp.d, r.d], ['客胜', m.sp.l, r.l]]
          .sort(function (x, y) { return y[2] - x[2]; });
        out.push({ play: '胜平负', sel: a1[0][0], sp: a1[0][1], p: a1[0][2], basis: 'model' });
      }
      if (m.rq && isFinite(m.rq.line)) {
        var q = M.handicapProbs(r, m.rq.line);
        var a2 = [['让胜', m.rq.w, q.w], ['让平', m.rq.d, q.d], ['让负', m.rq.l, q.l]]
          .sort(function (x, y) { return y[2] - x[2]; });
        out.push({ play: '让球胜平负', sel: a2[0][0], sp: a2[0][1], p: a2[0][2], basis: 'model' });
      }
      return out;
    }

    function drawHomePNG(list) {
      var W = 1080, PAD = 48, GAP = 16;
      var measure = document.createElement('canvas').getContext('2d');
      function f(sz, wt) { measure.font = (wt || 400) + ' ' + sz + 'px ' + EXFONT; return measure; }
      function fit(ctx2, txt, maxW) {
        txt = String(txt);
        if (ctx2.measureText(txt).width <= maxW) return txt;
        while (txt.length > 1 && ctx2.measureText(txt + '…').width > maxW) txt = txt.slice(0, -1);
        return txt + '…';
      }

      var CARD_W = W - PAD * 2, IN = 26;
      var REC_H = 40, META_H = 24, TEAM_H = 36, RIGHT_W = 214;
      var ORDER = ['胜平负', '让球胜平负', '总进球', '半全场', '比分'];

      var items = list.map(function (m) {
        var recs = exportRecsOf(m), groups = [];
        ORDER.forEach(function (play) {
          var its = recs.filter(function (p) { return p.play === play; });
          if (its.length) groups.push({ play: play, items: its });
        });
        var lam = (m.lam && m.lam.length === 2) ? m.lam :
          (function () { var r = global.JX.model(m); return r ? r.lam : [0, 0]; })();
        return { m: m, groups: groups, lam: lam, h: IN + META_H + 8 + TEAM_H + 10 + groups.length * REC_H + 14 };
      });

      var nRec = items.reduce(function (s, it) {
        return s + it.groups.reduce(function (s2, g) { return s2 + g.items.length; }, 0);
      }, 0);
      var leagues = uniq(list.map(function (m) { return m.league; }));
      var isLive = global.JX.DS && global.JX.DS.state().mode === 'live';
      var kpis = [
        { l: '可分析赛事', v: list.length + ' 场' },
        { l: '覆盖联赛', v: leagues.length + ' 个' },
        { l: '推荐方向', v: nRec + ' 条' },
        { l: '数据模式', v: isLive ? '官方实时' : '演示快照' }
      ];

      var KPI_W = (CARD_W - GAP * 3) / 4, KPI_H = 92;
      var HEAD_H = 188, KPI_TOP = 30, FOOT_H = 96, SECT_T = 26;
      var totalH = HEAD_H + KPI_TOP + KPI_H + SECT_T + SECT_T +
        items.reduce(function (s, it) { return s + it.h + GAP; }, -GAP) +
        SECT_T + FOOT_H;

      var SCALE = 2;
      var cv = document.createElement('canvas');
      cv.width = W * SCALE; cv.height = Math.ceil(totalH) * SCALE;
      var ctx = cv.getContext('2d');
      ctx.scale(SCALE, SCALE);
      function sf(sz, wt) { ctx.font = (wt || 400) + ' ' + sz + 'px ' + EXFONT; }
      function ink(c) { ctx.fillStyle = c; }
      function rr(x, y, w, h, r) {
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

      /* 背景 */
      ink(EXC.bg); ctx.fillRect(0, 0, W, totalH);

      /* ---------- 头部 ---------- */
      var grad = ctx.createLinearGradient(0, 0, W, HEAD_H);
      grad.addColorStop(0, EXC.brand); grad.addColorStop(1, EXC.brand2);
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, HEAD_H);
      ink('rgba(255,255,255,.55)'); sf(15, 500);
      ctx.fillText('竞析 JINGXI · 今日预测', PAD, 44);
      ink('#ffffff'); sf(38, 700);
      ctx.fillText(fit(ctx, '今日赛事推荐一览', W - PAD * 2 - 220), PAD, 96);
      sf(26, 700); ink(EXC.accent);
      var tagTxt = '推荐 ' + nRec + ' 条';
      ctx.fillText(tagTxt, W - PAD - ctx.measureText(tagTxt).width, 60);
      ink('rgba(255,255,255,.78)'); sf(15, 400);
      ctx.fillText('排序：当前筛选结果　·　生成时间：' + expNow(), PAD, 138);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD, 158); ctx.lineTo(W - PAD, 158); ctx.stroke();
      ink('rgba(255,255,255,.6)'); sf(12.5, 400);
      ctx.fillText('推荐口径：胜平负 / 让球胜平负各 1 个方向 · 总进球 / 半全场各 2 个 · 比分 3 个，均按概率从高到低。', PAD, 180);

      /* ---------- KPI 行 ---------- */
      var y = HEAD_H + KPI_TOP;
      kpis.forEach(function (k, i) {
        var kx = PAD + i * (KPI_W + GAP);
        ink(EXC.panel); rr(kx, y, KPI_W, KPI_H, 14); ctx.fill();
        ctx.strokeStyle = EXC.line; ctx.stroke();
        ink(EXC.ink3); sf(13, 400);
        ctx.fillText(fit(ctx, k.l, KPI_W - 28), kx + 14, y + 32);
        ink(EXC.ink); sf(26, 700);
        ctx.fillText(fit(ctx, k.v, KPI_W - 28), kx + 14, y + 68);
      });
      y += KPI_H + SECT_T;

      /* ---------- 赛事卡片 ---------- */
      var noMaxW = 88;
      items.forEach(function (it) {
        var m = it.m;
        var teamsTxt = (m.home.short || m.home.name) + '  vs  ' + (m.away.short || m.away.name);
        var mainW = CARD_W - IN * 2 - RIGHT_W;

        ink(EXC.panel); rr(PAD, y, CARD_W, it.h, 16); ctx.fill();
        ctx.strokeStyle = EXC.line; ctx.lineWidth = 1; ctx.stroke();

        /* 第一行：场次号徽章 + 联赛 + 开赛时间；右侧信心星 */
        var nx = PAD + IN, ny = y + IN;
        sf(13, 700);
        var noW2 = Math.min(noMaxW, f(13, 700).measureText(m.no).width + 20);
        ink(EXC.brand); rr(nx, ny - 14, noW2, 22, 5); ctx.fill();
        ink('#ffffff');
        ctx.fillText(fit(ctx, m.no, noW2 - 8), nx + 10, ny + 2);
        sf(13, 400); ink(EXC.ink2);
        ctx.fillText(fit(ctx, m.league + ' · ' + m.kickoff, mainW - noW2 - 16), nx + noW2 + 14, ny + 2);
        sf(13.5, 400); ink(EXC.accent);
        var stTxt = stars5(m.conf);
        ctx.fillText(stTxt, PAD + CARD_W - IN - ctx.measureText(stTxt).width, ny + 2);

        /* 第二行：对阵（大字），右侧 λ */
        sf(20, 700); ink(EXC.ink);
        ctx.fillText(fit(ctx, teamsTxt, mainW), PAD + IN, y + IN + META_H + 8 + 24);
        sf(12.5, 400); ink(EXC.ink3);
        var lamTxt = 'λ ' + it.lam[0].toFixed(2) + ' / ' + it.lam[1].toFixed(2) + ' · 期望进球 ' + (it.lam[0] + it.lam[1]).toFixed(2);
        ctx.fillText(fit(ctx, lamTxt, RIGHT_W), PAD + CARD_W - IN - f(12.5, 400).measureText(fit(ctx, lamTxt, RIGHT_W)).width, y + IN + META_H + 8 + 22);

        /* 推荐明细行 */
        var ly = y + IN + META_H + 8 + TEAM_H + 10;
        var chipW = 96;
        it.groups.forEach(function (g) {
          /* 玩法徽章 */
          ink(EXC.accentSoft); rr(PAD + IN, ly, chipW, 24, 5); ctx.fill();
          sf(12, 700); ink(EXC.brand);
          var label = fit(ctx, g.play, chipW - 12);
          ctx.fillText(label, PAD + IN + (chipW - ctx.measureText(label).width) / 2, ly + 17);
          /* 选项逐个排布：空间不足时先丢概率、再截断，保证不重叠 */
          var x = PAD + IN + chipW + 16;
          var maxX = PAD + CARD_W - IN;
          g.items.forEach(function (p, ii) {
            if (x >= maxX - 30) return;
            sf(14.5, 600); ink(EXC.ink);
            var selS = fit(ctx, p.sel, maxX - x - 90);
            ctx.fillText(selS, x, ly + 18);
            x += ctx.measureText(selS).width + 4;
            if (p.sp && x < maxX - 60) {
              var odS = '@' + U.odds(p.sp);
              ctx.fillText(odS, x, ly + 18);
              x += ctx.measureText(odS).width + 6;
            }
            var isLast = ii === g.items.length - 1;
            if (x < maxX - 110) {
              var pS = (p.basis === 'market' ? '市场 ' : '') + U.pct(p.p, 1);
              sf(12, 400); ink(EXC.ink3);
              ctx.fillText(pS, x, ly + 17);
              x += ctx.measureText(pS).width + 20;
            } else if (!isLast && x < maxX - 40) {
              sf(12, 400); ink(EXC.ink3);
              ctx.fillText('/', x, ly + 17);
              x += 16;
            }
          });
          if (ly + REC_H < y + it.h - 8) {
            ctx.strokeStyle = EXC.rowLine;
            ctx.beginPath(); ctx.moveTo(PAD + IN, ly + REC_H - 8); ctx.lineTo(PAD + CARD_W - IN, ly + REC_H - 8); ctx.stroke();
          }
          ly += REC_H;
        });

        y += it.h + GAP;
      });
      y += SECT_T - GAP;

      /* ---------- 页脚 ---------- */
      var ds = (global.JX.DS && global.JX.DS.state) ? global.JX.DS.state() : {};
      ink(EXC.ink3); sf(12.5, 400);
      ctx.fillText('数据：中国体彩网官方接口 · 数据时间 ' + (ds.remoteUpdate || ds.updatedAt || '—') + ' · 模式 ' + (ds.mode || '—'), PAD, y + 24);
      ctx.fillText('概率为模型/市场口径的长期参考，不构成任何盈利承诺；EV 为正仅代表模型概率高于市场定价。请理性购彩，量力而行。', PAD, y + 48);

      return cv.toDataURL('image/png');
    }

    function showHomeExportModal(url) {
      var old = document.getElementById('home-export-mask');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var mask = document.createElement('div');
      mask.id = 'home-export-mask';
      mask.innerHTML =
        '<div class="sexp-box">' +
          '<div class="sexp-bar">' +
            '<div class="sexp-t"><b>预测结果长图已生成</b><span>手机长按图片即可保存 · 电脑可点「下载 PNG」或右键另存为</span></div>' +
            '<div class="sexp-acts"><a class="btn-brand" id="hexp-dl" href="' + url + '" download="' + expFileName() + '">下载 PNG</a>' +
            '<button class="btn-ghost" id="hexp-close">关闭</button></div>' +
          '</div>' +
          '<div class="sexp-scroll"><img class="sexp-img" alt="今日预测结果长图"></div>' +
        '</div>';
      document.body.appendChild(mask);
      mask.querySelector('.sexp-img').src = url;
      function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
      mask.querySelector('#hexp-close').addEventListener('click', close);
      mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
      var dl = mask.querySelector('#hexp-dl');
      dl.addEventListener('click', function (e) {
        var ua = navigator.userAgent || '';
        if (/MicroMessenger/i.test(ua)) {
          e.preventDefault();
          window.alert('在微信内无法直接下载：请长按上方图片，选择「保存图片」到手机相册。');
        }
      });
    }

    function exportHomePNG() {
      var list = filtered();
      if (!list.length) { window.alert('当前筛选条件下暂无赛事，无法导出。'); return; }
      try {
        showHomeExportModal(drawHomePNG(list));
      } catch (e) {
        window.alert('导出失败：' + (e && e.message ? e.message : '当前浏览器不支持 Canvas 绘制。'));
      }
    }

    U.on(document, 'click', '[data-homexport]', function () { exportHomePNG(); });
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
    var recs = m.recs || [];
    var best = recs.slice().sort(function (a, b) { return b.p - a.p; })[0];
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
          ? '<div class="pick-badge"><span class="p-main" style="color:var(--win)">' + U.esc(best.sel) + '</span>' +
            '<span class="p-sp">' + U.esc(best.play) + (best.sp ? ' @ ' + U.odds(best.sp) : '') + '</span></div>' +
            '<span class="tiny muted">' + (best.basis === 'market' ? '市场 ' : '模型 ') + U.pct(best.p, 1) + '</span>'
          : '<span class="tag t-warn">该玩法未开售</span>') +
        '<div>' + C.stars(m.conf) + '</div>' +
        '<a class="tiny" href="match.html?id=' + m.id + '">完整剖析 →</a>' +
      '</div>' +
      '<div class="m-recs">' + recsHtml(recs) + '</div>' +
    '</div>';
  }

  /* 各玩法推荐条：胜平负/让球 1 个 · 总进球/半全场 2 个 · 比分 3 个，按概率从高到低 */
  function recsHtml(recs) {
    if (!recs.length) return '';
    var ORDER = ['胜平负', '让球胜平负', '总进球', '半全场', '比分'];
    return ORDER.map(function (play) {
      var items = recs.filter(function (p) { return p.play === play; });
      if (!items.length) return '';
      return '<span class="rc-g"><span class="rc-p">' + play + '</span>' +
        items.map(function (p) {
          return '<span class="rc-i" title="' + (p.basis === 'market' ? '市场隐含概率' : '模型概率') + ' ' + U.pct(p.p, 1) + '">' +
            U.esc(p.sel) + (p.sp ? '<b>@' + U.odds(p.sp) + '</b>' : '') + '</span>';
        }).join('') + '</span>';
    }).join('');
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

/* ==========================================================================
   竞析 JINGXI · 数据源层（DataSource）
   --------------------------------------------------------------------------
   职责：把「外部真实数据」拉进来，规范化成与内置快照完全一致的结构，
        交给 core.js 的 Dixon-Coles 引擎重算全部概率。

   数据源：中国体育彩票 竞彩足球 官方公开数据接口
     https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry
     - 提供：赛事编号 / 联赛 / 双方队名 / 开赛时间 / 胜平负SP / 让球盘+SP
             / 总进球SP(0~7+) / 比分SP / 半全场SP
     - 跨域：响应头 access-control-allow-origin: *，浏览器可直接 fetch
     - 注意：该接口 WAF 要求请求携带 Referer，浏览器跨域请求默认会带上
             （Referrer-Policy 默认 strict-origin-when-cross-origin），无需额外处理

   关键设计：λ 由市场反解
     本数据源不提供 xG / 伤停 / 交锋等基本面字段，因此无法训练「独立于市场」的
     预测模型。本层的做法是把官方赔率去水后作为观测目标，反解出使模型概率
     最贴合市场的 λ（二维最小二乘）。
     这在方法论上必须说清楚：
       · 模型概率 ≈ 市场隐含概率，因此它不具备「独立于市场」的预测优势；
       · 价值判断来自不同玩法之间的定价一致性偏差（例如总进球盘与胜平负盘
         对同一场比赛的进球强度定价不一致时产生分歧）；
       · 这是诚实的能力边界，不是缺陷 —— 页面会明示这一点。
   ========================================================================== */
(function (global) {
  'use strict';

  var U = global.JX && global.JX.U, M = global.JX && global.JX.M;
  if (!U || !M) { console.error('[竞析] datasource.js 必须在 core.js 之后加载'); return; }

  var API = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry';
  var POOLS = 'hhad,had,ttg,crs,hafu';
  var CACHE_KEY = 'jx.ds.cache.v2';
  var CACHE_TTL = 6 * 60 * 60 * 1000;   // 6 小时内视为新鲜，先渲染再后台校准

  /* ------------------------------------------------------------------ 状态 */
  var state = {
    mode: 'demo',            // 'demo' 内置演示快照 | 'live' 官方实时数据
    source: '内置演示快照',
    updatedAt: '',           // 数据时间（展示用）
    fetchedAt: '',           // 本机抓取时间
    count: 0,
    loading: false,
    progress: '',
    error: '',
    lastLatency: 0,
    remoteUpdate: ''         // 接口返回的 lastUpdateTime
  };
  var listeners = [];

  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } }); }

  /* -------------------------------------------------------------- 工具函数 */
  function sq(v) { return v * v; }

  /* 三项去水（等比归一） */
  function devig3(h, d, a) {
    var ih = 1 / h, id = 1 / d, ia = 1 / a, s = ih + id + ia;
    if (!isFinite(s) || s <= 0) return null;
    return { p: [ih / s, id / s, ia / s], margin: s - 1 };
  }

  /* N 项去水 */
  function devigN(arr) {
    var inv = arr.map(function (o) { return 1 / o; });
    var s = inv.reduce(function (x, y) { return x + y; }, 0);
    if (!isFinite(s) || s <= 0) return null;
    return { p: inv.map(function (v) { return v / s; }), margin: s - 1 };
  }

  /* ---------------- λ 反解：使模型概率最贴合去水后的市场概率 ---------------- */
  function buildObservations(raw) {
    var obs = [];
    var had = raw.had || {};
    if (had.h && had.d && had.a) {
      var v1 = devig3(+had.h, +had.d, +had.a);
      if (v1) obs.push({ kind: '1x2', p: v1.p, w: 1.0 });
    }
    var hhad = raw.hhad || {};
    if (hhad.h && hhad.d && hhad.a && hhad.goalLine !== '' && hhad.goalLine !== undefined && hhad.goalLine !== null) {
      var v2 = devig3(+hhad.h, +hhad.d, +hhad.a);
      var line = parseFloat(hhad.goalLine);
      if (v2 && isFinite(line)) obs.push({ kind: 'rq', p: v2.p, line: line, w: 0.6 });
    }
    var ttg = raw.ttg || {};
    var ttgOdds = [];
    for (var i = 0; i <= 7; i++) {
      var o = ttg['s' + i];
      ttgOdds.push(o === undefined || o === null || o === '' ? null : +o);
    }
    if (ttgOdds.filter(function (x) { return x !== null && isFinite(x) && x > 1; }).length >= 6) {
      var filled = ttgOdds.map(function (x) { return (x === null || !isFinite(x) || x <= 1) ? null : x; });
      var ok = filled.filter(function (x) { return x !== null; });
      var v3 = devigN(ok);
      if (v3) {
        var probs = [], k = 0;
        for (var j = 0; j < 8; j++) { probs.push(filled[j] === null ? null : v3.p[k++]); }
        obs.push({ kind: 'ttg', p: probs, w: 0.4 });
      }
    }
    return obs;
  }

  function lossAt(lh, la, obs) {
    var r = M.derive(lh, la), e = 0, i;
    for (i = 0; i < obs.length; i++) {
      var o = obs[i], w = o.w;
      if (o.kind === '1x2') {
        e += w * (sq(r.w - o.p[0]) + sq(r.d - o.p[1]) + sq(r.l - o.p[2]));
      } else if (o.kind === 'rq') {
        var q = M.handicapProbs(r, o.line);
        e += w * (sq(q.w - o.p[0]) + sq(q.d - o.p[1]) + sq(q.l - o.p[2]));
      } else if (o.kind === 'ttg') {
        for (var k = 0; k < 8; k++) {
          if (o.p[k] === null) continue;
          e += w * sq(M.bucket(r, k) - o.p[k]);
        }
      }
    }
    return e;
  }

  /* 粗网格 + 坐标下降精修，得到市场反解 λ */
  function solveLambda(obs) {
    if (!obs.length) return [1.35, 1.10];   // 联赛场均基准兜底
    var best = { lh: 1.35, la: 1.10, e: Infinity };
    var lh, la, e;
    for (lh = 0.15; lh <= 4.35; lh += 0.1) {
      for (la = 0.15; la <= 4.35; la += 0.1) {
        e = lossAt(lh, la, obs);
        if (e < best.e) { best = { lh: lh, la: la, e: e }; }
      }
    }
    /* 坐标下降：逐步缩小步长，避免陷入 0.1 网格的量化误差 */
    var steps = [0.04, 0.015, 0.005, 0.0015];
    steps.forEach(function (st) {
      var improved = true, guard = 0;
      while (improved && guard++ < 60) {
        improved = false;
        [[st, 0], [-st, 0], [0, st], [0, -st]].forEach(function (d) {
          var n1 = Math.max(0.1, Math.min(6, best.lh + d[0]));
          var n2 = Math.max(0.1, Math.min(6, best.la + d[1]));
          var ne = lossAt(n1, n2, obs);
          if (ne < best.e - 1e-12) { best = { lh: n1, la: n2, e: ne }; improved = true; }
        });
      }
    });
    return [Math.round(best.lh * 1000) / 1000, Math.round(best.la * 1000) / 1000];
  }

  /* ------------------------------------------------------------ 规范化输出 */
  function parseRank(s) {
    var m = String(s || '').match(/(\d+)\s*\]?\s*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  /* 队名规范化：港澳台球队统一使用「中国香港 / 中国澳门 / 中国台湾」的完整称谓 */
  function fixName(s) {
    return String(s || '')
      .replace(/中国港(?=[女男队]|$)/g, '中国香港')
      .replace(/中国澳(?=[女男队]|$)/g, '中国澳门')
      .replace(/中国台(?=[女男队]|$)/g, '中国台湾')
      .replace(/^香港(?=[女男队]|$)/, '中国香港')
      .replace(/^澳门(?=[女男队]|$)/, '中国澳门')
      .replace(/^台湾(?=[女男队]|$)/, '中国台湾');
  }

  function dayKey(businessDate) {
    try {
      var t = new Date();
      var today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
      var parts = String(businessDate).split('-');
      var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      var diff = Math.round((d - today) / 86400000);
      if (diff <= 0) return 'today';
      if (diff === 1) return 'tomorrow';
      if (diff === 2) return 'after';
      return 'later';
    } catch (e) { return 'today'; }
  }

  var CN = ['零', '一', '二', '三', '四', '五', '六', '日'];
  function cnDay(dateStr) {
    try {
      var p = String(dateStr).split('-');
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      return '周' + CN[d.getDay()];
    } catch (e) { return ''; }
  }

  /* 从一场比赛里挑出各玩法的最优方向 */
  function buildPicks(raw, res) {
    var picks = [];
    var minEv = (global.JX_DATA && global.JX_DATA.model && global.JX_DATA.model.params.evThreshold) || 0.02;

    function push(play, sel, sp, p, mktP) {
      if (!isFinite(sp) || sp <= 1 || !isFinite(p) || p <= 0) return;
      var ev = p * sp - 1;
      picks.push({
        play: play, sel: sel, sp: sp, p: p, mktP: mktP, ev: ev,
        edge: (mktP === null || mktP === undefined) ? null : p - mktP
      });
    }

    var had = raw.had || {};
    if (had.h && had.d && had.a) {
      var v1 = devig3(+had.h, +had.d, +had.a);
      if (v1) {
        push('胜平负', '主胜', +had.h, res.w, v1.p[0]);
        push('胜平负', '平局', +had.d, res.d, v1.p[1]);
        push('胜平负', '客胜', +had.a, res.l, v1.p[2]);
      }
    }
    var hhad = raw.hhad || {};
    if (hhad.h && hhad.d && hhad.a && hhad.goalLine !== '' && hhad.goalLine !== undefined && hhad.goalLine !== null) {
      var line = parseFloat(hhad.goalLine);
      var v2 = devig3(+hhad.h, +hhad.d, +hhad.a);
      if (v2 && isFinite(line)) {
        var q = M.handicapProbs(res, line);
        push('让球胜平负', '让胜', +hhad.h, q.w, v2.p[0]);
        push('让球胜平负', '让平', +hhad.d, q.d, v2.p[1]);
        push('让球胜平负', '让负', +hhad.a, q.l, v2.p[2]);
      }
    }
    var ttg = raw.ttg || {};
    var vals = [], idx = [];
    for (var i = 0; i <= 7; i++) {
      var o = ttg['s' + i];
      if (o !== undefined && o !== null && o !== '' && +o > 1) { vals.push(+o); idx.push(i); }
    }
    if (vals.length >= 6) {
      var v3 = devigN(vals);
      if (v3) {
        for (var k = 0; k < idx.length; k++) {
          var n = idx[k];
          push('总进球', n === 7 ? '7+球' : n + '球', vals[k], M.bucket(res, n), v3.p[k]);
        }
      }
    }
    return picks;
  }

  function normalizeMatch(raw, meta) {
    var had = raw.had || {}, hhad = raw.hhad || {};
    var sp = (had.h && had.d && had.a) ? { w: +had.h, d: +had.d, l: +had.a } : null;
    if (!sp) return null;                                  // 无胜平负赔率则不可分析

    var hasRq = hhad.h && hhad.d && hhad.a && hhad.goalLine !== '' && hhad.goalLine !== undefined && hhad.goalLine !== null;
    var rqLine = hasRq ? parseFloat(hhad.goalLine) : -1;
    var rq = hasRq
      ? { line: rqLine, w: +hhad.h, d: +hhad.d, l: +hhad.a, label: '让球 ' + (rqLine > 0 ? '+' : '') + rqLine }
      : { line: rqLine, w: sp.w, d: sp.d, l: sp.l, label: '让球 ' + rqLine + '（接口未提供）' };

    var obs = buildObservations(raw);
    var lam = solveLambda(obs);
    var res = M.derive(lam[0], lam[1]);

    var id = 'sp' + (raw.matchNumDate || '') + (raw.matchNum || '');
    var homeRank = parseRank(raw.homeRank);
    var awayRank = parseRank(raw.awayRank);

    var picks = buildPicks(raw, res);
    var minEv = (global.JX_DATA && global.JX_DATA.model && global.JX_DATA.model.params.evThreshold) || 0.02;
    var pickList = picks
      .filter(function (p) { return p.ev > minEv; })
      .sort(function (a, b) { return b.ev - a.ev; })
      .slice(0, 2);

    var bestEv = picks.length ? Math.max.apply(null, picks.map(function (p) { return p.ev; })) : -1;
    var conf = 3;
    if (bestEv > 0.08) conf = 5; else if (bestEv > 0.04) conf = 4; else if (bestEv > 0) conf = 3; else if (bestEv > -0.05) conf = 2; else conf = 1;
    if (obs.length < 2) conf = Math.max(1, conf - 1);

    var homeName = fixName(raw.homeTeamAllName || raw.homeTeamAbbName || '');
    var homeShort = fixName(raw.homeTeamAbbName || raw.homeTeamAllName || '');
    var awayName = fixName(raw.awayTeamAllName || raw.awayTeamAbbName || '');
    var awayShort = fixName(raw.awayTeamAbbName || raw.awayTeamAllName || '');
    var league = fixName(raw.leagueAbbName || raw.leagueAllName || '未知');

    return {
      id: id,
      no: raw.matchNumStr || '',
      league: league,
      leagueFull: fixName(raw.leagueAllName || ''),
      day: dayKey(raw.businessDate),
      date: raw.matchDate,
      businessDate: raw.businessDate,
      kickoff: String(raw.matchTime || '').slice(0, 5),
      kickoffFull: raw.matchDate + ' ' + String(raw.matchTime || '').slice(0, 5),
      venue: '',
      season: '',
      home: {
        name: homeName,
        short: homeShort,
        en: raw.homeTeamAbbEnName || '',
        rank: homeRank,
        recent: null, homeRec: null, star: '', inj: [],
        played: null, pts: null, gf: null, ga: null,
        xg: null, xga: null, form: null
      },
      away: {
        name: awayName,
        short: awayShort,
        en: raw.awayTeamAbbEnName || '',
        rank: awayRank,
        recent: null, homeRec: null, star: '', inj: [],
        played: null, pts: null, gf: null, ga: null,
        xg: null, xga: null, form: null
      },
      sp: sp,
      rq: rq,
      euro: { open: { w: sp.w, d: sp.d, l: sp.l }, cur: { w: sp.w, d: sp.d, l: sp.l } },
      asian: null,
      ou: null,
      volume: null,
      kelly: null,
      h2h: null,
      lam: lam,
      conf: conf,
      picks: pickList.map(function (p) {
        return {
          play: p.play, sel: p.sel, sp: p.sp, stake: stakeFor(p),
          note: '模型 ' + U.pct(p.p, 1) + ' · 市场隐含 ' + U.pct(p.mktP, 1) +
            ' · 边际 ' + U.signed(p.p - p.mktP, 1) + ' · EV ' + U.signed(p.ev, 1)
        };
      }),
      risk: '数据来自中国体彩网公开接口，仅包含赛事与赔率信息，不含球队基本面（xG / 伤停 / 交锋）。' +
        '模型由市场赔率反解 λ，因此不具备独立于市场的预测优势。',
      summary: (raw.homeTeamAbbName || '') + ' 主场对阵 ' + (raw.awayTeamAbbName || '') +
        '，模型反解 λ ' + lam[0].toFixed(2) + ' / ' + lam[1].toFixed(2) + '，期望总进球 ' + (lam[0] + lam[1]).toFixed(2) + '。',
      tags: [raw.leagueAbbName || '', obs.length >= 3 ? '多盘口拟合' : '单盘口拟合'],
      source: 'sporttery',
      coverage: {
        odds: true, rq: hasRq, ttg: obs.some(function (o) { return o.kind === 'ttg'; }),
        crs: !!(raw.crs && Object.keys(raw.crs).length),
        hafu: !!(raw.hafu && Object.keys(raw.hafu).length),
        xg: false, form: false, injury: false, h2h: false, asian: false, euroTrend: false
      },
      _raw: {
        ttg: raw.ttg || {}, crs: raw.crs || {}, hafu: raw.hafu || {},
        hhad: raw.hhad || {}, had: raw.had || {}, oddsList: raw.oddsList || [],
        poolList: raw.poolList || [], matchId: raw.matchId
      }
    };
  }

  function stakeFor(p) {
    var D = global.JX_DATA;
    var frac = (D && D.model && D.model.params.kellyFraction) || 0.25;
    var cap = (D && D.model && D.model.params.maxPerMatch) || 0.015;
    var k = M.kelly(p.p, p.sp);
    return Math.round(Math.min(Math.max(0, k * frac), cap) * 100 * 100) / 100;
  }

  /* ------------------------------------------------------------ 网络请求 */
  /* 抓取链：直连（两次，其中一次补正 Referer）→ 公共 CORS 中继 → 失败。
     官方接口本身对任意 Origin 返回 200 且 ACAO:*（实测），用户端失败多为
     本地网络环境（代理 / 广告拦截 / 运营商间歇阻断），因此多路径重试意义最大。 */
  var PROXIES = [
    { name: 'allorigins', wrap: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
    { name: 'codetabs', wrap: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); } },
    { name: 'cors.lol', wrap: function (u) { return 'https://api.cors.lol/?url=' + encodeURIComponent(u); } }
  ];

  function fetchJSON(url, opt, timeoutMs) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 10000) : null;
    var o = opt || {};
    o.method = 'GET';
    o.mode = 'cors';
    o.credentials = 'omit';
    o.cache = 'no-store';
    o.headers = o.headers || { 'Accept': 'application/json' };
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  function parsePayload(json) {
    if (!json || json.success !== true || !json.value) {
      throw new Error('接口返回异常');
    }
    var v = json.value, list = [];
    (v.matchInfoList || []).forEach(function (day) {
      (day.subMatchList || []).forEach(function (raw) {
        if (raw.isHide) return;
        var m = normalizeMatch(raw, {});
        if (m) list.push(m);
      });
    });
    if (!list.length) throw new Error('接口未返回可分析赛事');
    return { matches: list, remoteUpdate: v.lastUpdateTime || '', totalCount: v.totalCount || list.length };
  }

  function fetchRemote() {
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('当前运行环境不支持 fetch'));
    }
    var url = API + '?poolCode=' + POOLS + '&channel=c';
    var t0 = Date.now();

    /* 尝试序列：每个环节失败自动进入下一个 */
    var attempts = [
      function () { return fetchJSON(url, null, 10000); },
      function () { return fetchJSON(url, { referrer: 'https://www.sporttery.cn/' }, 10000); }
    ];
    PROXIES.forEach(function (px) {
      attempts.push(function () { return fetchJSON(px.wrap(url), null, 9000); });
    });

    function tryAt(i) {
      if (i >= attempts.length) {
        return Promise.reject(new Error('所有通道均不可达'));
      }
      return attempts[i]().then(parsePayload).catch(function () { return tryAt(i + 1); });
    }

    return tryAt(0).then(function (payload) {
      state.lastLatency = Date.now() - t0;
      state.channel = state.channel || '直连';
      return payload;
    });
  }

  /* ------------------------------------------------------ 缓存（localStorage） */
  function saveCache(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        t: Date.now(), matches: payload.matches, remoteUpdate: payload.remoteUpdate
      }));
    } catch (e) { /* 隐私模式或超配额，忽略 */ }
  }
  function loadCache() {
    try {
      var s = localStorage.getItem(CACHE_KEY);
      if (!s) return null;
      var o = JSON.parse(s);
      if (!o || !o.matches || !o.matches.length) return null;
      return o;
    } catch (e) { return null; }
  }
  function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) { } }

  /* ------------------------------------------------------------ 应用数据 */
  function apply(payload, opt) {
    opt = opt || {};
    var D = global.JX_DATA;
    if (!D) return;
    D.matches = payload.matches;
    state.mode = 'live';
    state.source = '中国体彩网 · 竞彩足球官方接口';
    state.count = payload.matches.length;
    state.remoteUpdate = payload.remoteUpdate || '';
    state.updatedAt = payload.remoteUpdate || nowStr();
    state.fetchedAt = nowStr();
    if (opt.fromCache) state.source = '本地缓存快照（来自官方接口）';

    D.meta.dataMode = 'live';
    D.meta.updatedAt = state.updatedAt;
    D.meta.refreshNote = '数据来自中国体育彩票官方公开接口，页面加载时自动获取，点「数据更新」可立即重新拉取。';

    /* 联赛看板：真实数据不足以支撑 xG 类指标，改为覆盖度说明 */
    D.meta.liveNotice = '当前为官方实时数据模式：赛事、赔率、玩法 SP 均为真实数据；' +
      '球队基本面（xG、伤停、交锋、亚指水位）该接口不提供，相关模块已自动降级并标注。';

    if (global.JX && global.JX.clearModelCache) global.JX.clearModelCache();
    emit();
  }

  function revertToDemo(reason) {
    var D = global.JX_DATA;
    state.mode = 'demo';
    state.source = '内置演示快照';
    state.count = (D.matches || []).length;
    state.error = reason || '';
    if (D.meta) {
      D.meta.dataMode = 'demo';
      D.meta.updatedAt = D.meta.demoUpdatedAt || D.meta.updatedAt;
    }
    if (global.JX && global.JX.clearModelCache) global.JX.clearModelCache();
    emit();
  }

  function nowStr() {
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
      p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }

  /* --------------------------------------------------------------- 对外 API */
  var DS = {};

  DS.state = function () { return state; };

  DS.on = function (fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); }; };

  DS.fmt = function () {
    if (state.mode === 'live') {
      return { mode: 'live', text: '实时数据', time: state.fetchedAt, source: state.source, count: state.count };
    }
    return { mode: 'demo', text: '演示数据', time: state.updatedAt || '—', source: state.source, count: state.count };
  };

  /* 手动更新：用户点「数据更新」触发 */
  DS.refresh = function () {
    if (state.loading) return Promise.resolve({ ok: false, reason: 'busy' });
    state.loading = true; state.error = ''; state.progress = '正在连接官方数据接口…';
    emit();
    return fetchRemote().then(function (payload) {
      state.progress = '正在反解模型参数…';
      emit();
      apply(payload, {});
      state.progress = '';
      saveCache(payload);
      return { ok: true, count: payload.matches.length, remoteUpdate: payload.remoteUpdate, latency: state.lastLatency };
    }).catch(function (err) {
      /* 失败不吓人：优先用「上次成功的实时快照」顶上（不论多旧），
         实在没有才安静回退到演示数据（即初版形态）。 */
      state.progress = '';
      state.loading = false;
      state.error = (err && err.message) ? err.message : String(err);
      var stale = loadCache();
      if (stale) {
        apply({ matches: stale.matches, remoteUpdate: stale.remoteUpdate }, { fromCache: true });
        state.source = '本地缓存快照（官方接口历史数据）';
        emit();
        return { ok: false, reason: '接口暂时不可达，已展示上次成功获取的实时数据（' + new Date(stale.t).toLocaleString() + '）' };
      }
      revertToDemo('');
      emit();
      return { ok: false, reason: '接口暂时不可达，已切换为演示数据，可稍后重试' };
    }).then(function (res) {
      state.loading = false;
      emit();
      return res;
    });
  };

  /* 启动：先用缓存/快照渲染，再静默校准 */
  DS.init = function () {
    var D = global.JX_DATA;
    if (!D) return;
    D.meta.demoUpdatedAt = D.meta.updatedAt;
    state.count = (D.matches || []).length;

    var c = loadCache();
    if (c && Date.now() - c.t < CACHE_TTL) {
      state.progress = '加载本地缓存…';
      apply({ matches: c.matches, remoteUpdate: c.remoteUpdate }, { fromCache: true });
      state.progress = '';
    }
    /* 无论有无缓存，都尝试静默拉一次最新（失败则保持演示/缓存） */
    return DS.refresh().then(function (r) {
      if (!r.ok && !c) revertToDemo('');
      return r;
    });
  };

  DS.clearCache = clearCache;
  DS.devig3 = devig3;
  DS.devigN = devigN;
  DS.solveLambda = solveLambda;
  DS.buildObservations = buildObservations;
  DS.normalizeMatch = normalizeMatch;

  global.JX.DS = DS;
})(window);

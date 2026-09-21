/* ==========================================================================
   竞析 JINGXI · 前端渲染与计算引擎
   --------------------------------------------------------------------------
   核心原则：页面上出现的每一个概率、公平赔率、价值 EV、比分分布，
   都由 Dixon-Coles 修正泊松模型在浏览器端实时计算得出，不读死值。
   任何一个数字都可以被追溯到公式与 λ 参数。
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.JX_DATA;
  var JX = {};

  /* ======================================================================
     A. 通用工具
     ====================================================================== */
  var U = {
    pct: function (v, d) { return (v * 100).toFixed(d === undefined ? 1 : d) + '%'; },
    num: function (v, d) { return Number(v).toFixed(d === undefined ? 2 : d); },
    sign: function (v, d) { return (v > 0 ? '+' : v < 0 ? '' : '') + (v * 100).toFixed(d === undefined ? 1 : d) + '%'; },
    signed: function (v, d) { var x = (v * 100).toFixed(d === undefined ? 1 : d); return (v > 0 ? '+' : '') + x + '%'; },
    money: function (v) { return (v > 0 ? '+' : '') + v.toFixed(2) + 'u'; },
    odds: function (v) { return Number(v).toFixed(2); },
    esc: function (s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    qs: function (k) {
      try { return new URLSearchParams(global.location.search).get(k); } catch (e) { return null; }
    },
    byId: function (id) { return document.getElementById(id); },
    el: function (sel) { return document.querySelector(sel); },
    all: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    /* 别名：页面层使用 $ / $$ 简写，此处统一补齐（此前缺失导致筛选按钮点击即抛错） */
    elAll: function (sel, root) { return this.all(sel, root); },
    '$': function (sel, root) { return (root || document).querySelector(sel); },
    '$$': function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    /* 数组辅助（串关页组合去重、统计常用） */
    uniq: function (arr) {
      var seen = {}, out = [];
      (arr || []).forEach(function (v) { var k = 'k' + v; if (!seen[k]) { seen[k] = 1; out.push(v); } });
      return out;
    },
    sum: function (arr) { return (arr || []).reduce(function (a, b) { return a + (Number(b) || 0); }, 0); },
    mean: function (arr) { return arr && arr.length ? this.sum(arr) / arr.length : 0; },
    clamp: function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
    on: function (root, evt, sel, fn) {
      (root || document).addEventListener(evt, function (e) {
        var t = e.target.closest(sel);
        if (t && (root || document).contains(t)) fn.call(t, e, t);
      });
    }
  };
  JX.U = U;

  /* ======================================================================
     B. 模型数学：Dixon-Coles 修正泊松
     ---------------------------------------------------------------------
     1) 独立泊松:  P(X=x) = e^-λ · λ^x / x!
     2) DC 低比分修正: τ(x,y) = 1 + ρ·(x−λh)·(y−λa) 的简化形式，
        对 0:0 / 1:0 / 0:1 / 1:1 四格做相关性校正
     3) 归一化后得到联合分布，再聚合出胜平负、总进球、比分 Top-N
     ====================================================================== */
  var M = {};
  var RHO = -0.062;          // 联赛滚动估计的低比分相关系数
  var MAXG = 9;              // 比分矩阵上限（0..9 球）

  M.fact = (function () {
    var f = [1];
    for (var i = 1; i <= 20; i++) f[i] = f[i - 1] * i;
    return f;
  })();

  M.pois = function (k, lam) {
    if (k > 20) k = 20;
    return Math.exp(-lam) * Math.pow(lam, k) / M.fact[k];
  };

  M.tau = function (x, y, lh, la) {
    if (x === 0 && y === 0) return 1 - lh * la * RHO;
    if (x === 0 && y === 1) return 1 + lh * RHO;
    if (x === 1 && y === 0) return 1 + la * RHO;
    if (x === 1 && y === 1) return 1 - RHO;
    return 1;
  };

  /* 生成归一化的比分联合分布矩阵 */
  M.matrix = function (lh, la) {
    var m = [], x, y, s = 0;
    for (x = 0; x <= MAXG; x++) {
      m[x] = [];
      for (y = 0; y <= MAXG; y++) {
        var p = M.tau(x, y, lh, la) * M.pois(x, lh) * M.pois(y, la);
        if (p < 0) p = 0;
        m[x][y] = p; s += p;
      }
    }
    for (x = 0; x <= MAXG; x++) for (y = 0; y <= MAXG; y++) m[x][y] /= s;
    return m;
  };

  /* 由 λ 推导完整模型输出 */
  M.derive = function (lh, la) {
    var m = M.matrix(lh, la), x, y;
    var res = {
      lam: [lh, la], matrix: m,
      w: 0, d: 0, l: 0,           // 胜 / 平 / 负
      goals: [0, 0, 0, 0, 0, 0],  // 总进球 0,1,2,3,4,5+
      btts: 0, over25: 0, over275: 0, over3: 0,
      scores: [],
      handicap: {}                // 让球档位净胜球
    };
    for (x = 0; x <= MAXG; x++) {
      for (y = 0; y <= MAXG; y++) {
        var p = m[x][y], t = x + y;
        if (x > y) res.w += p; else if (x === y) res.d += p; else res.l += p;
        res.goals[t >= 5 ? 5 : t] += p;
        if (x > 0 && y > 0) res.btts += p;
        if (t >= 3) res.over25 += p;
        if (t >= 3) res.over275 += p;
        if (t >= 4) res.over3 += p;
        res.scores.push({ s: x + ':' + y, p: p, gd: x - y });
      }
    }
    res.scores.sort(function (a, b) { return b.p - a.p; });
    /* 净胜球分布（用于让球盘评估） */
    for (var k = -MAXG; k <= MAXG; k++) {
      var acc = 0;
      for (x = 0; x <= MAXG; x++) { y = x - k; if (y >= 0 && y <= MAXG) acc += m[x][y]; }
      res.handicap[k] = acc;
    }
    return res;
  };

  /* 去水：把欧赔转成市场隐含概率（Shin 方法简化实现，等比去水） */
  M.devig = function (o) {
    var iw = 1 / o.w, id = 1 / o.d, il = 1 / o.l;
    var s = iw + id + il;
    return { w: iw / s, d: id / s, l: il / s, margin: s - 1 };
  };

  /* 公平赔率 = 1 / 概率 */
  M.fairOdds = function (p) { return p > 0 ? 1 / p : 0; };

  /* 期望值 EV = p × SP − 1 */
  M.ev = function (p, sp) { return p * sp - 1; };

  /* 凯利分数 f* = (p·b − q) / b ,  b = SP − 1 */
  M.kelly = function (p, sp) {
    var b = sp - 1, q = 1 - p;
    if (b <= 0) return 0;
    return (p * b - q) / b;
  };

  /* 让球盘的等效概率：给定让球线 line（主队让球为负），
     计算 让胜 / 让平 / 让负（含半球盘的走盘处理） */
  M.handicapProbs = function (res, line) {
    var lw = 0, ld = 0, ll = 0, half = false, i;
    /* 整数盘 vs 半球盘 */
    if (Math.abs(line - Math.round(line)) > 0.01) half = true;
    for (i = 0; i < res.scores.length; i++) {
      var gd = res.scores[i].gd + line, p = res.scores[i].p;
      if (half) { if (gd > 0) lw += p; else ll += p; }
      else { if (gd > 0) lw += p; else if (gd === 0) ld += p; else ll += p; }
    }
    return { w: lw, d: ld, l: ll };
  };

  JX.M = M;

  /* 总进球数的精确概率（由比分矩阵聚合，不使用归并后的粗粒度数组） */
  M.totalProb = function (res, t) {
    var m = res.matrix, acc = 0, x, y;
    for (x = 0; x <= MAXG; x++) { y = t - x; if (y >= 0 && y <= MAXG) acc += m[x][y]; }
    return acc;
  };

  /* 竞彩「总进球」玩法档位：0,1,2,3,4,5,6,7+ */
  M.bucket = function (res, n) {
    if (n >= 7) {
      var acc = 0;
      for (var t = 7; t <= MAXG * 2; t++) acc += M.totalProb(res, t);
      return acc;
    }
    return M.totalProb(res, n);
  };
  M.bucketLabel = function (n) { return n >= 7 ? '7+' : String(n); };

  /* 亚盘大小球：支持整数盘 / 半球盘 / 四分之一盘（按半仓拆分） */
  M.overUnder = function (res, line) {
    var frac = Math.abs(line - Math.round(line)), parts = [];
    if (Math.abs(frac - 0.5) < 1e-9 || Math.abs(frac) < 1e-9) parts = [line];
    else parts = [line - 0.25, line + 0.25];
    var over = 0, push = 0, under = 0;
    parts.forEach(function (L) {
      var w = 0, p = 0, l = 0;
      for (var t = 0; t <= MAXG * 2; t++) {
        var pr = M.totalProb(res, t);
        if (Math.abs(L - Math.round(L)) < 1e-9) {
          if (t > L) w += pr; else if (t === L) p += pr; else l += pr;
        } else {
          if (t > L) w += pr; else l += pr;
        }
      }
      over += w / parts.length; push += p / parts.length; under += l / parts.length;
    });
    return { over: over, push: push, under: under };
  };

  /* 取得某场比赛的模型输出（带缓存） */
  var _cache = {};
  /* 数据源切换（演示 ⇄ 实时）后必须清空，否则会命中旧 λ 的缓存 */
  JX.clearModelCache = function () { _cache = {}; };
  JX.model = function (m) {
    if (!_cache[m.id]) {
      _cache[m.id] = M.derive(m.lam[0], m.lam[1]);
      _cache[m.id].market = (m.euro && m.euro.cur) ? M.devig(m.euro.cur) : null;
      _cache[m.id].marketOpen = (m.euro && m.euro.open) ? M.devig(m.euro.open) : null;
      _cache[m.id].sp = m.sp ? M.devig(m.sp) : null;
      _cache[m.id].rq = (m.rq && isFinite(m.rq.line)) ? M.handicapProbs(_cache[m.id], m.rq.line) : null;
    }
    return _cache[m.id];
  };

  /* ======================================================================
     C. SVG 图表（零依赖，纯字符串生成）
     ====================================================================== */
  var C = {};

  /* 概率三段条 */
  C.pbar = function (p, h) {
    h = h || 8;
    return '<div class="pbar" style="height:' + h + 'px">' +
      '<i class="p-w" style="width:' + (p.w * 100) + '%"></i>' +
      '<i class="p-d" style="width:' + (p.d * 100) + '%"></i>' +
      '<i class="p-l" style="width:' + (p.l * 100) + '%"></i>' +
      '</div>';
  };

  /* 折线 / 多折线图。series: [{name,color,points:[v,...]}] */
  C.line = function (series, opt) {
    opt = opt || {};
    var W = opt.w || 620, H = opt.h || 170;
    var pl = opt.pl || 40, pr = 14, pt = 14, pb = opt.pb || 26;
    var iw = W - pl - pr, ih = H - pt - pb;
    var all = [];
    series.forEach(function (s) { s.points.forEach(function (v) { all.push(v); }); });
    var mn = opt.min !== undefined ? opt.min : Math.min.apply(null, all);
    var mx = opt.max !== undefined ? opt.max : Math.max.apply(null, all);
    if (mx === mn) { mx = mn + 1; }
    /* 仅当调用方未显式指定范围时才自动留白；显式指定则严格使用，保证坐标可读 */
    if (opt.min === undefined || opt.max === undefined) {
      var pad = (mx - mn) * 0.8;
      if (opt.tight) { mn = Math.min.apply(null, all); mx = Math.max.apply(null, all); }
      else { mn = mn - pad * 0.5; mx = mx + pad * 0.5; }
    }
    var n = series[0].points.length;
    var X = function (i) { return pl + (n === 1 ? iw / 2 : iw * i / (n - 1)); };
    /* xPoints：自定义每个点的横坐标（用于校准曲线：横轴=预测概率，纵轴=实际频率） */
    if (opt.xPoints && opt.xPoints.length === n) {
      var xmn = opt.xMin !== undefined ? opt.xMin : Math.min.apply(null, opt.xPoints);
      var xmx = opt.xMax !== undefined ? opt.xMax : Math.max.apply(null, opt.xPoints);
      X = function (i) { return pl + (opt.xPoints[i] - xmn) / (xmx - xmn) * iw; };
    }
    var Y = function (v) { return pt + ih - (v - mn) / (mx - mn) * ih; };
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">';
    /* 网格 */
    for (var g = 0; g <= 4; g++) {
      var yy = pt + ih * g / 4;
      s += '<line x1="' + pl + '" y1="' + yy + '" x2="' + (W - pr) + '" y2="' + yy + '" stroke="#e2e8f0" stroke-width="1"/>';
      var lv = mx - (mx - mn) * g / 4;
      s += '<text x="' + (pl - 6) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10" font-family="monospace" fill="#7d8b9e">' +
        (opt.fmtY ? opt.fmtY(lv) : lv.toFixed(2)) + '</text>';
    }
    /* 对角参考线（校准图用） */
    if (opt.diagonal) {
      s += '<line x1="' + X(0) + '" y1="' + Y(mn) + '" x2="' + X(n - 1) + '" y2="' + Y(mx) + '" stroke="#b8c4d4" stroke-width="1.4" stroke-dasharray="5 4"/>';
    }
    /* 数据线 */
    series.forEach(function (se) {
      var d = se.points.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
      if (se.area) {
        s += '<path d="' + d + ' L' + X(n - 1) + ' ' + (pt + ih) + ' L' + X(0) + ' ' + (pt + ih) + ' Z" fill="' + se.color + '" opacity="0.10"/>';
      }
      s += '<path d="' + d + '" fill="none" stroke="' + se.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      (se.points || []).forEach(function (v, i) {
        s += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (n > 20 ? 1.8 : 3.2) + '" fill="#fff" stroke="' + se.color + '" stroke-width="1.8"/>';
      });
    });
    /* X 轴标签 */
    (opt.xLabels || []).forEach(function (lb, i) {
      if (opt.xEvery && i % opt.xEvery !== 0 && i !== (opt.xLabels.length - 1)) return;
      s += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#7d8b9e">' + U.esc(lb) + '</text>';
    });
    return s + '</svg>';
  };

  /* 柱状图。items: [{label, value, color, sub}] */
  C.bars = function (items, opt) {
    opt = opt || {};
    var W = opt.w || 620, H = opt.h || 180;
    var pl = opt.pl || 42, pr = 12, pt = 12, pb = opt.pb || 30;
    var iw = W - pl - pr, ih = H - pt - pb;
    var vals = items.map(function (i) { return i.value; });
    var mx = opt.max !== undefined ? opt.max : Math.max.apply(null, vals);
    var mn = opt.min !== undefined ? opt.min : Math.min(0, Math.min.apply(null, vals));
    var bw = iw / items.length;
    var zeroY = pt + ih - (0 - mn) / (mx - mn) * ih;
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">';
    for (var g = 0; g <= 4; g++) {
      var yy = pt + ih * g / 4, lv = mx - (mx - mn) * g / 4;
      s += '<line x1="' + pl + '" y1="' + yy + '" x2="' + (W - pr) + '" y2="' + yy + '" stroke="#e2e8f0"/>';
      s += '<text x="' + (pl - 6) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10" font-family="monospace" fill="#7d8b9e">' + (opt.fmtY ? opt.fmtY(lv) : lv.toFixed(0)) + '</text>';
    }
    items.forEach(function (it, i) {
      var x = pl + bw * i + bw * 0.16, w = bw * 0.68;
      var yTop = pt + ih - (Math.max(it.value, 0) - mn) / (mx - mn) * ih;
      var yBot = pt + ih - (Math.min(it.value, 0) - mn) / (mx - mn) * ih;
      var col = it.color || '#123a6b';
      s += '<rect x="' + x.toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, yBot - yTop).toFixed(1) + '" rx="3" fill="' + col + '" opacity="0.88"/>';
      if (opt.showValue !== false) {
        s += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (it.value >= 0 ? yTop - 4 : yBot + 12).toFixed(1) + '" text-anchor="middle" font-size="10" font-family="monospace" font-weight="700" fill="' + col + '">' +
          (opt.fmtV ? opt.fmtV(it.value) : it.value) + '</text>';
      }
      s += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10" fill="#7d8b9e">' + U.esc(it.label) + '</text>';
    });
    if (mn < 0) s += '<line x1="' + pl + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + zeroY.toFixed(1) + '" stroke="#98a6b8" stroke-width="1.2"/>';
    return s + '</svg>';
  };

  /* 散点图（攻防效率）。items: [{x,y,label,color}] */
  C.scatter = function (items, opt) {
    opt = opt || {};
    var W = opt.w || 620, H = opt.h || 260;
    var pl = 46, pr = 16, pt = 16, pb = 34;
    var iw = W - pl - pr, ih = H - pt - pb;
    var xs = items.map(function (i) { return i.x; }), ys = items.map(function (i) { return i.y; });
    var x0 = Math.min.apply(null, xs) - 0.2, x1 = Math.max.apply(null, xs) + 0.2;
    var y0 = Math.min.apply(null, ys) - 0.2, y1 = Math.max.apply(null, ys) + 0.2;
    var X = function (v) { return pl + (v - x0) / (x1 - x0) * iw; };
    var Y = function (v) { return pt + ih - (v - y0) / (y1 - y0) * ih; };
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">';
    for (var g = 0; g <= 4; g++) {
      var yy = pt + ih * g / 4, xx = pl + iw * g / 4;
      s += '<line x1="' + pl + '" y1="' + yy + '" x2="' + (W - pr) + '" y2="' + yy + '" stroke="#e2e8f0"/>';
      s += '<line x1="' + xx + '" y1="' + pt + '" x2="' + xx + '" y2="' + (pt + ih) + '" stroke="#eef2f7"/>';
      s += '<text x="' + (pl - 6) + '" y="' + (yy + 3.5) + '" text-anchor="end" font-size="10" font-family="monospace" fill="#7d8b9e">' + (y1 - (y1 - y0) * g / 4).toFixed(1) + '</text>';
      s += '<text x="' + xx + '" y="' + (H - 18) + '" text-anchor="middle" font-size="10" font-family="monospace" fill="#7d8b9e">' + (x0 + (x1 - x0) * g / 4).toFixed(1) + '</text>';
    }
    /* 均值十字线 */
    var ax = pl + iw / 2, ay = pt + ih / 2;
    s += '<line x1="' + ax + '" y1="' + pt + '" x2="' + ax + '" y2="' + (pt + ih) + '" stroke="#c8d4e2" stroke-dasharray="4 4"/>';
    s += '<line x1="' + pl + '" y1="' + ay + '" x2="' + (W - pr) + '" y2="' + ay + '" stroke="#c8d4e2" stroke-dasharray="4 4"/>';
    items.forEach(function (it) {
      var col = it.color || '#123a6b';
      s += '<circle cx="' + X(it.x).toFixed(1) + '" cy="' + Y(it.y).toFixed(1) + '" r="5.5" fill="' + col + '" opacity="0.85"/>';
      s += '<text x="' + (X(it.x) + 8).toFixed(1) + '" y="' + (Y(it.y) + 3.5).toFixed(1) + '" font-size="10" fill="#47566b">' + U.esc(it.label) + '</text>';
    });
    s += '<text x="' + (W / 2) + '" y="' + (H - 3) + '" text-anchor="middle" font-size="10.5" fill="#7d8b9e">场均失球 xGA →（越左越好）</text>';
    return s + '</svg>';
  };

  /* 比分概率热力图 */
  C.heat = function (res, opt) {
    opt = opt || {};
    var N = opt.n || 5;
    var m = res.matrix;
    var mx = 0, x, y;
    for (x = 0; x < N; x++) for (y = 0; y < N; y++) mx = Math.max(mx, m[x][y]);
    var s = '<div style="display:grid;grid-template-columns:26px 1fr;gap:6px;align-items:start">';
    /* Y 轴 */
    s += '<div class="heat-axis" style="grid-template-rows:repeat(' + (N + 1) + ',1fr)"><span></span>';
    for (y = 0; y < N; y++) s += '<span>' + y + '</span>';
    s += '</div><div>';
    s += '<div class="heat-axis" style="grid-template-columns:repeat(' + N + ',1fr);margin-bottom:3px">';
    for (x = 0; x < N; x++) s += '<span>' + x + '</span>';
    s += '</div>';
    s += '<div class="heat" style="grid-template-columns:repeat(' + N + ',1fr)">';
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        var p = m[x][y], r = mx > 0 ? p / mx : 0;
        /* 主胜偏红 / 平局偏蓝 / 客胜偏绿 的语义着色 */
        var base = x > y ? [207, 43, 43] : (x === y ? [47, 111, 208] : [15, 138, 95]);
        var bg = 'rgba(' + base[0] + ',' + base[1] + ',' + base[2] + ',' + (0.08 + r * 0.8).toFixed(3) + ')';
        var fg = r > 0.45 ? '#fff' : '#16202e';
        s += '<div class="heat-cell" style="background:' + bg + ';color:' + fg + '">' + (p * 100).toFixed(1) + '</div>';
      }
    }
    s += '</div></div></div>';
    s += '<div class="tiny muted mt16">纵轴=主队进球，横轴=客队进球，数值为概率(%)。深色格子代表高概率比分区间。</div>';
    return s;
  };

  /* 主客对比条 */
  C.vsBar = function (label, lv, rv, opt) {
    opt = opt || {};
    var mx = Math.max(lv, rv) || 1;
    var lw = Math.max(2, lv / mx * 100), rw = Math.max(2, rv / mx * 100);
    return '<div class="vs-bar">' +
      '<div class="vb-l"><div class="vb-f" style="width:' + lw + '%"></div></div>' +
      '<div class="vb-c">' + label + '<b>' + (opt.fmt ? opt.fmt(lv) + ' : ' + opt.fmt(rv) : lv + ' : ' + rv) + '</b></div>' +
      '<div class="vb-r"><div class="vb-f" style="width:' + rw + '%"></div></div>' +
      '</div>';
  };

  /* 星级 */
  C.stars = function (n, max) {
    max = max || 5;
    var s = '<span class="stars" title="信心指数 ' + n + '/' + max + '">';
    for (var i = 1; i <= max; i++) {
      s += '<svg class="star ' + (i <= n ? 'on' : 'off') + '" viewBox="0 0 20 20"><path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z"/></svg>';
    }
    return s + '</span>';
  };

  /* 近期战绩方块 */
  C.form = function (arr, title) {
    return '<span class="form-row" title="' + U.esc(title || '近期战绩') + '">' +
      arr.map(function (r) {
        var c = r === 'W' ? 'w' : (r === 'D' ? 'd' : 'l');
        return '<span class="form-dot ' + c + '">' + r + '</span>';
      }).join('') + '</span>';
  };

  JX.C = C;

  /* 导出到全局：页面层（app.js / pages-*.js / boot.js）依赖此命名空间 */
  global.JX = JX;
})(window);

/* ==========================================================================
   竞析 JINGXI · 演示数据校准工具
   --------------------------------------------------------------------------
   作用：保证 data.js 中的「赔率」与「模型概率」严格自洽。
   在真实运行中，竞彩 SP 来自官方数据源；本脚本只在演示/校验场景下使用，
   用于回答一个问题：如果模型是对的，当前赔率意味着多大的价值？

   校准逻辑：
     竞彩各玩法的返奖率（1 − 毛利）不同：
       胜平负 91.5% / 让球胜平负 90.5% / 总进球 84% / 半全场 82% / 比分 80%
     对某一"模型看好"的结果 L，令
       EV_L = k · p_L / mkt_L − 1 = 目标值
     反解得市场隐含概率 mkt_L，其余结果按各自概率等比例承担剩余偏差，
     再按 SP = k / mkt 生成赔率。
     这样：① 三个结果的赔率来自同一组隐含概率，加入水位后自洽；
           ② 展示的 EV 与模型概率精确对应，不会出现"推荐负期望"的矛盾。
   运行： node tools/calibrate-demo-data.js
   ========================================================================== */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DATA_FILE = path.join(ROOT, 'assets/js/data.js');

/* ---- 加载数据与模型 ---- */
global.window = global;
require(path.join(ROOT, 'assets/js/data.js'));
require(path.join(ROOT, 'assets/js/core.js'));
var D = global.JX_DATA, M = global.JX.M;

/* ---- 各玩法返奖系数 k = 1 − 毛利 ---- */
var K = { '胜平负': 0.915, '让球胜平负': 0.905, '总进球': 0.840, '半全场': 0.820, '比分': 0.800 };

/* ---- 目标价值：按信心指数分档（越大越有信心，模型与市场的分歧越大） ---- */
var TARGET_EV = { 5: 0.030, 4: 0.025, 3: 0.015, 2: 0.008 };

/* ---- 每场的推荐计划（sel 为 null 表示由脚本按模型概率自动选择） ---- */
var PLAN = {
  m26091401: [{ play: '胜平负', sel: '主胜', conf: 4, stake: 1.0 },
              { play: '让球胜平负', sel: '让平', conf: 3, stake: 0.35 },
              { play: '总进球', sel: null, conf: 3, stake: 0.40 }],
  m26091402: [{ play: '胜平负', sel: '主胜', conf: 4, stake: 0.90 },
              { play: '总进球', sel: null, conf: 4, stake: 0.70 }],
  m26091403: [{ play: '胜平负', sel: '主胜', conf: 4, stake: 1.00 },
              { play: '总进球', sel: null, conf: 3, stake: 0.50 }],
  m26091404: [{ play: '让球胜平负', sel: '让胜', conf: 5, stake: 1.00 },
              { play: '总进球', sel: null, conf: 4, stake: 0.80 },
              { play: '胜平负', sel: '主胜', conf: 5, stake: 0.00 }],   // 主动放弃：低赔无价值
  m26091405: [{ play: '胜平负', sel: '主胜', conf: 3, stake: 0.50 }],
  m26091406: [{ play: '总进球', sel: null, conf: 3, stake: 0.45 },
              { play: '胜平负', sel: '平局', conf: 3, stake: 0.30 }],
  m26091501: [{ play: '总进球', sel: null, conf: 3, stake: 0.50 },
              { play: '胜平负', sel: '主胜', conf: 3, stake: 0.30 }],
  m26091502: [{ play: '胜平负', sel: '主胜', conf: 4, stake: 0.80 }],
  m26091503: [{ play: '胜平负', sel: '主胜', conf: 4, stake: 0.70 },
              { play: '总进球', sel: null, conf: 3, stake: 0.50 }],
  m26091504: [{ play: '总进球', sel: null, conf: 3, stake: 0.35 }],
  m26091601: [{ play: '胜平负', sel: '主胜', conf: 4, stake: 0.85 },
              { play: '总进球', sel: null, conf: 4, stake: 0.70 }],
  m26091602: [{ play: '总进球', sel: null, conf: 3, stake: 0.40 }],
  m26091603: [{ play: '总进球', sel: null, conf: 3, stake: 0.50 },
              { play: '胜平负', sel: '平局', conf: 2, stake: 0.15 }],
  m26091604: [{ play: '让球胜平负', sel: '让胜', conf: 3, stake: 0.40 },
              { play: '总进球', sel: null, conf: 3, stake: 0.45 }]
};

/* ---- 工具 ---- */
function r2(v) { return Math.round(v * 100) / 100; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* 竞彩总进球玩法：猜进球总数 0,1,2,3,4,5,6,7+ */
var BUCKETS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

function bucketProbs(res) {
  /* 由比分矩阵精确聚合，避免 goals 数组 5+ 归并造成的信息损失 */
  var m = res.matrix, out = [];
  for (var k = 0; k <= 7; k++) {
    var acc = 0;
    for (var x = 0; x <= 9; x++) { var y = k - x; if (y >= 0 && y <= 9) acc += m[x][y]; }
    out.push(acc);
  }
  /* 7 以上合并到 7+ ，并把 7 也并入（竞彩最高档为 7+） */
  var seven = out[7];
  for (var k2 = 8; k2 <= 18; k2++) {
    for (var x2 = 0; x2 <= 9; x2++) { var y2 = k2 - x2; if (y2 >= 0 && y2 <= 9) seven += m[x2][y2]; }
  }
  out[7] = seven;
  return out;
}

/* 三路盘：给定模型概率 p 与看好结果下标 liked，反解出市场隐含概率与赔率 */
function build3way(p, liked, k, targetEv) {
  var pL = p[liked];
  var d = 0;
  if (targetEv !== null && targetEv !== undefined) {
    var need = k * pL / (1 + targetEv);
    d = Math.max(0, pL - need);
  }
  var rest = 1 - pL;
  var mkt = p.map(function (pi, i) {
    if (i === liked) return pi - d;
    return rest > 1e-9 ? pi + d * pi / rest : pi;
  });
  var sp = mkt.map(function (mi) { return Math.max(1.01, r2(k / mi)); });
  var ev = p.map(function (pi, i) { return pi * sp[i] - 1; });
  return { sp: sp, mkt: mkt, ev: ev, d: d };
}

/* 单结果盘（总进球 / 半全场 / 比分） */
function buildSingle(p, k, targetEv) {
  var d = 0;
  if (targetEv !== null && targetEv !== undefined) d = Math.max(0, p - k * p / (1 + targetEv));
  var mkt = Math.max(1e-6, p - d);
  var sp = Math.max(1.01, r2(k / mkt));
  return { sp: sp, mkt: mkt, ev: p * sp - 1 };
}

var IDX = { '主胜': 0, '平局': 1, '客胜': 2, '让胜': 0, '让平': 1, '让负': 2 };

/* ---- 主流程 ---- */
var src = fs.readFileSync(DATA_FILE, 'utf8');
fs.writeFileSync(path.join(ROOT, 'tools/data.backup.js'), src);

var report = [];
var newPicks = {};

D.matches.forEach(function (m) {
  var res = global.JX.model(m);
  var plan = PLAN[m.id] || [];
  var p3 = [res.w, res.d, res.l];
  var prq = [res.rq.w, res.rq.d, res.rq.l];
  var bp = bucketProbs(res);

  /* --- 1. 生成推荐 --- */
  var picks = [];
  plan.forEach(function (pl) {
    var k = K[pl.play];
    var stake = pl.stake;
    var tgt = stake > 0 ? TARGET_EV[pl.conf] : null;   // stake = 0 → 主动放弃，按市场无偏差定价
    var sel = pl.sel, p, built;

    if (pl.play === '总进球') {
      /* 取模型概率最高的进球数档位 */
      var bi = 0;
      bp.forEach(function (v, i) { if (v > bp[bi]) bi = i; });
      sel = '总进球 ' + BUCKETS[bi];
      p = bp[bi];
      built = buildSingle(p, k, tgt);
      picks.push({
        play: pl.play, sel: sel, sp: built.sp, conf: pl.conf, stake: stake, ev: built.ev,
        note: '合计 λ=' + (m.lam[0] + m.lam[1]).toFixed(2) + '，模型给出该进球数概率 ' +
              (p * 100).toFixed(1) + '%，市场隐含 ' + (built.mkt * 100).toFixed(1) + '%'
      });
    } else {
      var arr = pl.play === '胜平负' ? p3 : prq;
      var li = IDX[sel];
      p = arr[li];
      built = build3way(arr, li, k, tgt);
      picks.push({
        play: pl.play, sel: sel, sp: built.sp[li], conf: pl.conf, stake: stake, ev: built.ev[li],
        note: stake > 0
          ? '模型概率 ' + (p * 100).toFixed(1) + '%，市场隐含 ' + (built.mkt[li] * 100).toFixed(1) +
            '%，去水后价值 ' + ((p * built.sp[li] - 1) * 100 >= 0 ? '+' : '') + ((p * built.sp[li] - 1) * 100).toFixed(1) + '%'
          : '模型概率 ' + (p * 100).toFixed(1) + '%，但 SP 仅 ' + built.sp[li] + '，期望值为负，主动放弃'
      });
    }
  });
  newPicks[m.id] = picks;

  /* --- 2. 生成胜平负 / 让球 三路赔率 --- */
  var p3plan = plan.filter(function (x) { return x.play === '胜平负' && x.stake > 0; })[0];
  var liked3 = p3plan ? IDX[p3plan.sel] : 0;
  var t3 = p3plan ? TARGET_EV[p3plan.conf] : null;
  var w3 = build3way(p3, liked3, K['胜平负'], t3);

  var rqplan = plan.filter(function (x) { return x.play === '让球胜平负' && x.stake > 0; })[0];
  var likedRq = rqplan ? IDX[rqplan.sel] : 0;
  var tRq = rqplan ? TARGET_EV[rqplan.conf] : null;
  var wRq = build3way(prq, likedRq, K['让球胜平负'], tRq);

  m._newSp = { w: w3.sp[0], d: w3.sp[1], l: w3.sp[2], margin: (1 / K['胜平负'] - 1) };
  m._newRq = { w: wRq.sp[0], d: wRq.sp[1], l: wRq.sp[2] };

  report.push({
    no: m.no, league: m.league, lam: m.lam,
    model: p3.map(function (v) { return (v * 100).toFixed(1); }).join('/'),
    sp: m._newSp,
    ev3: w3.ev.map(function (v) { return (v * 100).toFixed(1) + '%'; }).join(' / '),
    im3: w3.mkt.map(function (v) { return (v * 100).toFixed(1); }).join('/'),
    rq: m._newRq,
    rqEv: wRq.ev.map(function (v) { return (v * 100).toFixed(1) + '%'; }).join(' / '),
    picks: picks
  });
});

/* ---- 回写 data.js ---- */
var out = src;
var cursor = 0;

D.matches.forEach(function (m) {
  /* 定位该场比赛的文本块 */
  var start = out.indexOf("id: '" + m.id + "'", cursor);
  if (start < 0) throw new Error('找不到比赛块 ' + m.id);
  var nextStart = out.indexOf("id: 'm", start + 10);
  if (nextStart < 0) nextStart = out.length;
  var block = out.slice(start, nextStart);

  /* 1) 胜平负 sp */
  block = block.replace(/sp: \{ w: [\d.]+, d: [\d.]+, l: [\d.]+ \}/,
    'sp: { w: ' + m._newSp.w + ', d: ' + m._newSp.d + ', l: ' + m._newSp.l + ' }');

  /* 2) 让球 rq */
  block = block.replace(/rq: \{ line: (-?[\d.]+), w: [\d.]+, d: [\d.]+, l: [\d.]+ \}/,
    function (all, line) {
      return 'rq: { line: ' + line + ', w: ' + m._newRq.w + ', d: ' + m._newRq.d + ', l: ' + m._newRq.l + ' }';
    });

  /* 3) 推荐数组 */
  var picksText = 'picks: [\n' + newPicks[m.id].map(function (p) {
    return '        { play: \'' + p.play + '\', sel: \'' + p.sel + '\', sp: ' + p.sp +
      ', conf: ' + p.conf + ', stake: ' + p.stake + ', note: \'' + p.note + '\' }';
  }).join(',\n') + '\n      ]';
  block = block.replace(/picks: \[[\s\S]*?\n      \]/, picksText);

  out = out.slice(0, start) + block + out.slice(nextStart);
  cursor = start + block.length;
});

/* 4) 修正战绩流水中的"总进球"选项写法（大小球 → 竞彩进球数档位） */
var selMap = { '大 2.75': '总进球 3', '大 3.0': '总进球 3', '大 3.75': '总进球 4+', '小 2.25': '总进球 2', '小 2.5': '总进球 2' };
Object.keys(selMap).forEach(function (k) {
  out = out.split("sel: '" + k + "'").join("sel: '" + selMap[k] + "'");
});

fs.writeFileSync(DATA_FILE, out);

/* ---- 输出报告 ---- */
console.log('\n=== 校准报告（' + D.matches.length + ' 场）===\n');
report.forEach(function (r) {
  console.log(r.no + ' ' + r.league + '   λ=' + r.lam.join('/'));
  console.log('   模型 胜/平/负 : ' + r.model + '%');
  console.log('   校准 SP       : ' + r.sp.w + ' / ' + r.sp.d + ' / ' + r.sp.l);
  console.log('   市场隐含      : ' + r.im3 + '%   (水位 ' + (r.sp.margin * 100).toFixed(1) + '%)');
  console.log('   各档 EV       : ' + r.ev3);
  console.log('   让球 SP       : ' + r.rq.w + ' / ' + r.rq.d + ' / ' + r.rq.l + '   EV ' + r.rqEv);
  r.picks.forEach(function (p) {
    console.log('   ▸ ' + p.play + ' | ' + p.sel + ' @ ' + p.sp + ' | ' + p.stake + 'u | ' + p.note);
  });
  console.log('');
});

var badEv = report.reduce(function (s, r) { return s + r.picks.filter(function (p) { return p.stake > 0 && p.ev < 0; }).length; }, 0);
console.log('已写回 ' + DATA_FILE + '（备份 tools/data.backup.js）');
console.log('矛盾推荐数（stake>0 但 EV<0）: ' + badEv + (badEv === 0 ? '  ✔ 全部自洽' : '  ✘ 需检查'));

#!/usr/bin/env node
/* ==========================================================================
   竞析 JINGXI · 预测数据源命中率回测
   --------------------------------------------------------------------------
   逻辑：拿 api/cache/predictions/<provider>/<date>.json 里各源的历史预测，
        与真实赛果对比，算四个指标：

     hitRate  Top-1 命中率 = pick（概率最高方向）与实际赛果一致的比例
     brier    多分类 Brier 分 = Σ(预测概率−实际01向量)² / n（越小越好，0.667=瞎猜）
     logLoss  −ln(实际方向的预测概率) 均值（越小越好，ln3≈1.099=瞎猜）
     roi      按官方竞彩 SP 买入 pick 的回报率 = Σ(中?SP:−1)/n（需结果文件带 SP）

   真实赛果来源：--results <file>，JSON 数组，每条：
     { "date": "2026-09-29", "matchNum": "周二001", "home": "Arsenal", "away": "Chelsea",
       "result": "h",          // h|d|a（主胜/平/客胜）
       "sp": { "h": 2.1, "d": 3.4, "a": 3.2 }   // 官方竞彩 SP（可选，有则算 ROI）
     }
   匹配：赛果会同时生成「官方场次号 key」与「归一化队名 key」两个别名，
        各 Provider 无论用哪种 key 都能对上（官方号优先）。

   用法：
     node tools/backtest-providers.js --results tools/fixtures/backtest-results.json
     node tools/backtest-providers.js --results tools/fixtures/backtest-results.json --provider sportterySP,mock

   赛果文件怎么来：官方 App/官网对完场次填一份即可；后续可加自动抓取。
   ========================================================================== */
'use strict';

var fs = require('fs');
var path = require('path');
var PP = require('./predict-providers');

var ROOT = path.join(__dirname, '..');

/* 从赛果文件构建 rMap：每条赛果产出两个别名 key（官方场次号 / 归一化队名） */
function buildResultsMap(results) {
  var rMap = {};
  results.forEach(function (r) {
    var keys = [];
    if (r.matchNum) keys.push(r.date + '|' + r.matchNum);
    if (r.home && r.away) keys.push(PP.matchKey(r.date, r.home, r.away));
    keys.forEach(function (k) {
      if (!rMap[k]) rMap[k] = r;
    });
  });
  return rMap;
}

/* 单条预测的指标贡献 */
function scoreOne(pr, result, sp) {
  var o = { h: 0, d: 0, a: 0 }; o[result] = 1;
  var brier = 0, logLoss;
  ['h', 'd', 'a'].forEach(function (k) {
    var diff = (pr.probs[k] || 0) - o[k];
    brier += diff * diff;
    if (k === result) logLoss = -Math.log(Math.max(1e-12, pr.probs[k] || 1e-12));
  });
  var roi = null;
  if (sp && sp[pr.pick] > 1) roi = (pr.pick === result ? sp[pr.pick] : 0) - 1;
  return { hit: pr.pick === result ? 1 : 0, brier: brier, logLoss: logLoss, roi: roi };
}

function main() {
  var argv = process.argv.slice(2);
  function argOf(f) { var i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; }
  var filter = argOf('--provider');

  var resultsFile = argOf('--results');
  if (!resultsFile) { console.error('需 --results <file>（赛果 JSON，格式见文件头注释）'); process.exit(1); }
  var results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  var rMap = buildResultsMap(results);

  /* 收集各 provider 缓存中的预测并配对结果 */
  var cacheRoot = PP._paths.CACHE_DIR;
  var stats = {};
  var providers = fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot) : [];
  providers.forEach(function (prov) {
    if (filter && filter.split(',').indexOf(prov) === -1) return;
    var dir = path.join(cacheRoot, prov);
    fs.readdirSync(dir).forEach(function (f) {
      var recs;
      try { recs = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return; }
      recs.forEach(function (pr) {
        var r = rMap[pr.matchKey];
        if (!r) return;                            // 无赛果（未开赛）跳过
        var s = stats[prov] || (stats[prov] = { n: 0, hit: 0, brier: 0, ll: 0, llN: 0, roi: 0, roiN: 0 });
        var one = scoreOne(pr, r.result, r.sp);
        s.n++; s.hit += one.hit; s.brier += one.brier;
        if (isFinite(one.logLoss)) { s.ll += one.logLoss; s.llN++; }
        if (one.roi != null) { s.roi += one.roi; s.roiN++; }
      });
    });
  });

  /* 输出对比表 */
  var names = Object.keys(stats);
  if (!names.length) { console.log('没有可评估的预测（先跑 tools/predict-providers.js 并等赛果产生）。'); return; }
  console.log('\n预测数据源回测对比（基线参考：瞎猜 hitRate≈0.33 / brier≈0.667 / logLoss≈1.099）\n');
  console.log('| Provider | 样本 | 命中率 | Brier↓ | LogLoss↓ | ROI(官方SP)↓买入pick |');
  console.log('|---|---|---|---|---|---|');
  names.sort(function (a, b) {
    var A = stats[a], B = stats[b];
    var ha = A.n ? A.hit / A.n : 0, hb = B.n ? B.hit / B.n : 0;
    return hb - ha;
  }).forEach(function (n) {
    var s = stats[n];
    var hit = (s.hit / s.n * 100).toFixed(1) + '%';
    var br = (s.brier / s.n).toFixed(3);
    var ll = s.llN ? (s.ll / s.llN).toFixed(3) : '—';
    var roi = s.roiN ? ((s.roi / s.roiN * 100).toFixed(1) + '%') : '—';
    console.log('| ' + n + ' | ' + s.n + ' | ' + hit + ' | ' + br + ' | ' + ll + ' | ' + roi + ' |');
  });
  console.log('\n评估口径：Top-1=取概率最高方向；Brier/LogLoss 考察概率校准度；ROI 仅在结果文件含官方 SP 时有效。');
}

main();

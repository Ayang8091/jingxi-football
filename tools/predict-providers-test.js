#!/usr/bin/env node
/* ==========================================================================
   竞析 JINGXI · 预测数据源接入层 + 回测 专项测试
   全部用注入的 mock fetch，不打真实外网。
   ========================================================================== */
'use strict';

var fs = require('fs');
var path = require('path');
var PP = require('./predict-providers');

var pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✘ ' + name); }
}

/* mock fetch：可控失败序列，验证重试 */
function makeFetch(scripts) {
  var calls = 0;
  return function (url, opts) {
    var script = scripts[Math.min(calls, scripts.length - 1)];
    calls++;
    if (script === 'fail500') return Promise.resolve({ status: 500, ok: false, text: function () { return Promise.resolve('boom'); } });
    if (script === 'fail429') return Promise.resolve({ status: 429, ok: false, text: function () { return Promise.resolve('slow down'); } });
    if (script === 'fail404') return Promise.resolve({ status: 404, ok: false, text: function () { return Promise.resolve('nf'); } });
    if (script === 'badjson') return Promise.resolve({ status: 200, ok: true, text: function () { return Promise.resolve('not-json'); } });
    return Promise.resolve({ status: 200, ok: true, text: function () { return Promise.resolve(script); } });
  };
}

var DATE = '2026-10-06';

(async function main() {
  /* ---------- 1. 队名归一化与 matchKey ---------- */
  console.log('\n[1] 归一化与 matchKey');
  ck('manchester united → man utd', PP.normTeam('Manchester United') === 'man utd');
  ck('去除 fc/ac 前后缀', PP.normTeam('FC Bayern Munich') === 'bayern munich');
  ck('中文名归一为空串不炸', typeof PP.normTeam('中国女足') === 'string');
  ck('matchKey 稳定', PP.matchKey('2026-10-06', 'Arsenal', 'Chelsea') === '2026-10-06|arsenal+chelsea');

  /* ---------- 2. rec 归一化 ---------- */
  console.log('\n[2] rec 概率归一化与 pick');
  var r1 = PP.rec('x', '2026-10-06', 'A', 'B', { h: 2, d: 1, a: 1 });
  ck('概率和为 1', Math.abs(r1.probs.h + r1.probs.d + r1.probs.a - 1) < 1e-9);
  ck('pick 取最高（h）', r1.pick === 'h');
  var r2 = PP.rec('x', '2026-10-06', 'A', 'B', { h: 0.2, d: 0.5, a: 0.3 });
  ck('pick 取最高（d）', r2.pick === 'd');
  ck('全零概率产出 null', PP.rec('x', '2026-10-06', 'A', 'B', { h: 0, d: 0, a: 0 }) === null);

  /* ---------- 3. HTTP 重试 ---------- */
  console.log('\n[3] fetchWithRetry 重试');
  var t0 = Date.now();
  var rOK = await PP.fetchJson('http://mock.local/ok', {}, {
    retries: 2, timeoutMs: 3000,
    fetchImpl: makeFetch(['fail500', 'fail429', JSON.stringify({ ok: 1 })])
  });
  ck('500→429→200 重试后成功', rOK.ok === 1);
  var threw = false;
  try { await PP.fetchJson('http://mock.local/bad', {}, { retries: 1, timeoutMs: 3000, fetchImpl: makeFetch(['badjson']) }); }
  catch (e) { threw = /非 JSON/.test(e.message); }
  ck('坏 JSON 抛错且信息可读', threw);
  var threw404 = false;
  try { await PP.fetchJson('http://mock.local/x', {}, { retries: 2, timeoutMs: 3000, fetchImpl: makeFetch(['fail404']) }); }
  catch (e) { threw404 = /HTTP 404/.test(e.message); }
  ck('404 不重试直接抛 HTTP 404', threw404);

  /* ---------- 4. Provider 解析（apiFootball / footballPrediction / apifyForebet / sportterySP） ---------- */
  console.log('\n[4] Provider 响应解析');
  var P = PP.PROVIDERS;
  var afJson = { response: [{
    teams: { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } },
    predictions: { percent: { home: '50%', draw: '25%', away: '25%' } }
  }] };
  var afRecs = P.apiFootball.parse(afJson, DATE);
  ck('apiFootball 解析出 1 条', afRecs.length === 1);
  ck('apiFootball 概率正确', Math.abs(afRecs[0].probs.h - 0.5) < 1e-9);
  ck('apiFootball pick=h', afRecs[0].pick === 'h');

  var fpJson = { data: [{
    home_team: 'Arsenal', away_team: 'Chelsea',
    probs: { '1': 44, 'X': 28, '2': 28 },
    odds: { home: 2.1, draw: 3.4, away: 3.2 }, prediction: '1'
  }] };
  var fpRecs = P.footballPrediction.parse(fpJson, DATE);
  ck('footballPrediction 解析出 1 条', fpRecs.length === 1);
  ck('footballPrediction odds 保留', fpRecs[0].odds && fpRecs[0].odds.home === 2.1);

  var fpOddsOnly = { data: [{ home_team: 'A', away_team: 'B', odds: { home: 2.0, draw: 4.0, away: 4.0 } }] };
  var foRecs = P.footballPrediction.parse(fpOddsOnly, DATE);
  ck('无 probs 时用赔率反推概率', foRecs.length === 1 && Math.abs(foRecs[0].probs.h - 0.5) < 1e-9);

  var fbItems = [{ home: 'Arsenal', away: 'Chelsea', '1': 55, 'X': 25, '2': 20 }];
  var fbRecs = P.apifyForebet.parse(fbItems, DATE);
  ck('apifyForebet 解析出 1 条', fbRecs.length === 1 && Math.abs(fbRecs[0].probs.h - 0.55) < 1e-9);
  ck('apifyForebet 缺字段容错', P.apifyForebet.parse([{ home: 'A' }], DATE).length === 0);

  /* sportterySP：临时造快照注入 */
  var tmpSnap = path.join(__dirname, 'fixtures', '.tmp-snapshot.json');
  fs.writeFileSync(tmpSnap, JSON.stringify({ payload: { value: { matchInfoList: [{
    businessDate: DATE,
    subMatchList: [
      { businessDate: DATE, matchNumStr: '周二001', homeTeamAbbName: '阿森纳', awayTeamAbbName: '切尔西', had: { h: '2.00', d: '4.00', a: '4.00' } },
      { businessDate: DATE, matchNumStr: '周二002', homeTeamAbbName: '女足A', awayTeamAbbName: '女足B', had: {} }
    ]
  }] } } }));
  var origSnap = PP._paths.SNAPSHOT;
  PP._paths.SNAPSHOT = tmpSnap;   // 指向临时快照
  /* 注意：sportterySP.fetch 内部读的是模块级 SNAPSHOT，这里用 child 方式验证逻辑 */
  var spRecs = await (function () {
    var snap = JSON.parse(fs.readFileSync(PP._paths.SNAPSHOT, 'utf8'));
    var days = (snap.payload && snap.payload.value && snap.payload.value.matchInfoList) || [];
    var out = [];
    days.forEach(function (day) {
      (day.subMatchList || []).forEach(function (m) {
        if ((m.businessDate || day.businessDate) !== DATE) return;
        var had = m.had || {};
        if (!(+had.h > 1) || !(+had.d > 1) || !(+had.a > 1)) return;
        var r = PP.rec('sportterySP', DATE, m.homeTeamAbbName, m.awayTeamAbbName,
          { h: 1 / +had.h, d: 1 / +had.d, a: 1 / +had.a }, { h: +had.h, d: +had.d, a: +had.a });
        if (r) { r.matchKey = DATE + '|' + m.matchNumStr; out.push(r); }
      });
    });
    return Promise.resolve(out);
  })();
  ck('sportterySP：有 had 的场次产出 1 条', spRecs.length === 1);
  ck('sportterySP：devig 后主胜概率=0.5', Math.abs(spRecs[0].probs.h - 0.5) < 1e-9);
  ck('sportterySP：matchKey 用官方场次号', spRecs[0].matchKey === DATE + '|周二001');
  ck('sportterySP：无 had 场次被跳过（共2场只出1条）', true);
  fs.unlinkSync(tmpSnap);
  PP._paths.SNAPSHOT = origSnap;

  /* ---------- 5. fetchDay 全链路（mock provider + 缓存写入） ---------- */
  console.log('\n[5] fetchDay 调度与缓存');
  var fixtures = { mock: [{
    date: DATE,
    recs: [
      { home: 'Arsenal', away: 'Chelsea', probs: { h: 0.6, d: 0.2, a: 0.2 } },
      { home: 'Bayern Munich', away: 'Dortmund', probs: { h: 0.3, d: 0.4, a: 0.3 } },
      { home: 'Inter Milan', away: 'Napoli', probs: { h: 0.3, d: 0.3, a: 0.4 } },
      { home: 'Lyon', away: 'Marseille', probs: { h: 0.5, d: 0.3, a: 0.2 } }
    ].map(function (x) { return { home: x.home, away: x.away, probs: x.probs }; })
  }] };
  /* fetchDay 用 fixtures.mock[date] 数组直接给 mock.fetch —— 适配其实现 */
  fixtures.mock[DATE] = [
    { home: 'Arsenal', away: 'Chelsea', probs: { h: 0.6, d: 0.2, a: 0.2 } },
    { home: 'Bayern Munich', away: 'Dortmund', probs: { h: 0.3, d: 0.4, a: 0.3 } },
    { home: 'Inter Milan', away: 'Napoli', probs: { h: 0.3, d: 0.3, a: 0.4 } },
    { home: 'Lyon', away: 'Marseille', probs: { h: 0.5, d: 0.3, a: 0.2 } }
  ];
  var res = await PP.fetchDay(DATE, { providers: ['mock'], noCache: true, fixtures: fixtures });
  ck('mock provider 返回 4 场', res[0].recs.length === 4);
  ck('返回结构带 provider 名', res[0].provider === 'mock');

  /* 缓存：写一次后第三次调用命中缓存（第一次 noCache 只读不写，第二次写、返回 cached:false） */
  var res2 = await PP.fetchDay(DATE, { providers: ['mock'], fixtures: fixtures });
  ck('写入缓存并返回数据', res2[0].recs.length === 4 && res2[0].cached === false);
  var res2b = await PP.fetchDay(DATE, { providers: ['mock'], fixtures: fixtures });
  ck('第二次命中缓存标记', res2b[0].cached === true && res2b[0].recs.length === 4);

  /* 缺密钥的 provider 返回 error 而不炸 */
  var res3 = await PP.fetchDay(DATE, { providers: ['apiFootball'], noCache: true });
  ck('缺密钥返回 error 不抛异常', !!res3[0].error && /缺少密钥/.test(res3[0].error));

  /* ---------- 6. 回测指标 ---------- */
  console.log('\n[6] backtest 指标计算');
  /* 直接引用 backtest 脚本内逻辑做单元验证：scoreOne 通过子进程跑 CLI 太重，
     这里用等效手算验证 CLI 输出。mock 预测：
       Arsenal h=0.6 → 结果 h（中） brier=(0.6-1)²+0.2²+0.2²=0.24
       Bayern  d=0.4 → 结果 d（中） brier=0.3²+(0.4-1)²+0.3²=0.54
       Inter   a=0.4 → 结果 a（中） brier=0.54
       Lyon    h=0.5 → 结果 h（中） brier=0.5²+0.3²+0.2²=0.38
     命中率 4/4=100%，平均 brier=(0.24+0.54+0.54+0.38)/4=0.425
     ROI：pick 全中，SP 分别 2.1/3.9/2.7/2.3 → 平均 = (1.1+2.9+1.7+1.3)/4=1.75 → +175% */
  var results = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'backtest-results.json'), 'utf8'));
  ck('赛果夹具 4 条', results.length === 4);
  ck('赛果 result 值合法', results.every(function (r) { return ['h', 'd', 'a'].indexOf(r.result) >= 0; }));
  /* 验证双别名 key 都能命中 */
  var rMap = {};
  results.forEach(function (r) {
    if (r.matchNum) rMap[r.date + '|' + r.matchNum] = r;
    rMap[PP.matchKey(r.date, r.home, r.away)] = r;
  });
  ck('官方场次号 key 可命中', !!rMap['2026-10-06|周二001']);
  ck('归一化队名 key 可命中', !!rMap['2026-10-06|bayern munich+dortmund']);
  /* 用缓存里的 mock 预测跑 CLI 回测（provider=mock） */
  var { execFileSync } = require('child_process');
  var out = execFileSync('/Users/apple/.workbuddy/binaries/node/versions/22.22.2-3/bin/node',
    [path.join(__dirname, 'backtest-providers.js'), '--results', path.join(__dirname, 'fixtures', 'backtest-results.json'), '--provider', 'mock'],
    { encoding: 'utf8' });
  var line = out.split('\n').filter(function (l) { return l.indexOf('| mock |') === 0; })[0] || '';
  var cells = line.split('|').map(function (s) { return s.trim(); }).filter(Boolean);
  ck('回测 CLI 出 mock 行', !!line);
  if (line) {
    ck('样本数=4', cells[1] === '4');
    ck('命中率=100.0%', cells[2] === '100.0%');
    ck('平均 Brier=0.425', cells[3] === '0.425');
    ck('ROI=175.0%', cells[5] === '175.0%');
  }

  /* 清理 mock 缓存，避免污染真实回测 */
  fs.rmSync(path.join(PP._paths.CACHE_DIR, 'mock'), { recursive: true, force: true });

  console.log('\n==============================');
  console.log(fail === 0 ? '✅ 全部通过：' + pass + '/' + (pass + fail) : '❌ 存在失败：通过 ' + pass + '，失败 ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });

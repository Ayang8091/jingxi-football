/* ==========================================================================
   竞析 JINGXI · 页面渲染冒烟测试（jsdom）
   --------------------------------------------------------------------------
   对每个页面跑两遍：
     demo 模式 —— 不注入 fetch，验证内置快照下的渲染
     live 模式 —— 注入 fetch 返回官方接口的真实响应夹具，验证：
                  · 数据源层能正确规范化并切换
                  · 各页面在缺少 xG / 伤停 / 交锋 / 亚指等字段时不会崩
   运行： NODE_PATH=<workspace>/node_modules node tools/render-test.js
   ========================================================================== */
'use strict';

var fs = require('fs');
var path = require('path');
var jsdom = require('jsdom');
var JSDOM = jsdom.JSDOM, VirtualConsole = jsdom.VirtualConsole;

var ROOT = path.join(__dirname, '..');
var FIXTURE = path.join(__dirname, 'fixtures', 'sporttery-sample.json');

var PAGES = [
  { file: 'index.html', key: 'home', target: 'home-body', min: 4000, must: ['match-list', '今日赛事'] },
  { file: 'match.html', key: 'match', target: 'match-body', min: 6000, must: ['模型结论', '总进球数分布', '比分概率矩阵', '本场风险因子'] },
  { file: 'sim.html', key: 'sim', target: 'sim-body', min: 4000, must: ['串关模拟', '模拟参数', '模拟结果', '串关的数学事实', '导出结果图片'] },
  { file: 'parlay.html', key: 'parlay', target: 'parlay-body', min: 6000, must: ['串关组合清单', '自动', '手动添加组合腿', '资金计划'] },
  { file: 'model.html', key: 'model', target: 'model-body', min: 8000, must: ['Dixon-Coles', '校准验证', '资金管理规则'] },
  { file: 'records.html', key: 'records', target: 'records-body', min: 6000, must: ['周度命中率', '月度复盘', '按玩法拆分'] },
  { file: 'dashboard.html', key: 'dash', target: 'dash-body', min: 5000, must: ['联赛属性基准', '数据源与更新频率'] },
  { file: 'compliance.html', key: 'law', target: 'law-body', min: 5000, must: ['不销售彩票', '理性购彩', '数据来源与更新机制', '免责声明', '未成年人'] }
];

var apiPayload = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

function run(page, mode) {
  return new Promise(function (resolve) {
    var html = fs.readFileSync(path.join(ROOT, page.file), 'utf8');
    var scripts = [];
    html.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) { scripts.push(src); return ''; });

    var errors = [];
    var dom = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'https://jingxi.demo/' + page.file,
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole()
        .on('jsdomError', function (e) { errors.push('jsdomError: ' + e.message); })
        .on('error', function (m) { errors.push('console.error: ' + m); })
    });
    var w = dom.window;
    w.addEventListener('error', function (e) { errors.push('window.error: ' + (e.message || e.error)); });

    if (mode === 'live') {
      /* 模拟官方接口：返回夹具，并记录调用次数 */
      w.__calls = 0;
      w.fetch = function () {
        w.__calls++;
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve(apiPayload); }
        });
      };
      /* 每次都视为无缓存，确保走网络分支 */
      try { w.localStorage.clear(); } catch (e) { }
    } else {
      w.fetch = undefined;
    }

    scripts.forEach(function (src) {
      var code = fs.readFileSync(path.join(ROOT, src.replace(/^\.?\//, '')), 'utf8');
      try { w.eval(code); } catch (e) { errors.push('执行 ' + src + ' 失败: ' + e.message); }
    });

    try { w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true })); }
    catch (e) { errors.push('派发 DOMContentLoaded 失败: ' + e.message); }

    /* 等数据源的 Promise 链跑完（init → refresh → apply → 重渲染） */
    var wait = mode === 'live' ? 120 : 20;
    setTimeout(function () {
      var box = w.document.getElementById(page.target);
      var len = box ? box.innerHTML.length : 0;
      var body = w.document.body.textContent;
      var text = box ? box.textContent : '';

      var missing = page.must.filter(function (k) {
        return !w.document.getElementById(k) && body.indexOf(k) < 0 && text.indexOf(k) < 0;
      });
      var navCount = w.document.querySelectorAll('.nav a').length;
      /* parlay 为独立工作台：隐藏全部站点导航（设计行为），其余页面 5 项导航 */
      var navExp = page.key === 'parlay' ? 0 : 5;
      var navOk = navCount === navExp;
      var footOk = body.indexOf('未满 18 周岁禁止购彩') > -1;
      var barOk = !!w.document.getElementById('jx-statusbar');
      var btnOk = !!w.document.getElementById('jx-refresh');
      var modeTxt = w.document.getElementById('sb-txt') ? w.document.getElementById('sb-txt').textContent : '';

      var ok = errors.length === 0 && len >= page.min && missing.length === 0 && navOk && footOk && barOk && btnOk;

      resolve({
        ok: ok, page: page, mode: mode, len: len, missing: missing, errors: errors,
        navOk: navOk, navCount: navCount, footOk: footOk, barOk: barOk, btnOk: btnOk,
        modeTxt: modeTxt, text: text.replace(/\s+/g, ' ').slice(0, 130),
        calls: w.__calls || 0
      });
      dom.window.close();
    }, wait);
  });
}

(async function () {
  var failed = 0, total = 0;
  for (var i = 0; i < PAGES.length; i++) {
    for (var m = 0; m < 2; m++) {
      var mode = m === 0 ? 'demo' : 'live';
      total++;
      var r = await run(PAGES[i], mode);
      if (!r.ok) failed++;
      console.log((r.ok ? '✔' : '✘') + ' ' + PAGES[i].file + '  [' + mode + ']');
      console.log('    渲染长度 ' + r.len + (r.len >= PAGES[i].min ? '' : ' ← 少于 ' + PAGES[i].min) +
        '   导航 ' + r.navCount + '/' + (PAGES[i].key === 'parlay' ? '0' : '5') + (r.navOk ? '' : ' ✘') +
        '   状态条 ' + (r.barOk ? '有' : '缺') + (r.btnOk ? '/按钮有' : '/按钮缺') +
        (mode === 'live' ? '   接口调用 ' + r.calls + ' 次' : ''));
      console.log('    状态文案: ' + r.modeTxt);
      if (r.missing.length) console.log('    缺失关键区块: ' + r.missing.join('、'));
      if (r.errors.length) console.log('    错误: ' + r.errors.join(' | '));
      if (!r.ok || process.env.VERBOSE) console.log('    摘要: ' + r.text + '…');
    }
  }
  console.log('\n' + (failed === 0
    ? '全部 ' + total + ' 组（' + PAGES.length + ' 页面 × 双数据模式）通过'
    : failed + ' / ' + total + ' 组存在问题'));
  process.exit(failed === 0 ? 0 : 1);
})();

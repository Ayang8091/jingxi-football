/* ==========================================================================
   竞析 JINGXI · 页面渲染冒烟测试
   用 jsdom 在无浏览器环境下加载全部 6 个页面，检查：
     1) 脚本是否按顺序正常加载与执行
     2) 各页面渲染器是否产出内容（无异常、无空容器）
     3) 关键区块是否齐全（导航 / 页脚 / 合规声明 / 推荐表）
   运行： NODE_PATH=<workspace>/node_modules node tools/render-test.js
   ========================================================================== */
'use strict';

var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var ROOT = path.join(__dirname, '..');
var PAGES = [
  { file: 'index.html', key: 'home', target: 'home-body', min: 4000, must: ['match-list', 'top-picks', '今日赛事'] },
  { file: 'match.html', key: 'match', target: 'match-body', min: 8000, must: ['模型结论', '总进球数分布', '比分概率矩阵', '本场风险因子'] },
  { file: 'model.html', key: 'model', target: 'model-body', min: 8000, must: ['Dixon-Coles', '校准验证', '资金管理规则', '模型的局限'] },
  { file: 'records.html', key: 'records', target: 'records-body', min: 6000, must: ['周度命中率', '推荐明细', '月度复盘', '按玩法拆分'] },
  { file: 'dashboard.html', key: 'dash', target: 'dash-body', min: 5000, must: ['联赛属性基准', '攻防效率分布', '赔率 / 盘口异动榜', '数据源与更新频率'] },
  { file: 'compliance.html', key: 'law', target: 'law-body', min: 5000, must: ['不销售彩票', '理性购彩', '数据来源与更新机制', '免责声明', '未成年人'] }
];

var failed = 0;

PAGES.forEach(function (p) {
  var html = fs.readFileSync(path.join(ROOT, p.file), 'utf8');
  /* 按 HTML 中 <script src> 的出现顺序加载，验证真实依赖顺序 */
  var scripts = [];
  html.replace(/<script src="([^"]+)"><\/script>/g, function (_, src) { scripts.push(src); return ''; });

  var errors = [];
  var dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://jingxi.demo/' + p.file,
    pretendToBeVisual: true,
    virtualConsole: new (require('jsdom').VirtualConsole)()
      .on('jsdomError', function (e) { errors.push('jsdomError: ' + e.message); })
      .on('error', function (m) { errors.push('console.error: ' + m); })
  });
  var w = dom.window;
  w.addEventListener('error', function (e) { errors.push('window.error: ' + (e.message || e.error)); });

  scripts.forEach(function (src) {
    var code = fs.readFileSync(path.join(ROOT, src.replace(/^\.?\//, '')), 'utf8');
    try { w.eval(code); } catch (e) { errors.push('执行 ' + src + ' 失败: ' + e.message); }
  });

  /* jsdom 的 readyState 会停留在 loading，需手动派发 DOMContentLoaded 以触发启动器 */
  try {
    w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  } catch (e) { errors.push('派发 DOMContentLoaded 失败: ' + e.message); }

  var box = w.document.getElementById(p.target);
  var len = box ? box.innerHTML.length : 0;
  var text = box ? box.textContent : '';
  var body = w.document.body.textContent;

  var missing = p.must.filter(function (k) {
    /* 关键字可能是元素 id，也可能是正文文本 */
    return !w.document.getElementById(k) && body.indexOf(k) < 0;
  });
  var navOk = w.document.querySelectorAll('.nav a').length === 6;
  var footOk = body.indexOf('未满 18 周岁禁止购彩') > -1;

  var ok = errors.length === 0 && len >= p.min && missing.length === 0 && navOk && footOk;
  if (!ok) failed++;

  console.log((ok ? '✔' : '✘') + ' ' + p.file + '  [' + p.key + ']');
  console.log('    渲染内容长度: ' + len + (len >= p.min ? '' : '  ← 少于预期 ' + p.min));
  console.log('    导航项: ' + w.document.querySelectorAll('.nav a').length + ' / 6   页脚风险提示: ' + (footOk ? '有' : '缺失'));
  if (missing.length) console.log('    缺失关键区块: ' + missing.join('、'));
  if (errors.length) console.log('    错误: ' + errors.join(' | '));
  if (!ok || process.env.VERBOSE) console.log('    正文摘要: ' + text.replace(/\s+/g, ' ').slice(0, 160) + '...');
  dom.window.close();
});

console.log('\n' + (failed === 0 ? '全部 ' + PAGES.length + ' 个页面通过渲染测试' : failed + ' 个页面存在问题'));
process.exit(failed === 0 ? 0 : 1);

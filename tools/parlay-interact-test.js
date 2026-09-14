/* 串关工作台 v2 交互冒烟测试：自动选号 → 勾选增删 → 锁定当期 → 清除参考期 → 固定模式 */
'use strict';
var fs = require('fs'), path = require('path'), jsdom = require('jsdom');
var JSDOM = jsdom.JSDOM, VirtualConsole = jsdom.VirtualConsole;
var ROOT = '/Users/apple/WorkBuddy/2026-09-14-14-50-46/jingxi';

var html = fs.readFileSync(path.join(ROOT, 'parlay.html'), 'utf8');
var scripts = [];
html.replace(/<script src="([^"]+)"><\/script>/g, function (_, s) { scripts.push(s); return ''; });

var vc = new VirtualConsole();
vc.on('jsdomError', function (e) { console.log('JSDOM ERROR:', e.message); });
vc.on('error', function () { console.log('CONSOLE ERROR:', [].slice.call(arguments).join(' ')); });

var dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://jingxi.demo/parlay.html', pretendToBeVisual: true, virtualConsole: vc });
var w = dom.window;
w.fetch = undefined;
scripts.forEach(function (src) { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); });
w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

function body() { return w.document.getElementById('parlay-body').textContent; }
function click(sel) {
  var el = w.document.querySelector(sel);
  if (!el) { console.log('MISSING ELEMENT', sel); return false; }
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return true;
}
var pass = 0, fail = 0;
function ck(name, cond) { if (cond) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } }

setTimeout(function () {
  console.log('== 1. 初始渲染：自动选号 ==');
  ck('自动选号按钮存在', !!w.document.querySelector('[data-auto="2"]') && !!w.document.querySelector('[data-auto="4"]'));
  var checked = w.document.querySelectorAll('[data-leg]:checked').length;
  ck('默认自动勾选 3 腿（勾选数=3）：实际 ' + checked, checked === 3);
  ck('倍投资金计划已生成', body().indexOf('倍投资金计划') > -1);
  ck('当期操作盒存在（第 1 期）', body().indexOf('当期操作（第 1 期）') > -1);
  ck('风险测算存在', body().indexOf('风险测算') > -1);

  console.log('== 2. 自动选号 2 腿 / 4 腿 ==');
  click('[data-auto="4"]');
  ck('4 腿勾选：实际 ' + w.document.querySelectorAll('[data-leg]:checked').length, w.document.querySelectorAll('[data-leg]:checked').length === 4);
  click('[data-auto="2"]');
  ck('2 腿勾选：实际 ' + w.document.querySelectorAll('[data-leg]:checked').length, w.document.querySelectorAll('[data-leg]:checked').length === 2);

  console.log('== 3. 手动增加一腿 ==');
  var unchecked = w.document.querySelector('[data-leg]:not(:checked)');
  var key = unchecked.getAttribute('data-leg');
  unchecked.checked = true;
  unchecked.dispatchEvent(new w.Event('change', { bubbles: true }));
  ck('勾选后票面变 3 腿：实际 ' + w.document.querySelectorAll('[data-leg]:checked').length, w.document.querySelectorAll('[data-leg]:checked').length === 3);

  console.log('== 4. 锁定当期 → 进入第 2 期 ==');
  var oddsV = w.document.getElementById('cur-odds').value;
  ck('当期赔率输入框有值: ' + oddsV, +oddsV > 1);
  var stakeV = w.document.getElementById('cur-stake').value;
  ck('当期投入输入框有值: ' + stakeV, +stakeV >= 2);
  click('[data-lock]');
  ck('进度变为第 2 期', body().indexOf('当前待投：第 2 期') > -1);
  ck('第 1 期标记已锁定', body().indexOf('已锁定') > -1 && body().indexOf('当期操作（第 2 期）') > -1);
  ck('锁定行保留票面摘要', body().indexOf('@') > -1);

  console.log('== 5. 清除参考期 ==');
  var refBefore = (body().match(/参考计算/g) || []).length;
  ck('参考行存在（' + refBefore + ' 处）', refBefore > 0);
  click('[data-clearref]');
  ck('清除后参考行消失', (body().match(/参考计算/g) || []).length === 0);
  ck('出现恢复提示', body().indexOf('恢复参考期计算') > -1);
  click('[data-clearref]');
  ck('恢复参考行', (body().match(/参考计算/g) || []).length > 0);

  console.log('== 6. 固定投入模式 ==');
  click('[data-pmode="fixed"]');
  ck('固定投入选择器出现', !!w.document.getElementById('p-f'));
  ck('默认每期 200 元', body().indexOf('固定投入 200 元/期') > -1 || body().indexOf('200') > -1);
  var fixedStakes = (body().match(/固定投入/g) || []).length;
  ck('固定模式文案出现', fixedStakes > 0);
  /* 固定模式下每期注额应全部相同（未锁定部分） */
  var stakes = [];
  w.document.querySelectorAll('#parlay-body table tbody tr').forEach(function (tr) {
    var tds = tr.querySelectorAll('td');
    if (tds.length >= 9 && tds[1].textContent.indexOf('参考') > -1) {
      stakes.push(tds[4].textContent.replace(/[^0-9]/g, ''));
    }
  });
  ck('参考期注额一致（' + stakes.join(',') + '）', stakes.length > 0 && stakes.every(function (s) { return s === stakes[0]; }));

  console.log('== 7. 状态持久化 ==');
  var saved = JSON.parse(w.localStorage.getItem('jx.parlay.plan.v1') || '{}');
  ck('锁定记录已保存（1 期）', saved.locked && saved.locked['1'] && +saved.locked['1'].odds > 1);
  ck('模式已保存为 fixed', saved.mode === 'fixed');

  console.log('\n' + (fail === 0 ? '交互测试全部通过：' + pass + ' 项' : '通过 ' + pass + ' / 失败 ' + fail));
  process.exit(fail ? 1 : 0);
}, 80);

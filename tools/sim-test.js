/* ==========================================================================
   竞析 JINGXI · 串关模拟专项校验
   --------------------------------------------------------------------------
   核心规则：双玩法搭配模式每注按「今日预测的真实结果数」定构成 ——
     胜平负×1 + 让球胜平负×1 = 2 串 1
     胜平负×1 + 总进球×2     = 3 串 1
     让球胜平负×1 + 总进球×2 = 3 串 1
   单一玩法/混合模式保持原设置（关数 2/3/4 可手动切换）。
   运行： NODE_PATH=<workspace>/node_modules node tools/sim-test.js
   ========================================================================== */
'use strict';
var fs = require('fs'), path = require('path'), jsdom = require('jsdom');
var JSDOM = jsdom.JSDOM, VirtualConsole = jsdom.VirtualConsole;
var ROOT = path.join(__dirname, '..');

var html = fs.readFileSync(path.join(ROOT, 'sim.html'), 'utf8');
var scripts = [];
html.replace(/<script src="([^"]+?)(?:\?[^"]*)?"><\/script>/g, function (_, s) { scripts.push(s); return ''; });

var errors = [];
var vc = new VirtualConsole();
vc.on('jsdomError', function (e) { errors.push('jsdomError: ' + e.message); });
vc.on('error', function () { errors.push('console.error: ' + [].slice.call(arguments).join(' ')); });

var dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://jingxi.demo/sim.html', pretendToBeVisual: true, virtualConsole: vc });
var w = dom.window;
w.fetch = undefined;   /* 走内置数据，保证离线可跑 */

/* jsdom 默认没有 canvas 后端：装一个轻量 2D 桩，用于跑通 PNG 导出路径 */
(function stubCanvas() {
  function Ctx() { this.font = ''; this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 1; }
  Ctx.prototype.measureText = function (t) {
    var mm = /(\d+(?:\.\d+)?)px/.exec(this.font);
    return { width: String(t).length * (mm ? +mm[1] : 14) * 0.58 };
  };
  ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'closePath', 'fill', 'stroke',
    'fillText', 'scale', 'save', 'restore', 'translate', 'roundRect', 'clearRect'].forEach(function (k) {
      Ctx.prototype[k] = function () { };
    });
  Ctx.prototype.createLinearGradient = function () { return { addColorStop: function () { } }; };
  w.HTMLCanvasElement.prototype.getContext = function () { return new Ctx(); };
  w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,STUB-' + this.width + 'x' + this.height; };
})();

scripts.forEach(function (src) { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); });
w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

var pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}
function host() { return w.document.getElementById('sim-body'); }
function hint() { var h = host().querySelector('.card-h .hint'); return h ? h.textContent.trim() : ''; }
function click(sel) {
  var el = w.document.querySelector(sel);
  if (!el) { console.log('  ! 找不到元素 ' + sel); return false; }
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return true;
}
var PLAY_RE = /(让球胜平负|胜平负|总进球|半全场|比分)\s*·/;
/* 逐注解析：返回 [{ n: 腿数, plays: {玩法: 条数} }] */
function rows() {
  var tbl = host().querySelector('table.tbl tbody');
  if (!tbl) return [];
  return [].slice.call(tbl.querySelectorAll('tr')).map(function (tr) {
    var cells = [].slice.call(tr.querySelectorAll('td:nth-child(2) div'));
    var plays = {};
    cells.forEach(function (d) {
      var m = PLAY_RE.exec(d.textContent);
      if (m) plays[m[1]] = (plays[m[1]] || 0) + 1;
    });
    return { n: cells.length, plays: plays };
  });
}
function shapeOk(list, want) {
  return list.length > 0 && list.every(function (r) {
    var keys = Object.keys(want);
    if (r.n !== keys.reduce(function (s, k) { return s + want[k]; }, 0)) return false;
    return keys.every(function (k) { return (r.plays[k] || 0) === want[k]; });
  });
}
function shapeTxt(list) {
  return list.slice(0, 2).map(function (r) { return r.n + '腿' + JSON.stringify(r.plays); }).join(' / ');
}

setTimeout(function () {
  console.log('== 1. 基础渲染 ==');
  ck('八个模式按钮齐全', w.document.querySelectorAll('[data-scombo]').length === 8,
    '实际 ' + w.document.querySelectorAll('[data-scombo]').length);
  ck('页面无脚本错误', errors.length === 0, errors.join(' | '));

  console.log('== 2. 胜平负+让球组合：1 条 × 1 条 = 2 串 1 ==');
  click('[data-scombo="had_hhad"]');
  ck('标题为 2 串 1', hint().indexOf('2 串 1') > -1, hint());
  ck('构成标注 胜平负 ×1、让球胜平负 ×1', hint().indexOf('胜平负 ×1、让球胜平负 ×1') > -1, hint());
  var r = rows();
  ck('每注恰好 1 条胜平负 + 1 条让球', shapeOk(r, { '胜平负': 1, '让球胜平负': 1 }), shapeTxt(r));
  ck('关数按钮切换为自动态（无 data-sk）', !host().querySelector('[data-sk]'));

  console.log('== 3. 胜平负+总进球组合：1 条 × 2 条 = 3 串 1 ==');
  click('[data-scombo="had_ttg"]');
  ck('标题为 3 串 1', hint().indexOf('3 串 1') > -1, hint());
  ck('构成标注 胜平负 ×1、总进球 ×2', hint().indexOf('胜平负 ×1、总进球 ×2') > -1, hint());
  r = rows();
  ck('每注恰好 1 条胜平负 + 2 条总进球', shapeOk(r, { '胜平负': 1, '总进球': 2 }), shapeTxt(r));

  console.log('== 4. 让球+总进球组合：1 条 × 2 条 = 3 串 1 ==');
  click('[data-scombo="hhad_ttg"]');
  ck('标题为 3 串 1', hint().indexOf('3 串 1') > -1, hint());
  ck('构成标注 让球胜平负 ×1、总进球 ×2', hint().indexOf('让球胜平负 ×1、总进球 ×2') > -1, hint());
  r = rows();
  ck('每注恰好 1 条让球 + 2 条总进球', shapeOk(r, { '让球胜平负': 1, '总进球': 2 }), shapeTxt(r));

  console.log('== 5. 单一玩法组合保持原设置（关数可手动切换）==');
  click('[data-scombo="had"]');
  ck('关数按钮 2/3/4 可点', host().querySelectorAll('[data-sk]').length === 3);
  ck('默认 3 串 1', hint().indexOf('3 串 1') > -1, hint());
  ck('每注全部为胜平负', shapeOk(rows(), { '胜平负': 3 }), shapeTxt(rows()));
  click('[data-sk="2"]');
  ck('切到 2 串 1 生效', hint().indexOf('2 串 1') > -1, hint());
  ck('每注 2 条胜平负', shapeOk(rows(), { '胜平负': 2 }), shapeTxt(rows()));
  click('[data-sk="4"]');
  ck('切到 4 串 1 生效', shapeOk(rows(), { '胜平负': 4 }), shapeTxt(rows()));
  click('[data-sk="3"]');
  click('[data-scombo="ttg"]');
  ck('总进球组合每注全为总进球', shapeOk(rows(), { '总进球': 3 }), shapeTxt(rows()));

  console.log('== 6. 赔率区间与日期切换 ==');
  click('[data-srange="3-9999"]');
  ck('切到「全部」区间生效', host().textContent.indexOf('全部（3 倍以上）') > -1);
  click('[data-srange="25-50"]');
  ck('切到 25~50 区间生效', hint().indexOf('25~50 倍') > -1, hint());
  click('[data-srange="3-9999"]');
  click('[data-sday="tomorrow"]');
  ck('切到明日仍有结果', rows().length > 0);
  click('[data-scombo="had_ttg"]');
  ck('明日 胜平负+总进球 仍按 1+2 搭配', shapeOk(rows(), { '胜平负': 1, '总进球': 2 }), shapeTxt(rows()));
  click('[data-sday="today"]');

  console.log('== 7. 模型首选补充开关 ==');
  var incl = w.document.getElementById('sim-incl');
  ck('补充开关存在', !!incl);
  if (incl) {
    incl.checked = false;
    incl.dispatchEvent(new w.Event('change', { bubbles: true }));
    click('[data-scombo="had_hhad"]');
    ck('关闭补充后仍按 1+1 搭配', shapeOk(rows(), { '胜平负': 1, '让球胜平负': 1 }), shapeTxt(rows()));
    click('[data-scombo="had_ttg"]');
    ck('关闭补充后仍按 1+2 搭配', shapeOk(rows(), { '胜平负': 1, '总进球': 2 }), shapeTxt(rows()));
    incl.checked = true;
    incl.dispatchEvent(new w.Event('change', { bubbles: true }));
  }

  console.log('== 8. PNG 长图导出 ==');
  click('[data-scombo="had_ttg"]');
  ck('导出按钮存在', !!host().querySelector('[data-simexport]'));
  var dl = w.JX.simExportDataURL();
  ck('导出返回 dataURL', typeof dl === 'string' && dl.indexOf('data:image/png') === 0);
  ck('长图高度已按腿数展开（>1000px）', !!dl && /x(\d+)$/.test(dl) && +RegExp.$1 > 1000, dl);
  w.JX.simExportPNG();
  ck('导出弹窗已挂载', !!w.document.getElementById('sim-export-mask'));
  ck('弹窗内含下载按钮与图片', !!w.document.querySelector('#sim-export-mask .sexp-img') && !!w.document.querySelector('#sexp-dl'));
  var closeBtn = w.document.getElementById('sexp-close');
  if (closeBtn) closeBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ck('关闭后弹窗移除', !w.document.getElementById('sim-export-mask'));

  console.log('== 9. 结果统计口径 ==');
  var cells = [].slice.call(host().querySelectorAll('.mini-grid .mg-v')).map(function (d) { return d.textContent.trim(); });
  ck('统计块四个指标齐全', cells.length === 4, cells.join(' | '));
  ck('组合数非零', /^[1-9][\d,]*$/.test(cells[1] || ''), cells.join(' | '));
  ck('展示条数与实际行数一致', cells[3] && cells[3].indexOf('前 ' + rows().length + ' 组') > -1, cells[3] + ' / 行数 ' + rows().length);

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
}, 600);

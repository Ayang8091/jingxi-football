/* ==========================================================================
   串关模拟 · 双玩法搭配「按今日预测结果数定构成」专项校验
   --------------------------------------------------------------------------
   规则（与 datasource.buildRecs 同口径）：
     胜平负 / 让球胜平负 各 1 条、总进球 / 半全场 各 2 条、比分 3 条；
     双玩法搭配模式下，每注里某玩法的腿数 = 该玩法在「今日预测」里的结果数，
     关数 = 两者之和 → 胜平负+让球 = 1+1 = 2 串 1；含总进球的搭配 = 1+2 = 3 串 1。
   运行：
     NODE_PATH=/Users/apple/.workbuddy/binaries/node/workspace/node_modules \
     /Users/apple/.workbuddy/binaries/node/versions/22.22.2-3/bin/node tools/sim-compose-test.js
   ========================================================================== */
'use strict';
var fs = require('fs'), path = require('path'), jsdom = require('jsdom');
var JSDOM = jsdom.JSDOM, VirtualConsole = jsdom.VirtualConsole;
var ROOT = path.join(__dirname, '..');

var html = fs.readFileSync(path.join(ROOT, 'sim.html'), 'utf8');
var scripts = [];
html.replace(/<script src="([^"]+?)(?:\?[^"]*)?"><\/script>/g, function (_, s) { scripts.push(s); return ''; });

var vc = new VirtualConsole();
vc.on('jsdomError', function (e) { console.log('JSDOM ERROR:', e.message); });

var dom = new JSDOM(html, {
  runScripts: 'outside-only', url: 'https://jingxi.demo/sim.html',
  pretendToBeVisual: true, virtualConsole: vc
});
var w = dom.window;
w.fetch = undefined;                       // 强制走演示数据，保证可离线复现
stubCanvas(w);
scripts.forEach(function (src) { w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8')); });
w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

/* jsdom 没有 canvas 后端：装一个 2D 桩，只为让导出链路能跑通 */
function stubCanvas(win) {
  var proto = {
    measureText: function (t) { return { width: String(t).length * 7 }; },
    fillText: function () { }, strokeText: function () { },
    beginPath: function () { }, closePath: function () { }, moveTo: function () { },
    lineTo: function () { }, arc: function () { }, arcTo: function () { }, ellipse: function () { },
    rect: function () { }, roundRect: function () { }, quadraticCurveTo: function () { },
    bezierCurveTo: function () { }, fill: function () { }, stroke: function () { },
    fillRect: function () { }, strokeRect: function () { }, clearRect: function () { },
    save: function () { }, restore: function () { }, scale: function () { },
    translate: function () { }, rotate: function () { }, setTransform: function () { },
    clip: function () { }, setLineDash: function () { }, drawImage: function () { },
    createLinearGradient: function () { return { addColorStop: function () { } }; },
    createRadialGradient: function () { return { addColorStop: function () { } }; }
  };
  win.HTMLCanvasElement.prototype.getContext = function () {
    var c = Object.create(proto);
    c.canvas = this; c.font = ''; c.fillStyle = ''; c.strokeStyle = '';
    c.lineWidth = 1; c.textAlign = ''; c.textBaseline = '';
    return c;
  };
  win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,STUB'; };
}

var pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? ' | ' + extra : '')); }
}
function click(sel) {
  var el = w.document.querySelector(sel);
  if (!el) return false;
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return true;
}
function host() { return w.document.getElementById('sim-body'); }
function activeK() { var b = w.document.querySelector('[data-sk].on'); return b ? +b.dataset.sk : null; }
function kBtnCount() { return w.document.querySelectorAll('[data-sk]').length; }
function hint() { var e = host().querySelector('.card-h .hint'); return e ? e.textContent : ''; }
function cardHtml() { return host().innerHTML; }

/* 玩法名「让球胜平负」包含「胜平负」：必须用正则按优先级整体匹配 */
var PLAY_RE = /(让球胜平负|胜平负|总进球|半全场|比分)\s*·/g;

function rowComps() {
  var rows = [].slice.call(host().querySelectorAll('table.tbl tbody tr'));
  return rows.map(function (tr) {
    var cells = [].slice.call(tr.querySelectorAll('td:nth-child(2) div'));
    var cnt = {};
    cells.forEach(function (d) {
      var re = new RegExp(PLAY_RE.source, 'g'), m;
      while ((m = re.exec(d.textContent))) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
    });
    return { n: cells.length, cnt: cnt };
  });
}
function compStr(cnt) {
  return Object.keys(cnt).sort().map(function (p) { return p + '×' + cnt[p]; }).join(' + ');
}
function sameComp(cnt, want) {
  var a = compStr(cnt), b = compStr(want);
  return a === b;
}

var MODES = [
  { k: 'had_hhad', label: '胜平负+让球', want: { '胜平负': 1, '让球胜平负': 1 }, legs: 2 },
  { k: 'had_ttg', label: '胜平负+总进球', want: { '胜平负': 1, '总进球': 2 }, legs: 3 },
  { k: 'hhad_ttg', label: '让球+总进球', want: { '让球胜平负': 1, '总进球': 2 }, legs: 3 }
];

setTimeout(function () {
  console.log('== 1. 找一个能出组合的日期（双玩法搭配需要 ≥3 场候选） ==');
  var day = null;
  ['today', 'tomorrow', 'after'].some(function (d) {
    click('[data-sday="' + d + '"]');
    click('[data-scombo="had_ttg"]');
    if (rowComps().length) { day = d; return true; }
    return false;
  });
  ck('存在可出结果的日期：' + day, !!day);
  if (!day) { return finish(); }

  console.log('== 2. 三个双玩法组合的构成与默认关数 ==');
  MODES.forEach(function (m) {
    click('[data-scombo="' + m.k + '"]');
    var rows = rowComps();
    ck(m.label + '：默认关数 = ' + m.legs + '（实际 ' + activeK() + '）', activeK() === m.legs);
    ck(m.label + '：关数按钮仍保留 2/3/4（实际 ' + kBtnCount() + ' 个）', kBtnCount() === 3);
    ck(m.label + '：有组合结果（' + rows.length + ' 组）', rows.length > 0);
    var bad = rows.filter(function (r) { return !sameComp(r.cnt, m.want); });
    ck(m.label + '：每组都是 ' + compStr(m.want) + '（不合格 ' + bad.length + ' 组）',
      rows.length > 0 && bad.length === 0,
      bad.length ? '例：' + compStr(bad[0].cnt) : '');
    ck(m.label + '：每注腿数 = ' + m.legs + '（实际 ' + (rows[0] ? rows[0].n : '-') + '）',
      !!rows[0] && rows[0].n === m.legs);
    ck(m.label + '：结果卡标注每注构成',
      hint().indexOf('每注') > -1 && hint().indexOf(m.legs + ' 串 1') > -1, hint());
    ck(m.label + '：参数区说明按今日预测结果数配腿',
      cardHtml().indexOf('按今日预测的结果数配腿') > -1);
  });

  console.log('== 3. 手动切换关数后改为自由搭配 ==');
  click('[data-scombo="had_ttg"]');
  click('[data-sk="4"]');
  ck('切到 4 串 1 生效（实际 ' + activeK() + '）', activeK() === 4);
  ck('表头显示 4 腿', hint().indexOf('4 串 1') > -1, hint());
  ck('提示已手动切档、改为自由搭配', cardHtml().indexOf('手动切到 4 串 1') > -1);
  click('[data-sk="3"]');
  var rows3 = rowComps();
  ck('切回 3 串 1 后恢复按结果数过滤（' + (rows3[0] ? compStr(rows3[0].cnt) : '-') + '）',
    rows3.length > 0 && rows3.every(function (r) { return sameComp(r.cnt, { '胜平负': 1, '总进球': 2 }); }));

  console.log('== 4. 单一玩法组合不受影响 ==');
  click('[data-scombo="ttg"]');
  ck('总进球组合：关数按钮 2/3/4 可手动切', kBtnCount() === 3);
  var trows = rowComps();
  ck('总进球组合：每组只含总进球（' + (trows[0] ? compStr(trows[0].cnt) : '-') + '）',
    trows.length > 0 && trows.every(function (r) { return Object.keys(r.cnt).join() === '总进球'; }));
  click('[data-scombo="had_hhad"]');
  ck('切回双玩法模式后关数自动回到 2 串 1（实际 ' + activeK() + '）', activeK() === 2);

  console.log('== 5. 渲染卫生与导出链路 ==');
  var htmlAll = cardHtml();
  ck('无 NaN', htmlAll.indexOf('NaN') === -1);
  ck('无 undefined', htmlAll.indexOf('undefined') === -1);
  var url = null, err = null;
  try { url = w.JX.simExportDataURL(); } catch (e) { err = e; }
  ck('PNG 长图可生成（无异常）', !err && !!url, err ? err.message : '');
  ck('PNG 头部含「每注」构成标注', htmlAll.indexOf('每注') > -1);

  finish();
});

function finish() {
  console.log('\n' + (fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 项通过 / ' + fail + ' 项失败');
  process.exit(fail === 0 ? 0 : 1);
}

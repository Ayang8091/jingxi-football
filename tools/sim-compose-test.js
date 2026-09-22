/* ==========================================================================
   串关模拟 · 每注构成「按今日预测结果数 + 场数」专项校验
   --------------------------------------------------------------------------
   规则（用户定稿的构成表）：
     · 关数 = 场数：2 串 1 = 2 场、3 串 1 = 3 场、4 串 1 = 4 场；
     · 每一场的腿数 = 该场在「今日预测」里的结果数：
       胜平负 / 让球胜平负 1 条，总进球 2 条；
     · 单玩法组合：每场取该玩法全部结果；
     · 双玩法组合：主玩法只占 1 场（1 条），其余（关数-1）场归第二玩法（每场全部结果）。
   于是 2 串 1 的构成是：
     总进球组合           总进球 2 条 + 总进球 2 条      （4 腿）
     胜平负+让球组合       胜平负 1 条 + 让球胜平负 1 条    （2 腿）
     胜平负+总进球组合     胜平负 1 条 + 总进球 2 条       （3 腿）
     让球+总进球组合       让球胜平负 1 条 + 总进球 2 条   （3 腿）
   运行：
     NODE_PATH=/Users/apple/.workbuddy/binaries/node/workspace/node_modules \
     /Users/apple/.workbuddy/binaries/node/versions/22.22.2-3/bin/node tools/sim-compose-test.js
   ========================================================================== */
'use strict';
var fs = require('fs'), path = require('path'), jsdom = require('jsdom');
var JSDOM = jsdom.JSDOM, VirtualConsole = jsdom.VirtualConsole;
var ROOT = path.join(__dirname, '..');
var apiPayload = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sporttery-sample.json'), 'utf8'));

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
/* 注入官方接口夹具：保证「今日预测」每场都有 1 条胜平负 / 2 条总进球，可离线复现 */
w.fetch = function () {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(apiPayload); } });
};
try { w.localStorage.clear(); } catch (e) { }
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
function overallOpt() {                       // 切到「全部」赔率区间，避免高关数被区间挡掉
  var btns = w.document.querySelectorAll('[data-srange]');
  if (btns.length) btns[btns.length - 1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
}

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
function sameComp(cnt, want) { return compStr(cnt) === compStr(want); }

/* 期望：每注构成 = f(关数) */
var MODES = [
  {
    k: 'had', label: '胜平负组合',
    want: function (n) { return { '胜平负': n }; },
    legs: function (n) { return n; },
    text2: '胜平负 1 条 + 胜平负 1 条'
  },
  {
    k: 'ttg', label: '总进球组合',
    want: function (n) { return { '总进球': 2 * n }; },
    legs: function (n) { return 2 * n; },
    text2: '总进球 2 条 + 总进球 2 条'
  },
  {
    k: 'had_hhad', label: '胜平负+让球组合',
    want: function (n) { return { '胜平负': 1, '让球胜平负': n - 1 }; },
    legs: function (n) { return n; },
    text2: '胜平负 1 条 + 让球胜平负 1 条'
  },
  {
    k: 'had_ttg', label: '胜平负+总进球组合',
    want: function (n) { return { '胜平负': 1, '总进球': 2 * (n - 1) }; },
    legs: function (n) { return 2 * n - 1; },
    text2: '胜平负 1 条 + 总进球 2 条'
  },
  {
    k: 'hhad_ttg', label: '让球+总进球组合',
    want: function (n) { return { '让球胜平负': 1, '总进球': 2 * (n - 1) }; },
    legs: function (n) { return 2 * n - 1; },
    text2: '让球胜平负 1 条 + 总进球 2 条'
  }
];

setTimeout(function () {
  console.log('== 1. 数据与基准档 ==');
  click('[data-sday="today"]');
  overallOpt();
  MODES.forEach(function (m) {
    click('[data-scombo="' + m.k + '"]');
    ck(m.label + '：进模式后默认 2 串 1（实际 ' + activeK() + '）', activeK() === 2);
  });
  ck('关数按钮保留 2/3/4 三个（实际 ' + kBtnCount() + '）', kBtnCount() === 3);

  console.log('== 2. 六个模式的 2 串 1 构成（= 用户定稿表） ==');
  MODES.forEach(function (m) {
    click('[data-scombo="' + m.k + '"]');
    overallOpt();
    click('[data-sk="2"]');
    var rows = rowComps();
    ck(m.label + '：2 串 1 有结果（' + rows.length + ' 组）', rows.length > 0);
    var bad = rows.filter(function (r) { return !sameComp(r.cnt, m.want(2)); });
    ck(m.label + '：每注构成 = ' + compStr(m.want(2)) + '（不合格 ' + bad.length + ' 组）',
      rows.length > 0 && bad.length === 0, bad.length ? '例：' + compStr(bad[0].cnt) : '');
    ck(m.label + '：每注腿数 = ' + m.legs(2) + '（实际 ' + (rows[0] ? rows[0].n : '-') + '）',
      !!rows[0] && rows[0].n === m.legs(2));
    ck(m.label + '：结果卡标注「' + m.text2 + '」', hint().indexOf(m.text2) > -1, hint());
    ck(m.label + '：结果卡标注 2 串 1（2 场）', hint().indexOf('2 串 1（2 场') > -1, hint());
  });

  console.log('== 3. 关数 3 / 4（场数增加，构成按同一条规则扩展） ==');
  MODES.forEach(function (m) {
    click('[data-scombo="' + m.k + '"]');
    overallOpt();
    [3, 4].forEach(function (n) {
      click('[data-sk="' + n + '"]');
      var rows = rowComps();
      ck(m.label + '：' + n + ' 串 1 有结果（' + rows.length + ' 组）', rows.length > 0);
      var bad = rows.filter(function (r) { return !sameComp(r.cnt, m.want(n)); });
      ck(m.label + '：' + n + ' 串 1 构成 = ' + compStr(m.want(n)) + '（不合格 ' + bad.length + ' 组）',
        rows.length > 0 && bad.length === 0, bad.length ? '例：' + compStr(bad[0].cnt) : '');
      ck(m.label + '：' + n + ' 串 1 腿数 = ' + m.legs(n) + '（实际 ' + (rows[0] ? rows[0].n : '-') + '）',
        !!rows[0] && rows[0].n === m.legs(n));
      ck(m.label + '：' + n + ' 串 1 标注（' + n + ' 场 · ' + m.legs(n) + ' 腿）',
        hint().indexOf(n + ' 串 1（' + n + ' 场 · ' + m.legs(n) + ' 腿）') > -1, hint());
    });
  });

  console.log('== 4. 混合模式不受影响（每场 1 条腿，关数 = 场数 = 腿数） ==');
  click('[data-scombo="mix3"]');
  overallOpt();
  [2, 3, 4].forEach(function (n) {
    click('[data-sk="' + n + '"]');
    var rows = rowComps();
    ck('玩法混合组合：' + n + ' 串 1 = ' + n + ' 场 / ' + n + ' 腿（实际 ' +
      (rows[0] ? rows[0].n + ' 腿' : '-') + '）', !!rows[0] && rows[0].n === n);
  });
  click('[data-scombo="oddsMix"]');
  overallOpt();
  var orows = rowComps();
  ck('按赔率混合组合：仍可出结果（' + orows.length + ' 组）', orows.length > 0);

  console.log('== 5. 构成文案与参数区说明 ==');
  click('[data-scombo="ttg"]');
  ck('总进球组合参数区写出 2 串 1 构成', cardHtml().indexOf('总进球 2 条 + 总进球 2 条') > -1);
  click('[data-scombo="hhad_ttg"]');
  ck('让球+总进球参数区写出 2 串 1 构成', cardHtml().indexOf('让球胜平负 1 条 + 总进球 2 条') > -1);
  ck('参数区标注关数 = 场数', cardHtml().indexOf('串关关数（场数）') > -1);

  console.log('== 6. 渲染卫生与导出链路 ==');
  var htmlAll = cardHtml();
  ck('无 NaN', htmlAll.indexOf('NaN') === -1);
  ck('无 undefined', htmlAll.indexOf('undefined') === -1);
  var url = null, err = null;
  try { url = w.JX.simExportDataURL(); } catch (e) { err = e; }
  ck('PNG 长图可生成（无异常）', !err && !!url, err ? err.message : '');
  ck('PNG 头部含每注构成', htmlAll.indexOf('每注') > -1);

  finish();
}, 320);

function finish() {
  console.log('\n' + (fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 项通过 / ' + fail + ' 项失败');
  process.exit(fail === 0 ? 0 : 1);
}

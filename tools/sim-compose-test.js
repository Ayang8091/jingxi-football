/* ==========================================================================
   串关模拟 · 构成专项校验（关数 = 场数 = 腿数，同场多结果合并为一条腿）
   --------------------------------------------------------------------------
   规则（用户定稿）：
     · 关数 = 场数 = 腿数：2 串 1 = 2 场 = 2 腿；
     · 每场的结果数 = 该场在「今日预测」里的结果数：
       胜平负 / 让球胜平负 1 条，总进球 2 条；
     · 同一场比赛在同一玩法下的多个结果「合并为一条腿」（复式），
       如「周一001 中国女 vs 菲律宾女 总进球 · 2球、3球」，腿赔率 = 腿内最高的 SP；
     · 单玩法组合：每场取该玩法全部结果；
     · 双玩法组合：主玩法只占 1 场（1 条），其余（关数-1）场归第二玩法（每场全部结果）。
   于是 2 串 1 的构成是：
     总进球组合           总进球 2 条 + 总进球 2 条      （2 腿，每腿 2 个结果）
     胜平负+让球组合       胜平负 1 条 + 让球胜平负 1 条    （2 腿，每腿 1 个结果）
     胜平负+总进球组合     胜平负 1 条 + 总进球 2 条       （2 腿）
     让球+总进球组合       让球胜平负 1 条 + 总进球 2 条   （2 腿）
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

/* 一条腿的 DOM 文本形如：
   周一001 中国女 vs 菲律宾女 总进球 · 2球、3球@3.95（取最高，3.95/4.45）
   解析出：场次号、玩法、各结果、腿赔率（单结果=SP；多结果=腿内最高 SP） */
var LEG_RE = /^(\S+)\s+([\s\S]*?)(让球胜平负|胜平负|总进球|半全场|比分)\s*·\s*([^@]+)@(.+)$/;
function parseLeg(div) {
  var t = div.textContent.replace(/\s+/g, ' ').trim();
  var m = LEG_RE.exec(t);
  if (!m) return null;
  var oddsTxt = m[5].trim();
  var mm = /^([\d.]+)（取最高，([\d.]+(?:\/[\d.]+)*)）$/.exec(oddsTxt);
  return {
    no: m[1], play: m[3],
    sels: m[4].trim().split('、'),
    oddsTxt: oddsTxt,
    spTxt: mm ? mm[1] : oddsTxt,
    cands: mm ? mm[2].split('/').map(Number) : [Number(oddsTxt)],
    n: m[4].trim().split('、').length
  };
}
function rowLegs() {
  var rows = [].slice.call(host().querySelectorAll('table.tbl tbody tr'));
  return rows.map(function (tr) {
    var divs = [].slice.call(tr.querySelectorAll('td:nth-child(2) div'));
    return { raw: divs.map(function (d) { return d.textContent.replace(/\s+/g, ' ').trim(); }),
      legs: divs.map(parseLeg) };
  });
}
function legsByPlay(legs) {
  var c = {};
  legs.forEach(function (l) { if (l) c[l.play] = (c[l.play] || 0) + 1; });
  return c;
}
function sameObj(a, b) {
  var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return false;
  for (var i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
  return true;
}
function str(c) { return Object.keys(c).sort().map(function (p) { return p + '×' + c[p]; }).join(' + '); }
function num(t) { return parseFloat(String(t).replace(/[^\d.]/g, '')); }

/* 期望：每注构成 = f(关数)。legs = 各玩法的腿数，res = 该玩法每腿的结果数 */
var MODES = [
  {
    k: 'had', label: '胜平负组合',
    legs: function (n) { return { '胜平负': n }; }, res: { '胜平负': 1 },
    text2: '胜平负 1 条 + 胜平负 1 条'
  },
  {
    k: 'ttg', label: '总进球组合',
    legs: function (n) { return { '总进球': n }; }, res: { '总进球': 2 },
    text2: '总进球 2 条 + 总进球 2 条'
  },
  {
    k: 'had_hhad', label: '胜平负+让球组合',
    legs: function (n) { return { '胜平负': 1, '让球胜平负': n - 1 }; }, res: { '胜平负': 1, '让球胜平负': 1 },
    text2: '胜平负 1 条 + 让球胜平负 1 条'
  },
  {
    k: 'had_ttg', label: '胜平负+总进球组合',
    legs: function (n) { return { '胜平负': 1, '总进球': n - 1 }; }, res: { '胜平负': 1, '总进球': 2 },
    text2: '胜平负 1 条 + 总进球 2 条'
  },
  {
    k: 'hhad_ttg', label: '让球+总进球组合',
    legs: function (n) { return { '让球胜平负': 1, '总进球': n - 1 }; }, res: { '让球胜平负': 1, '总进球': 2 },
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

  console.log('== 2. 五个模式的 2 串 1 构成（= 用户定稿表） ==');
  MODES.forEach(function (m) {
    click('[data-scombo="' + m.k + '"]');
    overallOpt();
    click('[data-sk="2"]');
    var rows = rowLegs();
    ck(m.label + '：2 串 1 有结果（' + rows.length + ' 组）', rows.length > 0);
    var parsed = rows.every(function (r) { return r.legs.every(function (l) { return !!l; }); });
    ck(m.label + '：每行腿文本均可解析（场次/玩法/结果/赔率）', parsed,
      parsed ? '' : rows[0].raw.join(' || '));
    var badComp = rows.filter(function (r) { return !sameObj(legsByPlay(r.legs), m.legs(2)); });
    ck(m.label + '：每注腿构成 = ' + str(m.legs(2)) + '（不合格 ' + badComp.length + ' 组）',
      rows.length > 0 && badComp.length === 0, badComp.length ? '例：' + str(legsByPlay(badComp[0].legs)) : '');
    ck(m.label + '：每注腿数 = 2（= 关数 = 场数，实际 ' + (rows[0] ? rows[0].legs.length : '-') + '）',
      !!rows[0] && rows[0].legs.length === 2);
    var badRes = rows.filter(function (r) {
      return !r.legs.every(function (l) { return l && l.n === m.res[l.play]; });
    });
    ck(m.label + '：每腿结果数 = ' + JSON.stringify(m.res) + '（不合格 ' + badRes.length + ' 组）',
      rows.length > 0 && badRes.length === 0,
      badRes.length ? '例：' + JSON.stringify(badRes[0].legs.map(function (l) { return l.play + ':' + l.n; })) : '');
    var dup = rows.filter(function (r) {
      var nos = r.legs.map(function (l) { return l && l.no; });
      return new Set(nos).size !== nos.length;
    });
    ck(m.label + '：同一场比赛不重复串联（重复行 ' + dup.length + '）', dup.length === 0);
    ck(m.label + '：结果卡标注「' + m.text2 + '」', hint().indexOf(m.text2) > -1, hint());
    ck(m.label + '：结果卡标注 2 串 1 · 2 腿', hint().indexOf('2 串 1 · 2 腿') > -1, hint());
  });

  console.log('== 3. 关数 3 / 4（场数 = 腿数增加，构成按同一条规则扩展） ==');
  MODES.forEach(function (m) {
    click('[data-scombo="' + m.k + '"]');
    overallOpt();
    [3, 4].forEach(function (n) {
      click('[data-sk="' + n + '"]');
      var rows = rowLegs();
      ck(m.label + '：' + n + ' 串 1 有结果（' + rows.length + ' 组）', rows.length > 0);
      var bad = rows.filter(function (r) { return !sameObj(legsByPlay(r.legs), m.legs(n)); });
      ck(m.label + '：' + n + ' 串 1 腿构成 = ' + str(m.legs(n)) + '（不合格 ' + bad.length + ' 组）',
        rows.length > 0 && bad.length === 0, bad.length ? '例：' + str(legsByPlay(bad[0].legs)) : '');
      ck(m.label + '：' + n + ' 串 1 每注腿数 = ' + n + '（实际 ' + (rows[0] ? rows[0].legs.length : '-') + '）',
        !!rows[0] && rows[0].legs.length === n);
      ck(m.label + '：' + n + ' 串 1 标注「' + n + ' 串 1 · ' + n + ' 腿」',
        hint().indexOf(n + ' 串 1 · ' + n + ' 腿') > -1, hint());
    });
  });

  console.log('== 4. 同场多结果合并为一条腿（复式） ==');
  click('[data-scombo="ttg"]');
  overallOpt();
  click('[data-sk="2"]');
  var trows = rowLegs();
  ck('总进球组合：每腿含 2 个结果，用「、」连接',
    trows.length > 0 && trows[0].legs.every(function (l) { return l.n === 2; }));
  ck('总进球组合：腿文本形如「… 总进球 · 2球、3球@…」（' + (trows[0] ? trows[0].legs[0].sels.join('、') : '-') + '）',
    !!trows[0] && trows[0].legs[0].sels.length === 2);
  ck('总进球组合：多结果腿按「取最高」计价（' + (trows[0] ? trows[0].legs[0].oddsTxt : '-') + '）',
    !!trows[0] && trows[0].legs.every(function (l) { return /取最高/.test(l.oddsTxt); }));
  /* 腿赔率 = 腿内各结果 SP 的最高值（不做相乘） */
  var odOk = trows.length > 0 && trows[0].legs.every(function (l) {
    return Math.abs(Math.max.apply(null, l.cands) - Number(l.spTxt)) < 0.02;
  });
  ck('总进球组合：腿赔率 = 腿内最高的 SP', odOk);
  /* 组合赔率 = 各腿腿赔率相乘 */
  var combOk = trows.length > 0 && trows[0].legs.every(function () { return true; }) &&
    (function () {
      var tr = host().querySelectorAll('table.tbl tbody tr')[0];
      if (!tr) return false;
      var shown = Number([].slice.call(tr.querySelectorAll('td'))[2].textContent.replace(/[^\d.]/g, ''));
      var prod = trows[0].legs.reduce(function (a, l) { return a * Number(l.spTxt); }, 1);
      return Math.abs(prod - shown) < 0.05;
    })();
  ck('总进球组合：组合赔率 = 各腿腿赔率相乘', combOk);
  /* 用页面内部结果精确校验赔率/概率口径（JX.simLast） */
  var S = w.JX.simLast();
  ck('总进球组合：腿赔率 = 腿内最高 SP（按内部数据）',
    !!S && S.shown.length > 0 && S.shown.every(function (c) {
      return c.legs.every(function (lg) {
        var mx = Math.max.apply(null, lg.legs.map(function (l) { return l.sp; }));
        return Math.abs(mx - lg.sp) < 1e-9;
      });
    }));
  ck('总进球组合：组合赔率 = 各腿腿赔率相乘（按内部数据）',
    !!S && S.shown.every(function (c) {
      return Math.abs(c.legs.reduce(function (a, lg) { return a * lg.sp; }, 1) - c.sp) < 1e-9;
    }));
  ck('总进球组合：联合概率 = 各腿腿概率相乘，腿概率 = 腿内各结果概率相加',
    !!S && S.shown.every(function (c) {
      var want = c.legs.reduce(function (a, lg) {
        return a * lg.legs.reduce(function (b, l) { return b + l.p; }, 0);
      }, 1);
      return Math.abs(want - c.p) < 1e-9;
    }));
  ck('总进球组合：腿概率不再是「腿内各结果概率相乘」',
    !!S && S.shown.every(function (c) {
      return c.legs.every(function (lg) {
        if (lg.legs.length < 2) return true;
        var prod = lg.legs.reduce(function (b, l) { return b * l.p; }, 1);
        return Math.abs(prod - lg.p) > 1e-9;
      });
    }));
  var evOk = (function () {
    var trs = [].slice.call(host().querySelectorAll('table.tbl tbody tr'));
    return !!S && trs.length > 0 && trs.slice(0, 3).every(function (tr, i) {
      var cell = Number([].slice.call(tr.querySelectorAll('td'))[5].textContent.replace(/[^\d.\-]/g, ''));
      var c = S.shown[i];
      return !!c && Math.abs(cell - (c.p * c.sp - 1) * 100) < 0.15;
    });
  })();
  ck('总进球组合：EV 单元格 = (联合概率 × 组合赔率 − 1) × 100', evOk);
  click('[data-scombo="had"]');
  overallOpt();
  ck('胜平负组合：单结果腿赔率为单个 SP（不带取最高标注）',
    rowLegs().every(function (r) { return r.legs.every(function (l) { return !/取最高/.test(l.oddsTxt); }); }));

  console.log('== 5. 混合模式不受影响（每场 1 条腿，关数 = 场数 = 腿数） ==');
  click('[data-scombo="mix3"]');
  overallOpt();
  [2, 3, 4].forEach(function (n) {
    click('[data-sk="' + n + '"]');
    var rows = rowLegs();
    ck('玩法混合组合：' + n + ' 串 1 = ' + n + ' 腿（实际 ' + (rows[0] ? rows[0].legs.length : '-') + '）',
      !!rows[0] && rows[0].legs.length === n);
    ck('玩法混合组合：' + n + ' 串 1 每腿 1 个结果',
      !!rows[0] && rows[0].legs.every(function (l) { return l && l.n === 1; }));
  });
  click('[data-scombo="oddsMix"]');
  overallOpt();
  ck('按赔率混合组合：仍可出结果（' + rowLegs().length + ' 组）', rowLegs().length > 0);

  console.log('== 6. 构成文案与参数区说明 ==');
  click('[data-scombo="ttg"]');
  ck('总进球组合参数区写出 2 串 1 构成', cardHtml().indexOf('总进球 2 条 + 总进球 2 条') > -1);
  click('[data-scombo="hhad_ttg"]');
  ck('让球+总进球参数区写出 2 串 1 构成', cardHtml().indexOf('让球胜平负 1 条 + 总进球 2 条') > -1);
  ck('参数区标注关数 = 场数', cardHtml().indexOf('串关关数（场数）') > -1);
  ck('参数区说明「同场结果合并为一条腿」', cardHtml().indexOf('合并为一条腿') > -1);

  console.log('== 7. 渲染卫生与导出链路 ==');
  var htmlAll = cardHtml();
  ck('无 NaN', htmlAll.indexOf('NaN') === -1);
  ck('无 undefined', htmlAll.indexOf('undefined') === -1);
  var url = null, err = null;
  try { url = w.JX.simExportDataURL(); } catch (e) { err = e; }
  ck('PNG 长图可生成（无异常）', !err && !!url, err ? err.message : '');

  finish();
}, 320);

function finish() {
  console.log('\n' + (fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 项通过 / ' + fail + ' 项失败');
  process.exit(fail === 0 ? 0 : 1);
}

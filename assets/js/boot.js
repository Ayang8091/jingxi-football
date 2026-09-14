/* ==========================================================================
   竞析 JINGXI · 站点启动器
   按 <body data-page="..."> 分发到对应页面渲染器，并统一注入导航与页脚。
   ========================================================================== */
(function (global) {
  'use strict';

  var D = global.JX_DATA, U = global.JX.U;
  var MAP = {
    home: 'renderHome',
    match: 'renderMatch',
    model: 'renderModel',
    records: 'renderRecords',
    dash: 'renderDashboard',
    law: 'renderCompliance'
  };

  function fatal(err) {
    var box = document.createElement('div');
    box.className = 'wrap';
    box.style.padding = '36px 20px';
    box.innerHTML = '<div class="callout c-warn"><h4>页面渲染出现异常</h4>' +
      '<p class="small">这通常意味着某个脚本未正确加载。请检查以下文件的引入顺序：' +
      '<code>data.js → core.js → app.js → boot.js</code>。</p>' +
      '<p class="small mb0" style="font-family:monospace">' +
      U.esc(err && err.message ? err.message : String(err)) + '</p></div>';
    var target = document.querySelector('main') || document.body;
    target.insertBefore(box, target.firstChild);
  }

  function boot() {
    var page = (document.body.getAttribute('data-page') || '').trim();

    /* 单场剖析页：未指定 id 时，默认展开今日信心最高的一场 */
    if (page === 'match' && !U.qs('id')) {
      var best = D.matches.filter(function (m) { return m.day === 'today'; })
        .sort(function (a, b) { return b.conf - a.conf; })[0];
      if (best) {
        try { history.replaceState(null, '', '?id=' + best.id); } catch (e) { /* file:// 下忽略 */ }
      }
    }

    try {
      global.JX.layout(page);
      var fn = MAP[page];
      if (fn && typeof global.JX[fn] === 'function') {
        global.JX[fn]();
      } else if (fn) {
        throw new Error('渲染器 ' + fn + ' 未定义（对应页面脚本未加载）');
      }
    } catch (err) {
      console.error('[竞析] 渲染失败', err);
      fatal(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);

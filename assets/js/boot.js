/* ==========================================================================
   竞析 JINGXI · 站点启动器
   职责：
     1) 按 <body data-page="..."> 分发到对应页面渲染器
     2) 初始化数据源（先渲染缓存/快照 → 再后台拉取官方接口 → 数据变化时重渲染）
     3) 页面统一注入导航、数据状态条与页脚
   ========================================================================== */
(function (global) {
  'use strict';

  var U = global.JX.U;
  var MAP = {
    home: 'renderHome',
    match: 'renderMatch',
    sim: 'renderSim',
    parlay: 'renderParlay',
    model: 'renderModel',
    records: 'renderRecords',
    dash: 'renderDashboard',
    law: 'renderCompliance'
  };

  var currentPage = null;

  function fatal(err) {
    var box = document.createElement('div');
    box.className = 'wrap';
    box.style.padding = '36px 20px';
    box.innerHTML = '<div class="callout c-warn"><h4>页面渲染出现异常</h4>' +
      '<p class="small">这通常意味着某个脚本未正确加载。请检查以下文件的引入顺序：' +
      '<code>data.js → core.js → datasource.js → parlay.js → app.js → pages-*.js → boot.js</code>。</p>' +
      '<p class="small mb0" style="font-family:monospace">' +
      U.esc(err && err.message ? err.message : String(err)) + '</p></div>';
    var target = document.querySelector('main') || document.body;
    target.insertBefore(box, target.firstChild);
  }

  function renderPage() {
    var fn = MAP[currentPage];
    if (fn && typeof global.JX[fn] === 'function') {
      global.JX[fn]();
    } else if (fn) {
      throw new Error('渲染器 ' + fn + ' 未定义（对应页面脚本未加载）');
    }
  }

  function boot() {
    var page = (document.body.getAttribute('data-page') || '').trim();
    currentPage = page;

    /* 单场剖析页：未指定 id 时默认展开信心最高的一场 */
    if (page === 'match' && !U.qs('id')) {
      var ms = (global.JX_DATA.matches || []).slice();
      var best = ms.sort(function (a, b) { return (b.conf || 0) - (a.conf || 0); })[0];
      if (best) { try { history.replaceState(null, '', '?id=' + best.id); } catch (e) { } }
    }

    try {
      global.JX.layout(page);
      renderPage();
    } catch (err) {
      console.error('[竞析] 渲染失败', err);
      fatal(err);
      return;
    }

    /* ---------------- 数据源初始化 ---------------- */
    var DS = global.JX.DS;
    if (!DS) return;

    var sig = null;
    function signature() {
      var s = DS.state();
      return [s.mode, s.count, s.fetchedAt, s.loading ? 1 : 0].join('|');
    }

    DS.on(function () {
      try { global.JX.renderStatus(); } catch (e) { }
      /* 仅在数据实际发生变化时重渲染页面，避免更新过程中的无谓闪烁 */
      var s2 = signature();
      var st = DS.state();
      if (!st.loading && s2 !== sig) {
        sig = s2;
        try { renderPage(); } catch (e) { console.error('[竞析] 数据更新后重渲染失败', e); }
      }
    });

    sig = signature();
    /* DS.init 会先同步应用 localStorage 缓存（若有），再发起网络请求 */
    DS.init().then(function () {
      var s2 = signature();
      if (s2 !== sig) {
        sig = s2;
        try { renderPage(); } catch (e) { console.error(e); }
      }
    });

    global.JX.rerender = renderPage;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);

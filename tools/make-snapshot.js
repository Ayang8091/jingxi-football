#!/usr/bin/env node
/* ==========================================================================
   竞析 JINGXI · 生成站点内置数据快照（api/snapshot.json）
   --------------------------------------------------------------------------
   用途：把中国体彩网官方接口的当前响应原样抓下来，随站点一起发布。
   页面在「直连 / CORS 中继 / 本地缓存」全部不可用时，会退到这份同源快照，
   从而在任何网络环境下都能展示真实（可能略旧）的官方数据，
   而不是回退到演示数据。

   用法：
     node tools/make-snapshot.js            # 抓取并写入 api/snapshot.json
     node tools/make-snapshot.js --check    # 只校验已有快照，不抓取
   ========================================================================== */
'use strict';

var fs = require('fs');
var path = require('path');

var API = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry';
var POOLS = 'hhad,had,ttg,crs,hafu';
var OUT = path.join(__dirname, '..', 'api', 'snapshot.json');
var URL_FULL = API + '?poolCode=' + encodeURIComponent(POOLS) + '&channel=c';

function p2(n) { return (n < 10 ? '0' : '') + n; }
function stamp(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
    p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
}

function countMatches(payload) {
  var n = 0;
  ((payload.value && payload.value.matchInfoList) || []).forEach(function (day) {
    (day.subMatchList || []).forEach(function (m) { if (!m.isHide) n++; });
  });
  return n;
}

function check() {
  if (!fs.existsSync(OUT)) { console.log('快照不存在:', OUT); process.exit(1); }
  var j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  console.log('快照文件:', OUT);
  console.log('抓取时间:', j.fetchedAt);
  console.log('数据时间:', j.remoteUpdate);
  console.log('可分析场次:', countMatches(j.payload));
  console.log('文件大小:', (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB');
}

function fetchOnce() {
  return fetch(URL_FULL, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://www.sporttery.cn/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
    }
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function run() {
  if (process.argv.indexOf('--check') > -1) return check();

  var tries = 0;
  (function attempt() {
    tries++;
    return fetchOnce().then(function (json) {
      if (!json || json.success !== true || !json.value) throw new Error('接口返回异常');
      var n = countMatches(json);
      if (!n) throw new Error('接口未返回可分析赛事');
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      var doc = {
        _note: '站点内置数据快照：中国体彩网竞彩足球官方接口原始响应，由 tools/make-snapshot.js 生成。' +
          '仅在页面无法直连官方接口时作为兜底数据源使用。',
        fetchedAt: stamp(),
        remoteUpdate: json.value.lastUpdateTime || '',
        matchCount: n,
        payload: json
      };
      fs.writeFileSync(OUT, JSON.stringify(doc));
      console.log('快照已写入:', OUT);
      console.log('可分析场次:', n, '· 数据时间:', doc.remoteUpdate, '· 文件大小:', (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB');
    }).catch(function (err) {
      if (tries < 3) {
        console.log('第 ' + tries + ' 次抓取失败（' + err.message + '），重试…');
        return new Promise(function (res) { setTimeout(res, 1500); }).then(attempt);
      }
      console.error('抓取失败：' + err.message);
      if (fs.existsSync(OUT)) { console.error('已保留原有快照，未覆盖。'); check(); }
      process.exit(1);
    });
  })();
}

run();

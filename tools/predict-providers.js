#!/usr/bin/env node
/* ==========================================================================
   竞析 JINGXI · 预测数据源接入层（多 Provider 适配）
   --------------------------------------------------------------------------
   目的：把外部「预测类」数据源统一成一份结构（胜平负 1X2 概率 + 推荐方向），
        供「今日预测」做交叉参考，并供 tools/backtest-providers.js 回测命中率。

   统一输出记录：
     {
       provider: 'apiFootball',
       date: '2026-09-29',
       matchKey: '2026-09-29|arsenal+chelsea',   // 归一化队名，便于跨源对齐与回测
       home: 'Arsenal', away: 'Chelsea',
       market: 'had',
       probs: { h: 0.46, d: 0.28, a: 0.26 },     // 和恒为 1（各源自行归一化）
       pick: 'h',                                 // 概率最高方向 h/d/a
       odds: { h: 2.1, d: 3.4, a: 3.2 },          // 平均赔率（有则给）
       fetchedAt: '2026-09-29T13:00:00+08:00'
     }

   密钥配置（优先级：环境变量 > ~/.jingxi-predict-keys.json）：
     API-FOOTBALL:        JX_KEY_APIFOOTBALL   / { "apiFootball": "..." }
     Football Prediction: JX_KEY_RAPIDAPI      / { "rapidApi": "..." }
     Apify (Forebet):     JX_KEY_APIFY         / { "apify": "..." }

   用法：
     node tools/predict-providers.js --date 2026-09-29
     node tools/predict-providers.js --date 2026-09-29 --provider apiFootball,footballPrediction
     node tools/predict-providers.js --date 2026-09-29 --no-cache

   内置 Provider：
     sporttery          官方快照内「今日预测」模型推荐（基线，无需密钥，离线可用）
     apiFootball        API-Football /v3/predictions（免费 100 次/天）
     footballPrediction boggio Football Prediction API（免费 50 次/天，自带命中率统计端点）
     apifyForebet       Forebet 1X2 概率（经 Apify Actor 抓取，按量计费）
   ========================================================================== */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var CACHE_DIR = path.join(ROOT, 'api', 'cache', 'predictions');
var SNAPSHOT = path.join(ROOT, 'api', 'snapshot.json');
var DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;   // 缓存 6 小时
var RETRIES = 3;
var TIMEOUT_MS = 15000;

/* ----------------------------- 密钥配置 ----------------------------- */
function loadKeys() {
  var keys = {};
  ['JX_KEY_APIFOOTBALL|apiFootball', 'JX_KEY_RAPIDAPI|rapidApi', 'JX_KEY_APIFY|apify']
    .forEach(function (pair) {
      var p = pair.split('|');
      if (process.env[p[0]]) keys[p[1]] = process.env[p[0]].trim();
    });
  try {
    var f = path.join(process.env.HOME || '', '.jingxi-predict-keys.json');
    if (fs.existsSync(f)) {
      var o = JSON.parse(fs.readFileSync(f, 'utf8'));
      Object.keys(o).forEach(function (k) { if (!keys[k] && o[k]) keys[k] = String(o[k]).trim(); });
    }
  } catch (e) { /* 配置文件缺失/坏格式不致命 */ }
  return keys;
}

/* --------------------------- HTTP + 重试封装 --------------------------- */
function fetchWithRetry(url, opts, cfg, log) {
  opts = opts || {};
  cfg = cfg || {};
  var retries = cfg.retries != null ? cfg.retries : RETRIES;
  var timeoutMs = cfg.timeoutMs || TIMEOUT_MS;
  var attempt = 0;

  function once() {
    var f = cfg.fetchImpl || fetch;          // fetchImpl 可注入（测试用）
    return new Promise(function (resolve, reject) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); reject(new Error('timeout ' + timeoutMs + 'ms')); }, timeoutMs);
      f(url, Object.assign({}, opts, { signal: ctrl.signal }))
        .then(function (r) { clearTimeout(timer); resolve(r); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  return once().catch(function (err) { return Promise.reject(err); })
    .then(function (r) {
      // 429 / 5xx 退避重试；其余状态直接返回
      if ((r.status === 429 || r.status >= 500) && attempt < retries) {
        var delay = Math.min(30000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 400);
        attempt++;
        if (log) log('HTTP ' + r.status + '，' + delay + 'ms 后重试（' + attempt + '/' + retries + '）');
        return new Promise(function (res) { setTimeout(res, delay); }).then(function () {
          return fetchWithRetry(url, opts, {
            retries: retries - attempt, timeoutMs: timeoutMs, fetchImpl: cfg.fetchImpl
          }, log);
        });
      }
      return r;
    });
}

function fetchJson(url, headers, cfg, log) {
  return fetchWithRetry(url, { headers: headers || {} }, cfg, log).then(function (r) {
    return r.text().then(function (t) {
      if (!r.ok) {
        var e = new Error('HTTP ' + r.status + ': ' + t.slice(0, 200));
        e.status = r.status;
        throw e;
      }
      try { return JSON.parse(t); } catch (err) { throw new Error('响应非 JSON: ' + t.slice(0, 120)); }
    });
  });
}

/* ------------------------------- 缓存 ------------------------------- */
function cachePath(provider, date) {
  return path.join(CACHE_DIR, provider, date + '.json');
}
function readCache(provider, date, ttl) {
  var f = cachePath(provider, date);
  try {
    var st = fs.statSync(f);
    if (Date.now() - st.mtimeMs > (ttl || DEFAULT_TTL_MS)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { return null; }
}
function writeCache(provider, date, recs) {
  var f = cachePath(provider, date);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(recs, null, 1));
}

/* --------------------------- 队名归一化对齐 --------------------------- */
var NAME_MAP = {  // 常见英超球队英文别名 → 规范名（可按需扩展中日韩/中文别名）
  'manchester united': 'man utd', 'man utd': 'man utd', 'manchester city': 'man city',
  'tottenham hotspur': 'tottenham', 'newcastle united': 'newcastle',
  'wolverhampton': 'wolves', 'nottingham forest': 'forest', 'brighton & hove albion': 'brighton',
  'west ham united': 'west ham', 'leeds united': 'leeds', 'afc bournemouth': 'bournemouth'
};
function normTeam(s) {
  var t = String(s || '').toLowerCase().replace(/[（）()0-9\u4e00-\u9fa5·]/g, ' ')
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(fc|ac|as|sc|afc|cf)\s+/, '').replace(/\s+(fc|ac|as|sc|afc|cf)$/, '');
  return NAME_MAP[t] || t;
}
function matchKey(date, home, away) {
  return date + '|' + normTeam(home) + '+' + normTeam(away);
}
function probPick(p) {
  var best = 'h';
  if (p.d > p[best]) best = 'd';
  if (p.a > p[best]) best = 'a';
  return best;
}
function rec(provider, date, home, away, probs, odds) {
  var s = probs.h + probs.d + probs.a;
  if (!(s > 0)) return null;                    // 无有效概率不产出
  probs = { h: probs.h / s, d: probs.d / s, a: probs.a / s };
  return {
    provider: provider, date: date, matchKey: matchKey(date, home, away),
    home: String(home), away: String(away), market: 'had',
    probs: probs, pick: probPick(probs), odds: odds || null,
    fetchedAt: new Date().toISOString()
  };
}

/* ----------------------------- Provider 实现 ----------------------------- */
/* 每个实现：{ name, needsKey, dateURL(date), parse(json) → recs }；
   fetchImpl 可注入（测试用），默认 fetchWithRetry+fetchJson。 */

var PROVIDERS = {

  /* 基线：官方竞彩 SP 隐含概率（1/SP 去水归一化）。
     这是「市场共识」基线——任何外部预测源先跟它比，跑不赢 SP 就没有接入价值。
     读快照 payload.value.matchInfoList[].subMatchList[] 的 had 盘口（无 had 的场次跳过）。 */
  sportterySP: {
    name: 'sportterySP', needsKey: false, offline: true,
    fetch: function (date) {
      var snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
      var days = (snap.payload && snap.payload.value && snap.payload.value.matchInfoList) || [];
      var out = [];
      days.forEach(function (day) {
        (day.subMatchList || []).forEach(function (m) {
          var d = m.businessDate || day.businessDate || '';
          if (d !== date) return;
          var had = m.had || {};
          if (!(+had.h > 1) || !(+had.d > 1) || !(+had.a > 1)) return;   // 无胜平负盘（部分女足/杯赛）
          var r = rec('sportterySP', d, m.homeTeamAbbName, m.awayTeamAbbName,
            { h: 1 / +had.h, d: 1 / +had.d, a: 1 / +had.a }, { h: +had.h, d: +had.d, a: +had.a });
          if (r) { r.matchKey = d + '|' + m.matchNumStr; out.push(r); }   // 官方场次号做 key 最稳
        });
      });
      return Promise.resolve(out);
    }
  },

  /* API-Football：GET /predictions?date=…，probs 在 predictions.percent（"Home 45%"） */
  apiFootball: {
    name: 'apiFootball', needsKey: 'apiFootball',
    headers: function (k) { return { 'x-apisports-key': k }; },
    url: function (date) { return 'https://v3.football.api-sports.io/predictions?date=' + date; },
    parse: function (json, date) {
      var out = [];
      (json.response || []).forEach(function (item) {
        var pc = item.predictions && item.predictions.percent;
        if (!pc) return;
        var num = function (s) { return parseFloat(String(s).replace(/[^0-9.]/g, '')) || 0; };
        var probs = { h: num(pc.home), d: num(pc.draw), a: num(pc.away) };
        var h = (item.teams && item.teams.home && item.teams.home.name) || '';
        var a = (item.teams && item.teams.away && item.teams.away.name) || '';
        var r = rec('apiFootball', date, h, a, probs, null);
        if (r) out.push(r);
      });
      return out;
    },
    fetch: function (date, keys, cfg, log) {
      var self = this;
      return fetchJson(self.url(date), self.headers(keys.apiFootball), cfg, log)
        .then(function (json) { return self.parse(json, date); });
    }
  },

  /* boggio Football Prediction API（RapidAPI）：classic = 1X2；odds 为平均赔率→隐含概率 */
  footballPrediction: {
    name: 'footballPrediction', needsKey: 'rapidApi',
    headers: function (k) { return { 'X-RapidAPI-Key': k, 'X-RapidAPI-Host': 'football-prediction-api.p.rapidapi.com' }; },
    url: function (date) { return 'https://football-prediction-api.p.rapidapi.com/api/v2/predictions?iso_date=' + date + '&market=classic'; },
    parse: function (json, date) {
      var out = [];
      (json.data || []).forEach(function (m) {
        var probs;
        if (m.probs) {
          probs = { h: +m.probs['1'] || 0, d: +m.probs['X'] || 0, a: +m.probs['2'] || 0 };
        } else if (m.odds) {   // 平均赔率 → 隐含概率
          probs = {
            h: m.odds.home ? 1 / m.odds.home : 0,
            d: m.odds.draw ? 1 / m.odds.draw : 0,
            a: m.odds.away ? 1 / m.odds.away : 0
          };
        }
        if (!probs) return;
        var r = rec('footballPrediction', date, m.home_team, m.away_team, probs, m.odds);
        if (r) out.push(r);
      });
      return out;
    },
    fetch: function (date, keys, cfg, log) {
      var self = this;
      return fetchJson(self.url(date), self.headers(keys.rapidApi), cfg, log)
        .then(function (json) { return self.parse(json, date); });
    }
  },

  /* Forebet（经 Apify Actor 抓取）：按量计费，tolerant 解析 1X2 概率字段 */
  apifyForebet: {
    name: 'apifyForebet', needsKey: 'apify',
    actorUrl: function (date, token) {
      var input = encodeURIComponent(JSON.stringify({ urls: ['https://www.forebet.com/en/football-predictions/' + date] }));
      return 'https://api.apify.com/v2/actors/solidcode~forebet-scraper/run-sync-get-dataset-items?token=' + token +
        '&input=' + input + '&method=POST';
    },
    parse: function (items, date) {
      var out = [];
      (Array.isArray(items) ? items : []).forEach(function (m) {
        var h = m.home || m.homeTeam || m.home_team;
        var a = m.away || m.awayTeam || m.away_team;
        var p1 = +m['1'] || +m.home_win_percentage || +m.prob1 || 0;
        var px = +m.X || +m.draw_percentage || +m.probX || 0;
        var p2 = +m['2'] || +m.away_win_percentage || +m.prob2 || 0;
        if (!h || !a || !(p1 + px + p2 > 0)) return;
        var r = rec('apifyForebet', date, h, a, { h: p1, d: px, a: p2 }, m.odds ? { h: +m.odds['1'], d: +m.odds.X, a: +m.odds['2'] } : null);
        if (r) out.push(r);
      });
      return out;
    },
    fetch: function (date, keys, cfg, log) {
      var self = this;
      return fetchJson(self.actorUrl(date, keys.apify), { 'Content-Type': 'application/json' }, cfg, log)
        .then(function (items) { return self.parse(items, date); });
    }
  },

  /* mock：测试用，fixture 由 cfg.fixtures['mock'][date] 提供 */
  mock: {
    name: 'mock', needsKey: false, offline: true,
    fetch: function (date, keys, cfg) {
      return Promise.resolve(((cfg && cfg.fixtures && cfg.fixtures.mock && cfg.fixtures.mock[date]) || []).map(function (x) {
        return rec('mock', date, x.home, x.away, x.probs, x.odds);
      }).filter(Boolean));
    }
  }
};

/* ------------------------------ 调度入口 ------------------------------ */
function fetchDay(date, opts) {
  opts = opts || {};
  var keys = loadKeys();
  var names = opts.providers || Object.keys(PROVIDERS).filter(function (n) { return n !== 'mock'; });
  var cfg = { retries: opts.retries, timeoutMs: opts.timeoutMs, fixtures: opts.fixtures,
              fetchImpl: opts.fetchImpl, log: opts.log };

  return Promise.all(names.map(function (name) {
    var p = PROVIDERS[name];
    if (!p) return Promise.resolve({ provider: name, error: '未知 provider' });
    if (p.needsKey && !keys[p.needsKey] && !opts.fetchImpl) {
      return Promise.resolve({ provider: name, error: '缺少密钥 ' + p.needsKey + '（环境变量或 ~/.jingxi-predict-keys.json）' });
    }
    if (!opts.noCache && !opts.fetchImpl) {
      var hit = readCache(name, date, opts.ttl);
      if (hit) return Promise.resolve({ provider: name, cached: true, recs: hit });
    }
    var impl = cfg.fetchImpl
      ? p.fetch(date, keys, cfg).catch(function (e) { throw e; })
      : p.fetch(date, keys, cfg);
    return impl.then(function (recs) {
      recs = recs.filter(Boolean);
      if (!opts.noCache && !opts.fetchImpl) writeCache(name, date, recs);
      return { provider: name, cached: false, recs: recs };
    }).catch(function (e) {
      return { provider: name, error: String(e && e.message || e) };
    });
  }));
}

module.exports = {
  PROVIDERS: PROVIDERS, loadKeys: loadKeys, fetchDay: fetchDay,
  fetchJson: fetchJson, fetchWithRetry: fetchWithRetry,
  normTeam: normTeam, matchKey: matchKey, probPick: probPick, rec: rec,
  readCache: readCache, writeCache: writeCache, cachePath: cachePath,
  _paths: { CACHE_DIR: CACHE_DIR, SNAPSHOT: SNAPSHOT }
};

/* ------------------------------- CLI ------------------------------- */
if (require.main === module) {
  var argv = process.argv.slice(2);
  function argOf(flag) {
    var i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  }
  var date = argOf('--date') || new Date().toISOString().slice(0, 10);
  var prov = argOf('--provider');
  var noCache = argv.indexOf('--no-cache') >= 0;
  fetchDay(date, {
    noCache: noCache,
    providers: prov ? prov.split(',').map(function (s) { return s.trim(); }) : null,
    log: function (msg) { process.stderr.write('[' + date + '] ' + msg + '\n'); }
  }).then(function (results) {
    results.forEach(function (r) {
      if (r.error) console.log('✘ ' + r.provider + ': ' + r.error);
      else console.log('✓ ' + r.provider + (r.cached ? '（缓存）' : '') + ': ' + r.recs.length + ' 场 → ' + cachePath(r.provider, date));
    });
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}

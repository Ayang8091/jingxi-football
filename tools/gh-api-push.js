#!/usr/bin/env node
'use strict';
/*
 * 通过 GitHub REST API 把本地提交推送到远程分支。
 *
 * 为什么需要它：本机 git 的 HTTPS 通道会被网络代理间歇性阻断
 * （fatal: unable to access ...: CONNECT tunnel failed, response 502 /
 *   Empty reply from server），而 curl / fetch 正常。
 *
 * 用法：
 *   GH_TOKEN=<token> node tools/gh-api-push.js [--base <远程分支SHA>] [--diff-base <本地基线SHA>] [--branch main]
 *
 * 说明：
 *   - --base：远程分支当前 HEAD 的 SHA（新提交的父提交）。省略时脚本自己查一次。
 *   - --diff-base：本地用来推导改动清单的基线，默认与 --base 相同。
 *     若 --base 指向的提交在本地不存在（上次也是走 API 推的），显式给一个本地等价的提交，
 *     例如 `--diff-base <本地HEAD的父提交>`，脚本会把同一批改动重放到远程当前 tree 上。
 *   - 脚本会用 `git diff --name-status <diff-base> HEAD` 推导要上传/删除的文件。
 *   - 走 API 建提交时 GitHub 会把提交时区规范化为 UTC，生成的 commit SHA 与本地不一致
 *     （内容相同）。推送后脚本会打印对齐本地分支的命令，避免下次推送被判非快进。
 *   - 只处理普通文件（mode 100644），二进制同样可用（base64 上传）。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = process.env.GH_REPO || 'Ayang8091/jingxi-football';
const TOKEN = process.env.GH_TOKEN;
const API = 'https://api.github.com';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

const BRANCH = arg('branch', 'main');
let BASE = arg('base', '');
/* 本地用于推导改动清单的基线。默认同 BASE；若 BASE（远程 SHA）在本地不存在
   （例如上一次是走 API 推的、本地没有那个对象），可显式指定一个本地已知的等价提交。 */
const DIFF_BASE = arg('diff-base', '');

if (!TOKEN) { console.error('缺少 GH_TOKEN 环境变量'); process.exit(1); }

const H = {
  Authorization: 'Bearer ' + TOKEN,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'jingxi-deploy',
  'Content-Type': 'application/json'
};

async function call(method, url, body) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(API + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      if (!r.ok) {
        if (r.status >= 500 && i < 3) { await sleep(1500); continue; }
        throw new Error(method + ' ' + url + ' -> ' + r.status + ' ' + t.slice(0, 300));
      }
      return t ? JSON.parse(t) : null;
    } catch (e) {
      lastErr = e;
      if (i === 3) throw e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

const sleep = ms => new Promise(s => setTimeout(s, ms));

(async () => {
  if (!BASE) {
    const ref = await call('GET', `/repos/${REPO}/git/ref/heads/${BRANCH}`);
    BASE = ref.object.sha;
    console.log('远程 ' + BRANCH + ' 当前 HEAD:', BASE.slice(0, 7));
  }

  const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (BASE === localHead) { console.log('远程已与本地一致，无需推送'); return; }

  const diff = execFileSync('git', ['diff', '--name-status', DIFF_BASE || BASE, 'HEAD'], { encoding: 'utf8' }).trim();
  if (!diff) { console.log('本地与远程基线无差异'); return; }

  const changes = diff.split('\n').map(line => {
    const [st, ...rest] = line.split('\t');
    return { path: rest[rest.length - 1], deleted: st === 'D' };
  });

  const parent = await call('GET', `/repos/${REPO}/git/commits/${BASE}`);
  const entries = [];
  for (const c of changes) {
    if (c.deleted) {
      entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null });
      console.log('删除', c.path);
      continue;
    }
    const buf = fs.readFileSync(path.resolve(c.path));
    const blob = await call('POST', `/repos/${REPO}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    entries.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('上传', c.path, buf.length + 'B');
  }

  const tree = await call('POST', `/repos/${REPO}/git/trees`, { base_tree: parent.tree.sha, tree: entries });
  const message = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim();
  const commit = await call('POST', `/repos/${REPO}/git/commits`, {
    message: message + '\n', tree: tree.sha, parents: [BASE]
  });
  await call('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });

  console.log('推送成功，远程新提交:', commit.sha);
  if (commit.sha !== localHead) {
    console.log('\n注意：远程 SHA 与本地不同（GitHub 把提交时区规范化为 UTC，内容一致）。');
    console.log('把本地分支对齐到同一提交对象，避免下次推送被判非快进：');
    console.log('  git cat-file commit HEAD | sed \'s/ [+-][0-9]\\{4\\}$/ +0000/\' | git hash-object -t commit -w --stdin');
    console.log('  git update-ref refs/heads/' + BRANCH + ' <上一步输出的 SHA>');
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });

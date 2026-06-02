#!/usr/bin/env node
// scripts/release.mjs — 一键发布 Obsidian 插件到 GitHub Release
// 用法: npm run release -- <major|minor|patch|x.y.z>
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readJSON = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const writeJSON = (p, o) =>
  writeFileSync(resolve(root, p), JSON.stringify(o, null, 2) + '\n');

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const gitSafe = (...args) => {
  try {
    return git(...args);
  } catch {
    return '';
  }
};


// ── 1. 计算下一个版本号 ──────────────────────────
function bumpVersion(current, arg) {
  if (!arg) fail('请指定版本: npm run release -- <major|minor|patch|x.y.z>');
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg;
  const [maj, min, pat] = current.split('.').map(Number);
  if (arg === 'major') return `${maj + 1}.0.0`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  if (arg === 'patch') return `${maj}.${min}.${pat + 1}`;
  fail(`无法识别的版本参数: ${arg}`);
}

const pkg = readJSON('package.json');
const manifest = readJSON('manifest.json');
const arg = process.argv[2];
const version = bumpVersion(pkg.version, arg);
const tag = `v${version}`;

console.log(`\n▶ 发布 ${tag}  (当前 ${pkg.version})`);

// 干净工作区检查:只拦已跟踪文件的未提交修改;
// 忽略未跟踪文件(??)和将由本脚本改写的版本文件
const dirty = gitSafe('status', '--porcelain')
  .split('\n')
  .filter(Boolean)
  .filter((l) => !l.startsWith('??'))
  .filter((l) => !/(package\.json|manifest\.json|versions\.json|main\.js)$/.test(l));
if (dirty.length) {
  fail(`工作区有未提交的无关改动,请先处理:\n${dirty.join('\n')}`);
}

// tag 不能重复
if (gitSafe('tag', '-l', tag) === tag) fail(`tag ${tag} 已存在`);

// ── 2. 写版本号到三个文件 ────────────────────────
pkg.version = version;
manifest.version = version;
writeJSON('package.json', pkg);
writeJSON('manifest.json', manifest);

const versions = readJSON('versions.json');
versions[version] = manifest.minAppVersion;
writeJSON('versions.json', versions);
console.log(`  ✓ 版本号已写入 package.json / manifest.json / versions.json`);

// ── 3. 生产构建 ──────────────────────────────────
console.log('  • 构建中…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });


// ── 4. 提交、打 tag、推送 ────────────────────────
// 生成发布说明:上个 tag 至今的提交
const prevTag = gitSafe('describe', '--tags', '--abbrev=0');
const range = prevTag ? `${prevTag}..HEAD` : '';
const log = gitSafe('log', '--pretty=format:- %s', ...(range ? [range] : []))
  .split('\n')
  .filter((l) => l && !/^- (chore|release):/i.test(l))
  .join('\n');
const body = `## ${tag}\n\n${log || '- 维护性更新'}`;

git('add', 'package.json', 'manifest.json', 'versions.json');
const commitMsg = `release: ${tag}\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`;
git('commit', '-m', commitMsg);
git('tag', '-a', tag, '-m', `Release ${tag}`);
console.log(`  ✓ 已提交并打 tag ${tag}`);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
git('push', 'origin', branch);
git('push', 'origin', tag);
console.log(`  ✓ 已推送 ${branch} 和 ${tag}`);

// ── 5. 取 GitHub token(优先环境变量,回退到 git 凭据管理器)──
function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      cwd: root,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
    const m = out.match(/^password=(.*)$/m);
    if (m) return m[1].trim();
  } catch {}
  fail('无法获取 GitHub token(尝试设置 GH_TOKEN 环境变量)');
}

// 从 origin 解析 owner/repo
const originUrl = git('remote', 'get-url', 'origin');
const repoMatch = originUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
if (!repoMatch) fail(`无法从 origin 解析仓库: ${originUrl}`);
const repo = repoMatch[1];


// ── 6. 创建 Release 并上传附件 ───────────────────
const token = getToken();
const api = `https://api.github.com/repos/${repo}`;
const ghHeaders = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

console.log('  • 创建 GitHub Release…');
const relResp = await fetch(`${api}/releases`, {
  method: 'POST',
  headers: { ...ghHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tag_name: tag,
    name: tag,
    body,
    draft: false,
    prerelease: false,
  }),
});
if (!relResp.ok) {
  fail(`创建 Release 失败 (HTTP ${relResp.status}): ${await relResp.text()}`);
}
const release = await relResp.json();
console.log(`  ✓ Release 已创建: ${release.html_url}`);

// 上传附件
const assets = [
  ['main.js', 'application/javascript'],
  ['manifest.json', 'application/json'],
  ['styles.css', 'text/css'],
  ['versions.json', 'application/json'],
];
const uploadBase = release.upload_url.replace(/\{.*$/, '');
for (const [name, contentType] of assets) {
  const data = readFileSync(resolve(root, name));
  const up = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...ghHeaders, 'Content-Type': contentType },
    body: data,
  });
  if (!up.ok) fail(`上传 ${name} 失败 (HTTP ${up.status}): ${await up.text()}`);
  console.log(`    ✓ ${name}`);
}

console.log(`\n✅ 发布完成 → ${release.html_url}\n`);




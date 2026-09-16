#!/usr/bin/env node
/**
 * dashboard.mjs — 生成 dsh-auto-translate 状态仪表盘（dashboard.html）
 *
 * 为什么用 Node 而不是 PowerShell：Windows PowerShell 5.1 读无 BOM 的 UTF-8 脚本时
 * 按 GBK 解释，中文字符串字面量会被撕成非法 token 导致整脚本解析失败。Node 恒定按
 * UTF-8 读取，中文安全。
 *
 * 用法：
 *   node scripts/dashboard.mjs            # 生成 dashboard.html
 *   node scripts/dashboard.mjs --open     # 生成并打开
 *   node scripts/dashboard.mjs --out x.html
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const NAME = pkg.name;
const VERSION = pkg.version;
const REPO = 'https://gitee.com/nysjn/dsh-auto-translate';

const argv = process.argv.slice(2);
const openAfter = argv.includes('--open');
const outIdx = argv.indexOf('--out');
const outFile = outIdx >= 0 && argv[outIdx + 1] ? resolve(argv[outIdx + 1]) : join(root, 'dashboard.html');

/** 跑一条命令，失败返回空串（仪表盘不该因为网络/凭据问题整体失败） */
function tryRun(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
  } catch { return ''; }
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 本地 git ----------
const head = tryRun('git', ['rev-parse', '--short', 'HEAD']);
const branch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const lastMsg = tryRun('git', ['log', '-1', '--format=%s']);
const lastTime = tryRun('git', ['log', '-1', '--format=%ad', '--date=format:%Y-%m-%d %H:%M']);
const dirtyFiles = tryRun('git', ['status', '--porcelain']).split('\n').filter(Boolean);

// ---------- npm registry ----------
// 用 execSync(单命令字符串)：Windows 上 .cmd 批处理必须经 shell 才能执行，而
// shell + args 组合在 Node 22+ 会触发 DEP0190，所以走字符串形式。
let npm = null;
let npmSkip = '';
try {
  const raw = execSync(`npm view ${NAME} --json`, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (raw.trim().startsWith('{')) npm = JSON.parse(raw);
  else npmSkip = 'npm view 返回了非 JSON 内容';
} catch (e) {
  npmSkip = e.status ? `npm view 退出码 ${e.status}` : e.message;
}

// ---------- 指标：npm 下载量 + Gitee 收藏 ----------
// 说明：npm / Gitee 都不提供「包页浏览量」；能反映使用量的是 npm 下载量（新包当天无数据，
// 官方 downloads API 会 404）与 Gitee 的 star/fork/watch。全部走公开接口，无凭据。
async function getJson(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'dsh-auto-translate-dashboard' } });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { json: await r.json() };
  } catch (e) {
    return { error: e.name === 'AbortError' ? '超时' : e.message };
  } finally { clearTimeout(timer); }
}

const dlWeek = await getJson(`https://api.npmjs.org/downloads/point/last-week/${NAME}`);
const dlMonth = await getJson(`https://api.npmjs.org/downloads/point/last-month/${NAME}`);
const dlRange = await getJson(`https://api.npmjs.org/downloads/range/last-month/${NAME}`);
const gitee = await getJson('https://gitee.com/api/v5/repos/nysjn/dsh-auto-translate');

const dlHasData = Boolean(dlWeek.json || dlMonth.json);
const metrics = {
  week: dlWeek.json?.downloads ?? null,
  month: dlMonth.json?.downloads ?? null,
  days: Array.isArray(dlRange.json?.downloads) ? dlRange.json.downloads : [],
  dlNote: dlHasData ? '' : `下载统计尚无数据（${dlWeek.error ?? '未返回'}）—— npm 对新发布的包延迟约一天开始计数`,
  star: gitee.json?.stargazers_count ?? null,
  fork: gitee.json?.forks_count ?? null,
  watch: gitee.json?.watchers_count ?? null,
  issue: gitee.json?.open_issues_count ?? null,
  giteeNote: gitee.json ? '' : `Gitee 指标查询失败（${gitee.error}）`,
};

// ---------- 本地 tgz ----------
let tgz = null;
try {
  const f = readdirSync(root).filter((n) => n.endsWith('.tgz'))[0];
  if (f) tgz = { name: f, size: (statSync(join(root, f)).size / 1024).toFixed(1) };
} catch { }

// ---------- 组装 ----------
const generated = new Date().toLocaleString('zh-CN', { hour12: false });
const npmOk = Boolean(npm);
const npmVersion = npmOk ? npm.version : VERSION;
const npmNote = npmOk
  ? `sha ${String(npm.dist.shasum).slice(0, 10)} · ${npm.dist.fileCount} 个文件 · ${(npm.dist.unpackedSize / 1024).toFixed(1)} KB`
  : 'registry 查询失败，未包含线上信息';
const publishedAt = npmOk ? new Date(npm.time.modified).toLocaleString('zh-CN', { hour12: false }) : '—';
const dirtyHtml = dirtyFiles.length === 0
  ? '<span class="ok">clean</span>'
  : `<span class="warn">${dirtyFiles.length} 个未提交改动</span>`;

const installCmds = [
  ['npm（推荐）', `dsh plugin --profile web add ${NAME}`, '最长可用、命令最短'],
  ['Gitee（锁定版本）', `dsh plugin --profile web add 'git+${REPO}.git#${head}'`, `固定到提交 ${head}`],
  ['本地 tgz', `dsh plugin --profile web add <路径>/${tgz ? tgz.name : `${NAME}-${VERSION}.tgz`}`, '零账号，直接发文件'],
];

const links = [
  ['npm 包页', `https://www.npmjs.com/package/${NAME}`],
  ['npm 下载趋势图', `https://www.npmjs.com/package/${NAME}?activeTab=explore`],
  ['npm tarball', `https://registry.npmjs.org/${NAME}/-/${NAME}-${VERSION}.tgz`],
  ['Gitee 仓库', REPO],
  ['Gitee 本次提交', `${REPO}/commit/${head}`],
  ['Gitee 访问/克隆统计', `${REPO}/traffic`],
  ['npm 令牌管理', 'https://www.npmjs.com/settings/nysjn/tokens'],
];

// ---- 指标区块 ----
const fnum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN'));
const maxDay = metrics.days.reduce((m, d) => Math.max(m, d.downloads || 0), 0);
const sparkRows = metrics.days.slice(-14).map((d) => {
  const w = maxDay === 0 ? 0 : Math.round(((d.downloads || 0) / maxDay) * 160);
  return `<div class="spark"><span class="day">${esc(String(d.day).slice(5))}</span>` +
         `<span class="bar" style="width:${w}px"></span><span class="num">${fnum(d.downloads)}</span></div>`;
}).join('');

const metricsSection = `
  <h2>使用量指标</h2>
  <div class="grid">
    <div class="tile"><div class="lbl">npm 近一周下载</div>
      <div class="val">${fnum(metrics.week)}</div>
      <div class="note">官方 downloads API</div></div>
    <div class="tile"><div class="lbl">npm 近一月下载</div>
      <div class="val">${fnum(metrics.month)}</div>
      <div class="note">按天累加</div></div>
    <div class="tile"><div class="lbl">Gitee 收藏 / 派生</div>
      <div class="val">${fnum(metrics.star)} / ${fnum(metrics.fork)}</div>
      <div class="note">关注 ${fnum(metrics.watch)} · 开放 issue ${fnum(metrics.issue)}</div></div>
    <div class="tile"><div class="lbl">包页浏览量</div>
      <div class="val"><span class="dimval">不提供</span></div>
      <div class="note">npm 与 Gitee 均无公开 PV 指标</div></div>
  </div>
  ${metrics.dlNote ? `<div class="note-lg">⏳ ${esc(metrics.dlNote)}</div>` : ''}
  ${metrics.giteeNote ? `<div class="note-lg">⚠️ ${esc(metrics.giteeNote)}</div>` : ''}
  ${sparkRows ? `<div class="sparkbox"><div class="sparktitle">npm 近 14 天每日下载</div>${sparkRows}</div>` : ''}
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${NAME} — 状态仪表盘</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--line:#30363d;--fg:#e6edf3;--dim:#8b949e;
        --acc:#58a6ff;--ok:#3fb950;--warn:#d29922;--bad:#f85149;}
  *{box-sizing:border-box}
  body{margin:0;padding:30px;background:var(--bg);color:var(--fg);
       font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}
  h1{font-size:26px;margin:0 0 4px}
  h1 small{font-size:14px;color:var(--dim);font-weight:400;margin-left:10px}
  .sub{color:var(--dim);margin-bottom:20px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);
     margin:30px 0 12px;font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:15px 17px}
  .tile .lbl{font-size:12px;color:var(--dim)}
  .tile .val{font-size:20px;margin-top:5px;word-break:break-all}
  .tile .note{font-size:12px;color:var(--dim);margin-top:4px}
  .ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
  table{width:100%;border-collapse:collapse;background:var(--card);
        border:1px solid var(--line);border-radius:10px;overflow:hidden}
  td{padding:10px 15px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:none}
  td:first-child{color:var(--dim);width:160px;white-space:nowrap}
  code{background:#21262d;padding:2px 7px;border-radius:5px;font-size:13px;
       font-family:ui-monospace,Consolas,monospace}
  .cmd{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--acc);
       border-radius:8px;padding:12px 15px;margin:9px 0;display:flex;
       justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}
  .cmd code{background:transparent;padding:0}
  .cmd .tag{font-size:12px;color:var(--dim);min-width:130px}
  .cmd .hint{font-size:12px;color:var(--dim);flex:1;min-width:150px}
  button{background:#21262d;color:var(--fg);border:1px solid var(--line);border-radius:7px;
         padding:6px 13px;cursor:pointer;font-size:13px}
  button:hover{border-color:var(--acc);color:var(--acc)}
  a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
  .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 0}
  footer{color:var(--dim);font-size:12px;margin-top:34px;border-top:1px solid var(--line);padding-top:15px}
  .dimval{color:var(--dim)}
  .note-lg{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--warn);
           border-radius:8px;padding:10px 14px;margin:10px 0;font-size:13px;color:var(--warn)}
  .sparkbox{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-top:12px}
  .sparktitle{font-size:12px;color:var(--dim);margin-bottom:8px}
  .spark{display:flex;align-items:center;gap:10px;line-height:1.5}
  .spark .day{width:52px;color:var(--dim);font-size:12px;font-family:ui-monospace,Consolas,monospace}
  .spark .bar{height:12px;background:var(--acc);border-radius:3px;min-width:1px;opacity:.75}
  .spark .num{font-size:12px;color:var(--dim)}
</style>
</head>
<body>
  <h1>${NAME} <small>v${VERSION}</small></h1>
  <div class="sub">状态仪表盘 · 快照生成于 ${generated}</div>
  <div class="bar">
    <button onclick="refresh()">实时拉取 npm / Gitee</button>
    <button onclick="location.reload()">重新载入本页</button>
    <span id="live" class="sub" style="margin:0">当前显示的是生成本页时的快照</span>
  </div>

  <h2>核心状态</h2>
  <div class="grid">
    <div class="tile"><div class="lbl">npm 线上版本</div>
      <div class="val" id="npmver">${npmOk ? 'v' + esc(npmVersion) : '—'}</div>
      <div class="note" id="npmnote">${esc(npmNote)}</div></div>
    <div class="tile"><div class="lbl">发布状态</div>
      <div class="val">${npmOk ? '<span class="ok">已发布</span>' : '<span class="bad">查询失败</span>'}</div>
      <div class="note">${npmOk ? '发布于 ' + esc(publishedAt) : '—'}</div></div>
    <div class="tile"><div class="lbl">Gitee main</div>
      <div class="val"><code>${esc(head)}</code></div>
      <div class="note">分支 ${esc(branch)} · 与本地快照一致</div></div>
    <div class="tile"><div class="lbl">本地工作区</div>
      <div class="val">${dirtyHtml}</div>
      <div class="note">${tgz ? 'tgz 已打包 ' + esc(tgz.size) + ' KB' : '尚未打包'}</div></div>
  </div>

  ${metricsSection}
  <h2>别人的安装命令</h2>
  ${installCmds.map(([tag, cmd, hint]) => `
  <div class="cmd"><span class="tag">${esc(tag)}</span>
    <code>${esc(cmd)}</code><span class="hint">${esc(hint)}</span>
    <button onclick="copyit(this, ${JSON.stringify(cmd)})">复制</button></div>`).join('')}

  <h2>快捷链接</h2>
  <table>${links.map(([k, u]) => `<tr><td>${esc(k)}</td><td><a href="${esc(u)}" target="_blank">${esc(u)}</a></td></tr>`).join('')}</table>

  <h2>本次快照明细</h2>
  <table>
    <tr><td>分支 / 提交</td><td><code>${esc(branch)}</code> · <code>${esc(head)}</code></td></tr>
    <tr><td>最近提交</td><td>${esc(lastMsg)}</td></tr>
    <tr><td>提交时间</td><td>${esc(lastTime)}</td></tr>
    <tr><td>工作区</td><td>${dirtyHtml}</td></tr>
    <tr><td>本地 tgz</td><td>${tgz ? esc(tgz.name) + ' · ' + esc(tgz.size) + ' KB' : '未打包（可跑 npm pack）'}</td></tr>
    <tr><td>dsh bundle</td><td><code>${esc(pkg.dsh?.bundle?.patch ?? '(无)')}</code></td></tr>
  </table>

  <footer>
    安装后需<b>重启 dsh web</b>，再刷新浏览器；左下角出现半透明「译」圆点即成功。<br>
    包内不含 74MB 的 ONNX Runtime wasm（首次使用时由宿主端从 CDN 取回并缓存）；要完全离线，先跑 <code>npm run fetch-vendor</code> 再打包。<br>
    本页由 <code>node scripts/dashboard.mjs</code> 生成；点上面的「实时拉取」可在浏览器里直接查线上最新版本。
  </footer>

<script>
function copyit(btn, text){
  navigator.clipboard.writeText(text).then(()=>{
    const old = btn.textContent; btn.textContent = '已复制';
    setTimeout(()=>{ btn.textContent = old; }, 1200);
  });
}
async function refresh(){
  const el = document.getElementById('live');
  el.textContent = '正在拉取…';
  const parts = [];
  try {
    const r = await fetch('https://registry.npmjs.org/${NAME}', {cache:'no-store'});
    if (r.ok) {
      const j = await r.json();
      const latest = j['dist-tags'].latest;
      document.getElementById('npmver').textContent = 'v' + latest;
      document.getElementById('npmnote').textContent =
        'sha ' + String(j.versions[latest].dist.shasum).slice(0,10) +
        ' · ' + new Date(j.time[latest]).toLocaleString('zh-CN', {hour12:false});
      parts.push('npm 正常（最新 v' + latest + '）');
    } else parts.push('npm HTTP ' + r.status);
  } catch (e) { parts.push('npm 拉取失败：' + e.message); }
  try {
    const g = await fetch('${REPO}/raw/main/package.json', {cache:'no-store'});
    if (g.ok) { const gp = await g.json(); parts.push('Gitee 正常（package.json v' + gp.version + '）'); }
    else parts.push('Gitee HTTP ' + g.status);
  } catch (e) { parts.push('Gitee 拉取失败：' + e.message); }
  el.textContent = parts.join('　|　') + '　（刷新于 ' + new Date().toLocaleTimeString('zh-CN') + '）';
}
</script>
</body>
</html>
`;

writeFileSync(outFile, html, 'utf8');
console.log(`仪表盘已生成: ${outFile}`);
console.log(`  大小  : ${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB`);
console.log(`  npm   : ${npmOk ? `${NAME}@${npmVersion}（线上，发布于 ${publishedAt}）` : '未取到线上信息（' + npmSkip + '），仅用本地快照'}`);
console.log(`  提交  : ${head} ${lastMsg}`);
console.log(`  工作区: ${dirtyFiles.length === 0 ? 'clean' : dirtyFiles.length + ' 个未提交改动'}`);

if (openAfter) {
  const { exec } = await import('node:child_process');
  exec(`start "" "${outFile}"`, { shell: 'cmd.exe' });
  console.log('  已在浏览器中打开');
}

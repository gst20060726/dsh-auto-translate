/**
 * metrics.mjs — dsh-auto-translate 公开指标的**单一数据源**。
 *
 * 设计要点：
 *   - **只用 HTTP**，不 spawn 任何子进程（不依赖 npm / dsh 是否在 PATH 上）；
 *   - 同时供三处消费：宿主半 `index.js`（Web 路由）、`scripts/dashboard.mjs`（导入）、
 *     `scripts/status.ps1`（`node metrics.mjs --json`）；
 *   - 任一数据源失败只让**该字段**为 null 并附错误串，绝不让整体抛错。
 *
 * 用法：
 *   node metrics.mjs            # 人类可读表格
 *   node metrics.mjs --json     # 机器可读 JSON（给 status.ps1 等消费）
 *   import { collectMetrics } from './metrics.mjs'
 */

export const PKG_NAME = 'dsh-auto-translate'
export const GITEE_REPO = 'nysjn/dsh-auto-translate'
const REGISTRY = 'https://registry.npmjs.org'
const DOWNLOADS_API = 'https://api.npmjs.org'
const GITEE_API = 'https://gitee.com/api/v5/repos'
const UA = 'dsh-auto-translate-metrics'

async function getJson(url, timeoutMs = 15000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': UA } })
    if (!r.ok) return { error: 'HTTP ' + r.status }
    return { json: await r.json() }
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e) }
  } finally {
    clearTimeout(timer)
  }
}

/** 逐版本下载量从高到低排序为 [[version, count], ...] */
export function sortedVersions(perVersion) {
  if (!perVersion || typeof perVersion !== 'object') return []
  return Object.entries(perVersion)
    .filter(([, n]) => typeof n === 'number')
    .sort((a, b) => b[1] - a[1])
}

/**
 * 采集全部指标。永不抛错：失败的来源以 null + *Error 字段体现。
 * @param {{name?: string, repo?: string, timeoutMs?: number}} [opts]
 */
export async function collectMetrics(opts = {}) {
  const name = opts.name || PKG_NAME
  const repo = opts.repo || GITEE_REPO
  const t = opts.timeoutMs || 15000

  const [doc, day, week, month, range, versions, gitee] = await Promise.all([
    getJson(REGISTRY + '/' + name, t),
    getJson(DOWNLOADS_API + '/downloads/point/last-day/' + name, t),
    getJson(DOWNLOADS_API + '/downloads/point/last-week/' + name, t),
    getJson(DOWNLOADS_API + '/downloads/point/last-month/' + name, t),
    getJson(DOWNLOADS_API + '/downloads/range/last-month/' + name, t),
    getJson(DOWNLOADS_API + '/versions/' + name + '/last-week', t),
    getJson(GITEE_API + '/' + repo, t),
  ])

  let pkg = null
  if (doc.json) {
    const latest = doc.json['dist-tags'] && doc.json['dist-tags'].latest
    const v = latest && doc.json.versions ? doc.json.versions[latest] : null
    pkg = {
      latest: latest || null,
      shasum: (v && v.dist && v.dist.shasum) || null,
      fileCount: (v && v.dist && v.dist.fileCount) || null,
      unpackedSize: (v && v.dist && v.dist.unpackedSize) || null,
      tarball: (v && v.dist && v.dist.tarball) || null,
      modified: (doc.json.time && latest && doc.json.time[latest]) || null,
      allVersions: Object.keys((doc.json.versions) || {}),
    }
  }

  return {
    name,
    repo,
    fetchedAt: new Date().toISOString(),
    pkg,
    pkgError: pkg ? null : (doc.error || 'no dist-tags'),
    downloads: {
      day: (day.json && day.json.downloads) ?? null,
      week: (week.json && week.json.downloads) ?? null,
      month: (month.json && month.json.downloads) ?? null,
      perVersion: (versions.json && versions.json.downloads) || null,
      daily: (range.json && Array.isArray(range.json.downloads)) ? range.json.downloads : [],
    },
    downloadsError: (day.json || week.json || month.json || versions.json) ? null : (day.error || 'unavailable'),
    gitee: gitee.json ? {
      star: gitee.json.stargazers_count ?? null,
      fork: gitee.json.forks_count ?? null,
      watch: gitee.json.watchers_count ?? null,
      issue: gitee.json.open_issues_count ?? null,
      pushedAt: gitee.json.pushed_at || null,
    } : null,
    giteeError: gitee.json ? null : (gitee.error || 'unavailable'),
  }
}

/** 人类可读的多行文本（status.ps1 的 CLI 模式、人工排查都用它） */
export function renderMetricsText(m) {
  const L = []
  L.push('package   : ' + m.name)
  if (m.pkg) {
    L.push('npm latest: v' + m.pkg.latest + (m.pkg.modified ? '   published ' + m.pkg.modified : ''))
    if (m.pkg.shasum) L.push('shasum    : ' + String(m.pkg.shasum).slice(0, 40))
    if (m.pkg.fileCount) L.push('files     : ' + m.pkg.fileCount + (m.pkg.unpackedSize ? '   unpacked ' + (m.pkg.unpackedSize / 1024).toFixed(1) + ' KB' : ''))
  } else {
    L.push('npm latest: (unavailable: ' + (m.pkgError || 'error') + ')')
  }
  const d = m.downloads || {}
  L.push('downloads : day ' + (d.day ?? '-') + '   week ' + (d.week ?? '-') + '   month ' + (d.month ?? '-'))
  const sv = sortedVersions(d.perVersion)
  if (sv.length) L.push('per-version (last week): ' + sv.map(([v, n]) => v + '=' + n).join('  '))
  if (d.daily && d.daily.length) {
    const active = d.daily.filter((x) => x && x.downloads > 0)
    if (active.length) L.push('daily (days with traffic): ' + active.map((x) => x.day + '=' + x.downloads).join('  '))
  }
  if (m.gitee) L.push('gitee     : star ' + m.gitee.star + '  fork ' + m.gitee.fork + '  watch ' + m.gitee.watch + '  issue ' + m.gitee.issue)
  else L.push('gitee     : (unavailable: ' + (m.giteeError || 'error') + ')')
  L.push('fetchedAt : ' + m.fetchedAt)
  return L.join('\n')
}

// ---- CLI ----
const invokedDirectly = (() => {
  const entry = process.argv[1] || ''
  return /metrics\.mjs$/.test(entry.replace(/\\/g, '/'))
})()

if (invokedDirectly) {
  const asJson = process.argv.includes('--json')
  try {
    const m = await collectMetrics()
    if (asJson) process.stdout.write(JSON.stringify(m, null, 2) + '\n')
    else process.stdout.write(renderMetricsText(m) + '\n')
  } catch (e) {
    // 理论到不了这里（collectMetrics 不抛），保险起见仍然给结构化输出
    const err = { error: String((e && e.message) || e) }
    process.stdout.write((asJson ? JSON.stringify(err) : 'metrics failed: ' + err.error) + '\n')
    process.exitCode = 1
  }
}

/**
 * 离线契约测试：不需要浏览器、不联网、零依赖
 *   运行：npm test   （node --test test/）
 * 覆盖：清单契约、模块加载契约、纯函数行为、worker 锁版本、宿主防护
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const noop = () => 0

test('package.json 声明了 DSH 双面插件契约', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.name, 'dsh-auto-translate')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['.'], './index.js')
  // 包内容契约：宿主/客户端/vendor 运行时必须随包；74MB 的 wasm 刻意不随包（首次使用时 CDN 兜底）
  for (const need of ['index.js', 'client.js', 'cordis.patch.yml', 'vendor/worker.v5.js', 'vendor/transformers.esm.v2.js']) {
    assert.ok(pkg.files.includes(need), 'files 应包含 ' + need)
  }
  assert.ok(!pkg.files.some((f) => f.endsWith('.wasm')), 'wasm 不应随包（CDN 兜底或 npm run fetch-vendor）')
})

test('cordis.patch.yml 是纯 insert（保证可热挂载）', () => {
  const yml = read('cordis.patch.yml')
  assert.match(yml, /^-\s*insert:/m)
  assert.match(yml, /name:\s*'dsh-auto-translate'/)
  assert.doesNotMatch(yml, /config:/)
})

function loadClient() {
  let captured = null
  const win = {
    __ModuleLoader__: { load: (def) => { captured = def } },
    addEventListener() {}, innerWidth: 1200, innerHeight: 800,
    location: { origin: 'http://127.0.0.1:3080' },
  }
  // 屏蔽模块级副作用（定时器），其余逻辑原样加载
  // 显式屏蔽 BroadcastChannel：Node 有同名全局，模块级创建会挂住事件循环、测试不退出
  const fn = new Function('window', 'self', 'setInterval', 'clearInterval', 'setTimeout', 'BroadcastChannel', read('client.js'))
  fn(win, win, noop, noop, noop, undefined)
  assert.ok(captured, '必须调用 window.__ModuleLoader__.load()')
  const mod = captured.factory((spec) => { throw new Error('unexpected require: ' + spec) })
  return { captured, mod }
}

test('浏览器半符合模块加载器契约', () => {
  const { captured, mod } = loadClient()
  assert.equal(captured.id, 'dsh-auto-translate')
  assert.equal(typeof captured.factory, 'function')
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, [])
})

test('纯函数行为：语言判定 / 分块 / 热键组合 / 错误提示', () => {
  const t = loadClient().mod.__test
  assert.equal(t.scriptTag('Hello there'), 'latin')
  assert.equal(t.scriptTag('你好，世界'), 'zh')
  assert.equal(t.scriptTag('こんにちは'), 'ja')
  assert.equal(t.scriptTag('Привет'), 'ru')
  assert.equal(t.scriptTag('12345'), null)

  const parts = t.chunkText('a'.repeat(2500), 1000)
  assert.ok(parts.length >= 3, '长文本应被分块')
  assert.equal(parts.join('').length, 2500, '分块不得丢字符')

  assert.equal(t.comboOf({ ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, key: 't' }), 'Ctrl+Alt+T')
  assert.equal(t.comboOf({ ctrlKey: true, key: 'Control' }), '', '纯修饰键不应算组合')

  assert.match(t.hintFor('Missing required scale: x'), /fp32/)
  assert.match(t.hintFor('Failed to fetch'), /网络/)
  assert.match(t.hintFor('quotaFinished'), /本机离线/)
  assert.equal(t.hintFor('一切正常'), '')

  assert.ok(t.limits.QUEUE_MAX > 0 && t.limits.RECORDS_MAX > 0)
})

test('会话字符上限只作用于在线/自定义引擎（本机离线零成本，不得被拦）', () => {
  const { mod } = loadClient()
  const t = mod.__test
  const s = mod.__test.settings
  assert.ok(s, '__test 应暴露 settings 以便驱动引擎分支')
  s.maxChars = 40000
  const limitFor = (engine) => { s.engine = engine; return t.sessionLimit() }
  assert.equal(limitFor('local'), 0, '本机离线模型不该有会话上限')
  assert.equal(limitFor('ondevice'), 0, '端侧引擎不该有会话上限')
  assert.equal(limitFor('online'), 40000, '在线引擎必须保留上限以保护免费额度')
  assert.equal(limitFor('custom'), 40000, '自定义端点也计入上限')
  s.maxChars = 0
  assert.equal(limitFor('online'), 0, '设为 0 表示在线也不限')
  s.maxChars = 40000
})

test('悬停模式的实际引擎解析：默认本机离线，可切在线/自定义', () => {
  const { mod } = loadClient()
  const t = mod.__test
  const s = mod.__test.settings
  s.engine = 'hover'
  s.hoverEngine = 'local'
  assert.equal(t.actualModeFor(null), 'local', '悬停模式默认用本机离线')
  s.hoverEngine = 'online'
  assert.equal(t.actualModeFor(null), 'online')
  s.hoverEngine = 'custom'
  assert.equal(t.actualModeFor(null), 'custom')
  s.hoverEngine = '乱写的值'
  assert.equal(t.actualModeFor(null), 'local', '非法值应回退本机离线')
  s.engine = 'auto'
  s.hoverEngine = 'online'
  assert.equal(t.actualModeFor(null), 'auto', '非悬停模式下必须原样返回用户选的引擎')
  s.engine = 'hover'; s.hoverEngine = 'local'
})

test('悬停模式绝不自动扫描，且丢弃自动扫描残留队列', () => {
  const src = read('client.js')
  // 悬停模式：scanRoot 必须直接返回，pump 必须丢弃队列，两者都不得自动翻译
  assert.match(src, /function scanRoot\(root, depth\) \{\s*\n\s*if \(!root \|\| !settings\.enabled\) return;\s*\n\s*if \(settings\.engine === 'hover'\) return;/,
    'scanRoot 必须在悬停模式下直接返回')
  assert.match(src, /async function pump\(\) \{[\s\S]{0,400}?engine === 'hover'\)[\s\S]{0,160}?queue\.length = 0/,
    'pump 必须在悬停模式下丢弃队列')
  // 悬停模式必须单独解析实际引擎，不能落到 translateText 尾部的空档
  assert.match(src, /function actualModeFor\(/, '必须有 actualModeFor 解析悬停模式的实际引擎')
  // 默认模式必须是悬停翻译，且设置为新用户/旧用户都迁移到它
  assert.match(read('client.js'), /engine: 'hover',/, '默认引擎必须是 hover')
})

test('达到上限后「重试」与「清零计数」必须重置本次会话字符数', () => {
  const src = read('client.js')
  // retry / rescan / resetChars 三条路径都必须清零 stats.chars，否则会立刻再次撞线
  const retryBlock = src.match(/act === 'retry'\)\s*\{([\s\S]{0,400}?)\n\s*\}/)
  assert.ok(retryBlock, '应能找到 retry 分支')
  assert.match(retryBlock[1], /stats\.chars = 0/, 'retry 必须清零会话字符计数')
  const resetBlock = src.match(/act === 'resetChars'\)\s*\{([\s\S]{0,300}?)\n\s*\}/)
  assert.ok(resetBlock, '应能找到 resetChars 分支')
  assert.match(resetBlock[1], /stats\.chars = 0/, 'resetChars 必须清零会话字符计数')
  const rescanBlock = src.match(/act === 'rescan'\)([^\n]{0,200})/)
  assert.ok(rescanBlock, '应能找到 rescan 分支')
  assert.match(rescanBlock[1], /stats\.chars = 0/, 'rescan 也应清零会话字符计数')
  // 上限判断必须走 sessionLimit()（引擎感知），不能再用裸 settings.maxChars
  assert.doesNotMatch(src, /stats\.chars >= settings\.maxChars/, '不得再用裸 settings.maxChars 做判断')
  assert.match(src, /var lim = sessionLimit\(\)/, '上限判断应使用 sessionLimit()')
})

test('worker 锁定模型 revision 且映射 NLLB 语言码', () => {
  const stub = { location: { origin: 'http://127.0.0.1:3080' }, postMessage() {}, __test: null }
  const fn = new Function('self', read('vendor/worker.v5.js'))
  fn(stub)
  const t = stub.__test
  assert.ok(t && t.REVISIONS, 'worker 应暴露 __test.REVISIONS')
  const names = Object.keys(t.REVISIONS)
  // worker 支持的每个模型都必须锁到一个完整 commit sha（不允许留 'main' 这类占位）
  assert.ok(names.length >= 5, '应覆盖全部可加载模型，实际 ' + names.length)
  for (const [k, v] of Object.entries(t.REVISIONS)) assert.match(v, /^[0-9a-f]{40}$/, k + ' 必须锁到完整 commit sha')
  for (const need of ['Xenova/opus-mt-en-zh', 'Xenova/opus-mt-zh-en', 'Xenova/opus-mt-ja-en', 'Xenova/opus-mt-ko-en']) {
    assert.ok(names.includes(need), '缺少 ' + need)
  }
})

test('宿主半具备必要防护与能力', () => {
  const src = read('index.js')
  assert.match(src, /kind: 'prefix'/, '需要前缀路由（vendor 与 model）')
  assert.match(src, /application\/wasm/, 'wasm 必须以正确 MIME 提供')
  assert.match(src, /ALLOWED_REPOS/, '模型代理需要仓库白名单')
  assert.match(src, /safeRegister/, '重复注册不应导致插件失败')
  assert.match(src, /loopback only/, '诊断接口应限制回环来源')
  assert.match(src, /slice\(20\)/, '诊断文件应自动裁剪')
  assert.match(src, /AbortSignal\.timeout/, '下载必须带超时')
})

test('vendor 资源齐全（JS 与 loader 必须随包提供）', () => {
  for (const p of ['vendor/worker.v5.js', 'vendor/transformers.esm.v2.js', 'vendor/ort/ort.webgpu.min.mjs']) {
    const size = readFileSync(join(ROOT, p)).length
    assert.ok(size > 1000, p + ' 应存在且非空')
  }
  assert.doesNotMatch(read('vendor/transformers.esm.v2.js'), /from"\/npm\//, '不得残留根相对 CDN 引入')
})

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
  for (const need of ['index.js', 'client.js', 'cordis.patch.yml', 'metrics.mjs', 'vendor/worker.v5.js', 'vendor/transformers.esm.v2.js']) {
    assert.ok(pkg.files.includes(need), 'files 应包含 ' + need)
  }
  assert.ok(!pkg.files.some((f) => f.endsWith('.wasm')), 'wasm 不应随包（CDN 兜底或 npm run fetch-vendor）')
})

test('metrics.mjs 是唯一指标入口，且对失败来源不抛错', async () => {
  const m = await import('../metrics.mjs')
  for (const fn of ['collectMetrics', 'renderMetricsText', 'sortedVersions']) {
    assert.equal(typeof m[fn], 'function', 'metrics.mjs 应导出 ' + fn)
  }
  // 逐版本排序：从高到低，忽略非数字
  assert.deepEqual(m.sortedVersions({ '0.2.0': 149, '0.2.2': 38, '0.2.1': 97 }), [['0.2.0', 149], ['0.2.1', 97], ['0.2.2', 38]])
  assert.deepEqual(m.sortedVersions(null), [])
  // 渲染对缺字段的载荷必须健壮（全部字段缺失也不得抛错）
  const text = m.renderMetricsText({ name: 'x', pkg: null, pkgError: 'HTTP 404', downloads: {}, gitee: null, giteeError: 'timeout', fetchedAt: 'now' })
  assert.match(text, /HTTP 404/)
  assert.match(text, /timeout/)
  assert.match(text, /day -/)
  // 宿主半必须经这一个入口取指标（不允许各处再自己 fetch 外部 API）
  const idx = read('index.js')
  assert.match(idx, /import \{ collectMetrics \} from '\.\/metrics\.mjs'/, 'index.js 应导入 metrics.mjs')
  assert.match(idx, /path: METRICS_PATH/, '应注册指标路由')
  for (const f of ['scripts/dashboard.mjs', 'scripts/status.ps1']) {
    assert.match(read(f), /metrics\.mjs/, f + ' 应复用 metrics.mjs 而非自己写一套')
  }
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

test('分块按句子边界切，不把句子劈成两半（质量回归）', () => {
  const t = loadClient().mod.__test
  // 中文长段：没有空格，旧实现会把句子从中间切开
  const zh = '第一句很短。第二句也不长。第三句稍微长一点点但要保证能被完整保留。第四句结束。'
  const parts = t.chunkText(zh, 20)
  assert.ok(parts.length > 1, '长文本应被切块')
  assert.equal(parts.join(''), zh, '切块不得丢字符')
  for (const p of parts) assert.ok(p.length <= 20, '每块都不应超过上限，实际 ' + p.length + ': ' + JSON.stringify(p))
  // 关键：除最后一块外都应以句末标点结尾（说明没有从句子中间劈开）
  for (const p of parts.slice(0, -1)) {
    assert.match(p, /[。！？；…]$/, '块应以句末标点结束，实际: ' + JSON.stringify(p))
  }
  // 英文小数点不应被当作句末
  assert.equal(t.splitSentences('Pi is 3.14159 exactly. That is short.').length, 2, '小数点不应断句')
  // 单句超长时必须能退化处理，且不丢字符、不超上限
  const long = 'A'.repeat(500)
  const lp = t.chunkText(long, 100)
  assert.equal(lp.join(''), long, '单句超长时也不得丢字符')
  for (const p of lp) assert.ok(p.length <= 100, '退化分块也要遵守上限')
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

test('悬停路径必须有界：本机翻译超时保护 + 会话上限 + busy 不泄漏', () => {
  const src = read('client.js')
  // 1) 本机翻译不能裸调 localTranslate（其看门狗要等 300 秒，会把 hoverBusy 锁死）
  assert.match(src, /function localTranslateGuarded\(/, '必须有 localTranslateGuarded 包装')
  assert.match(src, /HOVER_LOCAL_TIMEOUT_MS/, '必须有明确的悬停超时常量')
  const now = src.match(/async function translateNodeNow\(node\) \{([\s\S]*?)\n\t\t\}/)
  assert.ok(now, '应能找到 translateNodeNow')
  assert.match(now[1], /localTranslateGuarded\(/, '悬停翻译本机必须走有界包装')
  assert.doesNotMatch(now[1], /await translateLong\(localTranslate,/, '悬停路径不得裸调 translateLong(localTranslate)')
  // 2) 在线/自定义/兜底路径都必须有超时
  assert.match(now[1], /withTimeout\(translateLong\(onlineTranslate/, '在线路径必须带超时')
  assert.match(now[1], /withTimeout\(translateLong\(httpTranslate/, '自定义端点路径必须带超时')
  // 3) 悬停路径必须遵守会话字符上限（原来只在自动扫描的 pump 里判）
  assert.match(now[1], /sessionLimit\(\)/, '悬停路径必须检查会话上限')
  // 4) hoverBusy 必须在 finally 里释放
  const host = src.match(/async function translateHost\(host\) \{([\s\S]*?)\n\t\t\}/)
  assert.ok(host, '应能找到 translateHost')
  assert.match(host[1], /finally \{ hoverBusy = false; \}/, 'hoverBusy 必须在 finally 中释放')
})

test('在线连续失败必须指数退避（额度耗尽时不能一直硬打）', () => {
  const { mod } = loadClient()
  const b = mod.__test.onlineBackoff
  assert.ok(b, '__test 应暴露 onlineBackoff')
  // 退避曲线：2s 起，逐次翻倍，封顶 30s
  assert.equal(b.delay(1), 2000)
  assert.equal(b.delay(2), 4000)
  assert.equal(b.delay(3), 8000)
  assert.equal(b.delay(4), 16000)
  assert.ok(b.delay(5) <= 30000, '退避必须封顶 30 秒，实际 ' + b.delay(5))
  assert.equal(b.delay(99), 30000)
  // 前两次失败不暂停（避免偶发抖动就停摆），第 3 次起进入退避
  b.clear()
  b.note(false); assert.equal(b.fails(), 1); assert.equal(b.paused(), false, '失败 1 次不应暂停')
  b.note(false); assert.equal(b.fails(), 2); assert.equal(b.paused(), false, '失败 2 次不应暂停')
  b.note(false); assert.equal(b.fails(), 3); assert.equal(b.paused(), true, '连续失败 3 次必须进入退避')
  // 一次成功即清零并恢复
  b.note(true)
  assert.equal(b.fails(), 0, '成功后失败计数必须清零')
  assert.equal(b.paused(), false, '成功后不得继续暂停')
  b.clear()
})

test('resetTranslationState 必须同时清掉在线退避（用户重试要立刻再试）', () => {
  const src = read('client.js')
  const fn = src.match(/function resetTranslationState\(revertFirst\) \{([\s\S]*?)\n\t\t\}/)
  assert.ok(fn, '必须有 resetTranslationState()')
  assert.match(fn[1], /onlineFails = 0/, '必须清空失败计数')
  assert.match(fn[1], /onlineRetryAt = 0/, '必须清掉退避截止时间')
  assert.match(fn[1], /clearTimeout\(onlineRetryTimer\)/, '必须取消待触发的重试定时器')
})

test('本机路径失败必须优雅回退到在线并触发预热（切换引擎后不能「悬停没反应」）', () => {
  const src = read('client.js')
  const now = src.match(/async function translateNodeNow\(node\) \{([\s\S]*?)\n\t\t\}/)
  assert.ok(now, '应能找到 translateNodeNow')
  const body = now[1]
  assert.match(body, /if \(!out && realMode === 'local'\)/, '本机失败后必须有回退分支')
  assert.match(body, /translateLong\(onlineTranslate/, '回退分支必须真正调用在线翻译')
  assert.match(body, /warmLocal\(\)/, '回退时必须触发本机模型预热')
  assert.match(body, /stats\.fellBack\+\+/, '回退成功应计入 fellBack')
})

test('切换引擎/目标语言前必须先把页面还原成原文（否则留下孤儿译文）', () => {
  const src = read('client.js')
  // resetTranslationState 必须支持「先还原」参数
  assert.match(src, /function resetTranslationState\(revertFirst\)/, 'resetTranslationState 必须接受 revertFirst')
  const fn = src.match(/function resetTranslationState\(revertFirst\) \{([\s\S]*?)\n\t\t\}/)
  assert.ok(fn, '应能找到 resetTranslationState')
  assert.match(fn[1], /if \(revertFirst\) revertTranslatedNodes\(\)/, 'revertFirst 为真时必须先还原页面文本')
  assert.match(src, /function revertTranslatedNodes\(\)/, '必须有 revertTranslatedNodes()')
  // 引擎/目标语言变更这条路径必须先还原
  assert.match(src, /key === 'engine'[\s\S]{0,120}resetTranslationState\(true\)/,
    '切换引擎/目标语言必须 resetTranslationState(true)')
  // 至少 4 处调用带 true（设置变更 / 切本机 / 切在线 / 重试 / 重扫）
  const trues = src.split('resetTranslationState(true)').length - 1
  assert.ok(trues >= 4, '带还原的复位调用点应 >= 4，实际 ' + trues)
})

test('清空译文记录必须走 resetTranslationState()，且同时清掉 data-dsh-at 标记', () => {
  const src = read('client.js')
  // 1) 不允许任何地方再手写这三件套（漏掉 DOM 标记就会让悬停静默失效）
  assert.doesNotMatch(src, /records = \[\]; recordByNode = new WeakMap\(\)/,
    '不得手写 records/recordByNode/processed 三件套，必须调用 resetTranslationState()')
  // 2) 统一复位函数必须存在，且必须清 DOM 标记 + 清 processed/records + 复位悬停状态
  const fn = src.match(/function resetTranslationState\(revertFirst\) \{([\s\S]*?)\n\t\t\}/)
  assert.ok(fn, '必须有 resetTranslationState()')
  assert.match(fn[1], /records = \[\]/, '必须清空 records')
  assert.match(fn[1], /processed = new WeakSet\(\)/, '必须清空 processed（否则同一块无法被重新翻译）')
  assert.match(fn[1], /removeAttribute\('data-dsh-at'\)/, '必须清掉页面上的 data-dsh-at 标记')
  assert.match(fn[1], /hoverHost = null/, '必须复位悬停宿主状态')
  // 3) 统一复位有足够多的调用点（retry / rescan / uselocal / useonline / 设置变更）
  const calls = (src.split('resetTranslationState(').length - 1) - 1   // 减去函数定义本身
  assert.ok(calls >= 5, 'resetTranslationState 调用点应 >= 5，实际 ' + calls)
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

test('0.4.0：彻底取消自动全页翻译，engine 只剩「触发方式」，后端由 hoverEngine 决定', () => {
  const src = read('client.js')
  // 1) 面板里不得再有会触发整页翻译的 engine 选择器
  assert.doesNotMatch(src, /data-set="engine"/, '面板不得再暴露会整页自动翻译的 engine 选择器')
  assert.match(src, /data-set="hoverEngine"/, '面板必须提供「由谁翻」的后端选择器')
  assert.doesNotMatch(src, /option value="auto" data-i18n="engineAuto"/, '不得保留「自动」选项')
  // 2) translateText 的按需分支必须按 hoverEngine 选后端（旧实现固定落回本机离线）
  const branch = src.match(/\/\/ 悬停\/框选模式：([\s\S]{0,400}?)\n\t\t\}/)
  assert.ok(branch, '应能找到 translateText 的按需分支')
  assert.match(branch[1], /settings\.hoverEngine/, '按需分支必须读取 hoverEngine')
  assert.match(branch[1], /onlineTranslate/, 'hoverEngine=online 必须真的走在线引擎')
  assert.match(branch[1], /httpTranslate/, 'hoverEngine=custom 必须真的走自定义端点')
  // 3) 迁移：老配置的「用哪个引擎」必须搬到 hoverEngine，engine 归位 hover
  const mig = src.match(/settings\.version < 5\)([\s\S]{0,700}?)\n\t\t\}/)
  assert.ok(mig, '应有 v5 迁移块')
  assert.match(mig[1], /settings\.hoverEngine = 'online'/, 'v5 迁移必须搬运在线偏好')
  assert.match(mig[1], /settings\.engine = 'hover'/, 'v5 迁移必须把 engine 归位为按需触发')
  assert.match(mig[1], /settings\.enabled = false/, '旧的「关闭」必须迁移成「未启用」，不得悄悄打开')
})

test('0.4.0：框选翻译只在用户主动操作时触发，且守住输入框/代码块/面板自身', () => {
  const src = read('client.js')
  // 1) 只在 mouseup 后读取选区（没有任何 selectionchange 自动翻译的路径）
  assert.doesNotMatch(src, /selectionchange/, '不得用 selectionchange 自动触发翻译')
  assert.match(src, /addEventListener\('mouseup', onDocMouseUp, true\)/, '必须监听 mouseup 读取用户选区')
  assert.match(src, /function selectionItem\(tgt\)/, '必须有 selectionItem 解析选区（并校验松手位置属于该选区）')
  assert.match(src, /selectionBlocked\(/, '必须有选区跳过规则')
  // 2) 跳过规则必须复用统一判定 + SKIP_TAGS（输入框、代码块、面板自身）
  const blk = src.match(/function selectionBlocked\(el\) \{([\s\S]*?)\n\t\t\}/)
  assert.ok(blk, '应能找到 selectionBlocked')
  assert.match(blk[1], /SKIP_TAGS\[cur\.tagName\]/, '必须按标签跳过输入框/代码块')
  assert.match(blk[1], /isSkipped\(el\)/, '必须复用 isSkipped（面板自身/代码编辑器/translate=no）')
  // 3) 两种呈现方式都要有实现
  assert.match(src, /function showSelPop\(/, '必须有浮层呈现')
  assert.match(src, /function inlineReplaceSelection\(/, '必须有就地替换呈现')
  assert.match(src, /data-dsh-at-sel/, '就地替换的片段必须打标记，便于还原')
  // 4) 就地替换必须能一键还原，且随「还原原文」一起回滚
  assert.match(src, /function restoreInlineSelections\(/, '必须有就地替换的还原')
  const rev = src.match(/function revertTranslatedNodes\(\) \{([\s\S]{0,220}?)\n\t\t\tpruneDeadRecords/)
  assert.ok(rev, '应能找到 revertTranslatedNodes 开头')
  assert.match(rev[1], /restoreInlineSelections\(\)/, '「还原原文」必须先收回就地替换')
  // 5) 三种模式（浮层/就地/关闭）都必须在面板里可选
  for (const v of ['popup', 'inline', 'off']) assert.match(src, new RegExp('data-set="selectionMode"[\\s\\S]{0,200}?value="' + v + '"'), 'selectionMode 缺选项 ' + v)
})

test('0.4.0：面板分组折叠 + 状态行分段（解决「太长/难读」）', () => {
  const src = read('client.js')
  // 四个分组，且默认只展开「常用」
  assert.match(src, /data-grp="common" open/, '「常用」分组应默认展开')
  for (const g of ['engine', 'advanced', 'diag']) assert.match(src, new RegExp('data-grp="' + g + '"'), '缺少分组 ' + g)
  assert.match(src, /data-act="expandAll"/, '应有「展开全部」')
  assert.match(src, /data-act="collapseAll"/, '应有「折叠全部」')
  assert.match(src, /data-act="slim"/, '应有「窄面板」开关（更不挡内容）')
  // 状态行：分段拼接 + 去掉前缀，不得再拼成一整行 " | "
  const st = src.match(/statusEl\.textContent = segs\.join\(' · '\)/)
  assert.ok(st, '状态行必须分段拼接')
  assert.match(src, /function modeText\(\)/, '必须有头部模式条')
  assert.match(src, /data-el="modeText"/, '面板必须有模式条元素')
})

test('0.4.0：状态行不再残留自动翻译时代的措辞', () => {
  const src = read('client.js')
  assert.doesNotMatch(src, /自动翻译 · 使用指南/, '帮助文案不得再宣称「自动翻译」')
  assert.doesNotMatch(src, /自动工作:页面上的外语文本就地替换/, '帮助文案不得再说「自动工作」')
  assert.match(src, /不会自动翻译整页/, '帮助文案必须明确「不会自动翻译整页」')
})

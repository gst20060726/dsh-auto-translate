/**
 * DOM 级 E2E（可选依赖 jsdom）：锁死最容易回归的链路 ——
 *   翻译写入 → 悬停切回原文 → 观察者不得覆盖 → 再悬停切回译文
 * 未安装 jsdom 时整组自动跳过，保证 npm test 在无 devDependency 时也是绿的。
 *
 * 用法：npm i -D jsdom && npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SETTINGS_KEY = 'dsh-auto-translate.settings.v1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function loadJsdom() {
  try { const m = await import('jsdom'); return m.JSDOM } catch { return null }
}
const JSDOM = await loadJsdom()
const skip = JSDOM ? false : 'jsdom 未安装（npm i -D jsdom 后可运行 DOM E2E）'

class FakeWorker {
  constructor() { this.onmessage = null; this.onerror = null; this.terminated = false }
  postMessage(msg) {
    setTimeout(() => {
      if (this.terminated || !this.onmessage) return
      if (msg.type === 'translate') this.onmessage({ data: { id: msg.id, ok: true, text: 'ZH< ' + msg.text + ' >' } })
      else if (msg.type === 'warm') this.onmessage({ data: { id: msg.id, ok: true, warm: true } })
      else this.onmessage({ data: { id: msg.id, ok: true } })
    }, 0)
  }
  terminate() { this.terminated = true }
}

class FakeXHR {
  open() { this.status = 200; this._ct = 'text/javascript; charset=utf-8' }
  send() { }
  getResponseHeader() { return this._ct }
}

/** 把浏览器半加载进 jsdom，并注入 Worker/XHR/fetch 等宿主能力 */
function loadClientInto(window) {
  let captured = null
  window.__ModuleLoader__ = { load: (def) => { captured = def } }
  const src = readFileSync(join(ROOT, 'client.js'), 'utf8')
  const fn = new Function(
    'window', 'self', 'document', 'localStorage', 'navigator', 'Worker', 'XMLHttpRequest',
    'MutationObserver', 'NodeFilter', 'IntersectionObserver', 'fetch', 'performance',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'requestIdleCallback', 'BroadcastChannel',
    src,
  )
  fn(
    window, window, window.document, window.localStorage, window.navigator, FakeWorker, FakeXHR,
    window.MutationObserver, window.NodeFilter, undefined,
    async () => ({ ok: true, json: async () => ({ ok: true }) }), window.performance,
    window.setInterval.bind(window), window.clearInterval.bind(window),
    window.setTimeout.bind(window), window.clearTimeout.bind(window), undefined, undefined,
  )
  assert.ok(captured, '必须调用 window.__ModuleLoader__.load()')
  return captured.factory(() => { throw new Error('unexpected require') })
}

async function waitFor(fn, timeout = 6000, step = 40) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (fn()) return true } catch { /* keep waiting */ }
    await sleep(step)
  }
  return false
}

test('E2E 0.4.0: 悬停翻译 → 再悬停切回原文 → 观察者不覆盖 → 再悬停切回译文', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"><p id="t">Hello world, this needs translation.</p></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 5, engine: 'hover', hoverEngine: 'local', target: 'zh', latinSource: 'en',
      hoverDelayMs: 0, minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    // jsdom 没有布局：给所有元素一个"可见"矩形，否则视口门控会全部跳过
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }

    const p = window.document.getElementById('t')
    const node = p.firstChild
    const original = node.nodeValue

    const mod = loadClientInto(window)
    mod.apply({})
    assert.ok(window.document.getElementById('dsh-auto-translate-root'), '面板应已挂载')

    // 0) 0.4.0：加载后绝不自动翻译（这也是「不污染正常使用体验」的核心）
    await sleep(500)
    assert.equal(node.nodeValue, original, '不得自动翻译整页，实际: ' + JSON.stringify(node.nodeValue))

    // 1) 第一次悬停 → 翻译该块
    p.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => node.nodeValue !== original), '悬停后应翻译，实际: ' + JSON.stringify(node.nodeValue))
    assert.match(node.nodeValue, /ZH</, '应写入译文')
    assert.equal(p.getAttribute('data-dsh-at'), 'translated', '宿主元素应被标记')

    // 2) 移开再悬停同一块 → 切回原文
    p.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body }))
    await sleep(60)
    p.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => node.nodeValue === original, 2500), '再次悬停应切回原文，实际: ' + JSON.stringify(node.nodeValue))

    // 3) 关键回归：等远超稳定窗口，确认观察者没有把原文覆盖成译文
    await sleep(1300)
    assert.equal(node.nodeValue, original, '切回原文后必须保持原文（观察者不得覆盖）')

    // 4) 再悬停 → 切回译文
    p.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body }))
    await sleep(60)
    p.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 2500), '第三次悬停应切回译文，实际: ' + JSON.stringify(node.nodeValue))
  } finally {
    window.close()
  }
})

test('E2E 0.4.0: 悬停模式下流式追加的文本不会被自动翻译（不打扰正常使用）', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><p id="s">Streaming</p></body></html>', { url: 'http://127.0.0.1:3080/' })
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 5, engine: 'hover', hoverEngine: 'local', target: 'zh', latinSource: 'en', minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p = window.document.getElementById('s')
    const node = p.firstChild
    loadClientInto(window).apply({})

    // 模拟模型逐 token 追加：每 60ms 改一次文本节点
    for (let i = 0; i < 8; i++) {
      node.nodeValue = 'Streaming sentence part ' + i
      await sleep(60)
    }
    const settled = 'Streaming sentence part 7'
    // 停止追加后（远超稳定窗口）也不得被改写：按需模式不主动碰任何文本
    await sleep(1500)
    assert.equal(node.nodeValue, settled, '按需模式不得改写页面文本，实际: ' + JSON.stringify(node.nodeValue))
    assert.equal(p.getAttribute('data-dsh-at'), null, '不得给未翻译的块打标记')
  } finally {
    window.close()
  }
})

test('E2E 0.4.0: 切换引擎时必须先把已翻译的页面还原成原文（不留孤儿译文）', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="a"><p id="p1">Hello world, this needs translation.</p></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 5, engine: 'hover', hoverEngine: 'local', target: 'zh', latinSource: 'en',
      hoverDelayMs: 100, minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const node = p1.firstChild
    const original = node.nodeValue
    const mod = loadClientInto(window)
    mod.apply({})

    // 悬停把这一块翻出来
    p1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 4000), '悬停后应翻译，实际: ' + JSON.stringify(node.nodeValue))

    // 模拟用户切换引擎：实现里走 resetTranslationState(true)
    mod.__test.resetTranslationState(true)

    // 关键：页面必须立刻回到原文，而不是留着上一个引擎的译文（旧 bug：留着 → 无法复原）
    assert.equal(node.nodeValue, original, '切换后必须还原成原文，实际: ' + JSON.stringify(node.nodeValue))
    assert.equal(p1.getAttribute('data-dsh-at'), null, '切换后不得残留标记')
  } finally {
    window.close()
  }
})

test('E2E 悬停模式: 切换引擎后不应留下会让悬停卡死的标记（回归）', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="a"><p id="p1">Hello world, this needs translation.</p></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 4, engine: 'hover', hoverEngine: 'local', target: 'zh', latinSource: 'en',
      hoverDelayMs: 100, minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const node = p1.firstChild
    const mod = loadClientInto(window)
    mod.apply({})

    // 1) 悬停翻译一块 → 该块被标记
    p1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 3000), '第一次悬停应翻译')
    assert.equal(p1.getAttribute('data-dsh-at'), 'translated', '翻译后宿主应带标记')

    // 2) 模拟用户切换引擎：实现里会调用 resetTranslationState()
    mod.__test.resetTranslationState()
    assert.equal(p1.getAttribute('data-dsh-at'), null, '复位后 DOM 标记必须被清掉（否则悬停会卡死）')
    assert.equal(mod.__test.hoverHostState(p1).state, 'none', '复位后应回到「未翻译」状态')

    // 3) 再次悬停仍能正常触发（旧 bug：records 空 + 残留标记 → 完全无反应）
    p1.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body }))
    await sleep(150)
    p1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 3000),
      '复位后再次悬停必须能翻译，实际: ' + JSON.stringify(node.nodeValue))
  } finally {
    window.close()
  }
})

test('E2E 悬停模式: 悬停翻译该块后，再次悬停同一块可复原为原文', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="a"><p id="p1">Hello world, this needs translation.</p></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 4, engine: 'hover', hoverEngine: 'local', target: 'zh', latinSource: 'en',
      hoverDelayMs: 120, minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const node = p1.firstChild
    const original = node.nodeValue
    loadClientInto(window).apply({})

    // 第一次悬停 → 翻译
    p1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 3000), '第一次悬停应翻译，实际: ' + JSON.stringify(node.nodeValue))
    // 移开：译文保持
    p1.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body }))
    await sleep(200)
    assert.ok(/ZH</.test(node.nodeValue), '移开后应保持译文，实际: ' + JSON.stringify(node.nodeValue))
    // 再次悬停同一块 → 复原为原文
    p1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => node.nodeValue === original, 3000), '再次悬停应复原为原文，实际: ' + JSON.stringify(node.nodeValue))
    // 第三次悬停 → 又变回译文（可反复切换）
    p1.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body }))
    await sleep(150)
    p1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 3000), '第三次悬停应再次显示译文，实际: ' + JSON.stringify(node.nodeValue))
  } finally {
    window.close()
  }
})

test('E2E 悬停模式: 加载后不自动翻译任何内容，悬停后才翻译该块', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="a"><p id="p1">Hello world, this needs translation.</p></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 4, engine: 'hover', target: 'zh', latinSource: 'en', hoverDelayMs: 120, minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const node = p1.firstChild
    const original = node.nodeValue
    loadClientInto(window).apply({})

    // 1) 悬停模式：初始绝不自动翻译
    await sleep(700)
    assert.equal(node.nodeValue, original, '悬停模式下加载后不得自动翻译，实际: ' + JSON.stringify(node.nodeValue))

    // 2) 悬停超过阈值 → 只翻译这一块
    p1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 3000), '悬停后应翻译该块，实际: ' + JSON.stringify(node.nodeValue))

    // 3) 译文必须保持：移开鼠标后再等一段，不得自动变回原文
    p1.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body }))
    const translated = node.nodeValue
    await sleep(900)
    assert.equal(node.nodeValue, translated, '移开鼠标后译文必须保持，实际: ' + JSON.stringify(node.nodeValue))
  } finally {
    window.close()
  }
})

test('E2E 0.4.0: 页面重渲染后可摘掉死记录（还原不再被死节点拖住）', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="a"><p id="p1">Hello world, this needs translation.</p><p id="p2">Another sentence for translation.</p></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 5, engine: 'hover', hoverEngine: 'local', target: 'zh', latinSource: 'en',
      hoverDelayMs: 0, minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const p2 = window.document.getElementById('p2')
    const mod = loadClientInto(window)
    mod.apply({})

    // 分别悬停两句 → 都被翻译
    p1.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(p1.firstChild.nodeValue), 4000), 'p1 悬停后应被翻译')
    p2.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(p2.firstChild.nodeValue), 4000), 'p2 悬停后应被翻译')

    // 模拟重渲染：整块替换掉 p1（它上面的记录随之变成死记录）
    const fresh = window.document.createElement('p')
    fresh.id = 'p1'
    fresh.textContent = 'Hello world, this needs translation.'
    p1.parentNode.replaceChild(fresh, p1)

    // 记录卫生必须能摘掉死记录
    const dropped = mod.__test.pruneDeadRecords()
    assert.ok(dropped >= 1, '应至少摘掉 1 条死记录，实际 ' + dropped)

    // 剩下的记录仍然可还原
    const restored = mod.__test.revertTranslatedNodes()
    assert.ok(restored >= 1, '剩余记录仍应能被还原，实际 ' + restored)
    assert.equal(p2.firstChild.nodeValue, 'Another sentence for translation.', 'p2 应回到原文')
  } finally {
    window.close()
  }
})

/** 在 jsdom 里造一个「真实」的文本选区（jsdom 没有布局，Range 的矩形要手动给） */
function selectText(window, node, start, end) {
  window.Range.prototype.getBoundingClientRect = function () {
    return { width: 160, height: 18, top: 40, left: 20, right: 180, bottom: 58, x: 20, y: 40 }
  }
  const range = window.document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  return range
}

function hoverSettings(extra) {
  return JSON.stringify(Object.assign({
    version: 5, engine: 'hover', hoverEngine: 'local', target: 'zh', latinSource: 'en',
    hoverDelayMs: 0, minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    selectionMode: 'popup', selectionMinChars: 4,
  }, extra || {}))
}

test('E2E 0.4.0 框选翻译: 拖选文字松手 → 浮层显示译文', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><p id="p1">Hello world, this needs translation.</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings())
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const node = p1.firstChild
    const mod = loadClientInto(window)
    mod.apply({})

    selectText(window, node, 0, 11)                    // "Hello world"
    p1.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))

    const root = window.document.getElementById('dsh-auto-translate-root')
    let pop = null
    assert.ok(await waitFor(() => { pop = root.shadowRoot.querySelector('.selpop'); return !!pop }, 3000), '浮层应出现')
    assert.ok(await waitFor(() => pop.classList.contains('on') && /ZH</.test(pop.textContent), 4000),
      '松手后浮层应显示译文，实际: ' + JSON.stringify(pop && pop.textContent))
    assert.match(pop.querySelector('.src').textContent, /Hello world/, '浮层应带上原文')
    // 页面本身不得被改动
    assert.equal(node.nodeValue, 'Hello world, this needs translation.', '框选不得改动页面原文')
  } finally {
    window.close()
  }
})

test('E2E 0.4.0 框选翻译: 在别处松手/点击不会翻出上一次遗留的选区', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><p id="p1">Hello world, this needs translation.</p><p id="p2">Second paragraph.</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings())
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const mod = loadClientInto(window)
    mod.apply({})
    const p1 = window.document.getElementById('p1')
    const p2 = window.document.getElementById('p2')
    const root = window.document.getElementById('dsh-auto-translate-root')

    // 选区留在 p1，但松手发生在 p2（例如点了个按钮/链接）
    selectText(window, p1.firstChild, 0, 11)
    p2.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
    await sleep(300)
    const pop = root.shadowRoot.querySelector('.selpop')
    assert.ok(!pop || !pop.classList.contains('on'), '遗留选区不得触发浮层')
  } finally {
    window.close()
  }
})

test('E2E 0.4.1 大量框选: 长选区按块翻译，浮层列出全部译文并报告段数', { skip }, async () => {
  const long = 'First sentence about the interface. Second sentence about the engines. '
    + 'Third sentence about the models. Fourth sentence about the hotkeys.'
  const dom = new JSDOM('<!doctype html><html><body><p id="p1">' + long + '</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings({ selChunkChars: 40, selMaxChars: 4000 }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const node = p1.firstChild
    loadClientInto(window).apply({})

    selectText(window, node, 0, node.nodeValue.length)
    p1.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))

    const root = window.document.getElementById('dsh-auto-translate-root')
    let pop = null
    assert.ok(await waitFor(() => { pop = root.shadowRoot.querySelector('.selpop'); return !!pop }, 3000), '浮层应出现')
    assert.ok(await waitFor(() => /共 \d+ 段/.test(pop.querySelector('.info').textContent), 6000),
      '浮层应报告分块数量，实际: ' + JSON.stringify(pop && pop.querySelector('.info').textContent))
    const dst = pop.querySelector('.dst').textContent
    const pieces = (dst.match(/ZH</g) || []).length
    assert.ok(pieces >= 2, '长选区应被分成多块翻译，实际块数: ' + pieces + ' / ' + JSON.stringify(dst))
    // 每一块都必须真的被翻到（不能只翻第一块就返回）
    assert.match(dst, /First sentence/, '第一块译文应包含原文第一块')
    assert.match(dst, /Fourth sentence/, '最后一块译文必须也在（不能只翻前一半）')
    const expectChunks = Number((pop.querySelector('.info').textContent.match(/共 (\d+) 段/) || [])[1])
    assert.equal(pieces, expectChunks, '译文块数应与报告的块数一致')
    assert.doesNotMatch(pop.querySelector('.info').textContent, /已按上限/, '未超上限不应提示截断')
  } finally {
    window.close()
  }
})

test('E2E 0.4.1 大量框选: 超过「框选上限」时按上限截断并明确提示', { skip }, async () => {
  const long = 'First sentence about the interface. Second sentence about the engines. '
    + 'Third sentence about the models. Fourth sentence about the hotkeys.'
  const dom = new JSDOM('<!doctype html><html><body><p id="p1">' + long + '</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings({ selMaxChars: 45, selChunkChars: 40 }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const node = p1.firstChild
    loadClientInto(window).apply({})

    selectText(window, node, 0, node.nodeValue.length)
    p1.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))

    const root = window.document.getElementById('dsh-auto-translate-root')
    let pop = null
    assert.ok(await waitFor(() => { pop = root.shadowRoot.querySelector('.selpop'); return !!pop }, 3000), '浮层应出现')
    assert.ok(await waitFor(() => /已按上限/.test(pop.querySelector('.info').textContent), 6000),
      '超上限必须提示截断，实际: ' + JSON.stringify(pop && pop.querySelector('.info').textContent))
    assert.match(pop.querySelector('.info').textContent, /前 45 字符/, '提示里应写明截断到的字符数')
    assert.match(pop.querySelector('.dst').textContent, /…$/, '被截断的译文应以省略号结束')
    assert.doesNotMatch(pop.querySelector('.dst').textContent, /hotkeys/, '上限之外的原文不应被翻译')
  } finally {
    window.close()
  }
})

test('E2E 0.4.1 覆盖范围: 外壳文字（按钮/侧栏）可悬停翻译，输入框与代码块仍不被翻', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body>'
    + '<button id="b"><span id="s">Settings</span></button>'
    + '<input id="i" value="Settings">'
    + '<code id="c">const settings = 1</code>'
    + '<p id="p">Settings are stored here.</p>'
    + '</body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings({ hoverDelayMs: 0 }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    loadClientInto(window).apply({})
    const s = window.document.getElementById('s')
    const codeNode = window.document.getElementById('c').firstChild
    const pNode = window.document.getElementById('p').firstChild
    const codeBefore = codeNode.nodeValue
    const pBefore = pNode.nodeValue

    // 外壳按钮里的文字（光 DOM）→ 悬停即翻
    s.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(s.firstChild.nodeValue), 3000),
      '外壳按钮文字应可悬停翻译，实际: ' + JSON.stringify(s.firstChild.nodeValue))

    // 代码块与其它块在同一段时间里不得被顺带翻译（覆盖率只补外壳，不越界）
    await sleep(400)
    assert.equal(codeNode.nodeValue, codeBefore, '代码块不得被翻译')
    assert.equal(pNode.nodeValue, pBefore, '没被悬停的段落不得被翻译')
  } finally {
    window.close()
  }
})

test('E2E 0.4.1 Web Component: shadow root 内部的文字也能悬停翻译，复位时标记一并清掉', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="host"></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings({ hoverDelayMs: 0 }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const host = window.document.getElementById('host')
    const sr = host.attachShadow({ mode: 'open' })
    const inner = window.document.createElement('div')
    const span = window.document.createElement('span')
    span.textContent = 'Settings panel inside a web component.'
    inner.appendChild(span)
    sr.appendChild(inner)

    const mod = loadClientInto(window)
    mod.apply({})

    span.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, composed: true }))
    assert.ok(await waitFor(() => /ZH</.test(span.firstChild.nodeValue), 3000),
      'shadow root 内的文字应可悬停翻译，实际: ' + JSON.stringify(span.firstChild.nodeValue))
    assert.equal(span.getAttribute('data-dsh-at'), 'translated', 'shadow 内被翻的那一块应被标记')

    // 还原 + 复位：两者都必须能穿透 shadow root（否则残留标记会让悬停静默失效）
    mod.__test.revertTranslatedNodes()
    assert.equal(span.firstChild.nodeValue, 'Settings panel inside a web component.', '应还原成原文')
    mod.__test.resetTranslationState()
    assert.equal(span.getAttribute('data-dsh-at'), null, 'shadow 内的标记必须被清掉')

    // 复位后再次悬停必须仍能翻译（旧 bug：records 空 + 残留标记 → 完全无反应）
    span.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, composed: true, relatedTarget: window.document.body }))
    await sleep(120)
    span.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, composed: true }))
    assert.ok(await waitFor(() => /ZH</.test(span.firstChild.nodeValue), 3000),
      '复位后再次悬停必须能翻译，实际: ' + JSON.stringify(span.firstChild.nodeValue))
  } finally {
    window.close()
  }
})

test('E2E 0.4.0 框选翻译: 「就地替换」后点击页面即还原原文', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><p id="p1">Hello world, this needs translation.</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings({ selectionMode: 'inline' }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const p1 = window.document.getElementById('p1')
    const mod = loadClientInto(window)
    mod.apply({})

    selectText(window, p1.firstChild, 0, 11)
    p1.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
    assert.ok(await waitFor(() => mod.__test.inlineCount() === 1, 4000), '应产生一处就地替换')
    const span = p1.querySelector('span[data-dsh-at-sel]')
    assert.ok(span, '原文位置应出现被替换的片段')
    assert.match(span.textContent, /ZH</, '片段内容应是译文')
    assert.equal(p1.textContent, 'ZH< Hello world >, this needs translation.', '其余原文保持不变')

    // 点击页面（面板之外）→ 还原
    window.document.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    assert.equal(mod.__test.inlineCount(), 0, '点击后应收回就地替换')
    assert.equal(p1.textContent, 'Hello world, this needs translation.', '应完整还原为原文')
  } finally {
    window.close()
  }
})

test('E2E 0.4.0 框选翻译: 输入框 / 代码块 / 面板自身的选区一律不翻', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><input id="i" value="Hello world"><pre id="c">const a = 1</pre><p id="p">Hello world, this needs translation.</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings())
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const mod = loadClientInto(window)
    mod.apply({})
    const t = mod.__test
    assert.equal(t.selectionBlocked(window.document.getElementById('c').firstChild.parentElement), true, '代码块不翻')
    assert.equal(t.selectionBlocked(window.document.getElementById('i')), true, '输入框不翻')
    assert.equal(t.selectionBlocked(window.document.getElementById('p')), false, '普通段落可翻')

    // 面板自身（Shadow DOM 宿主）也不翻
    const root = window.document.getElementById('dsh-auto-translate-root')
    assert.equal(t.selectionBlocked(root), true, '插件面板不翻自己')
  } finally {
    window.close()
  }
})

test('E2E 0.4.0 迁移: 旧的「自动/local」配置升级后变成「按需 + 本机离线」，绝不自动翻页', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><p id="p">Hello world, this needs translation.</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
  const { window } = dom
  try {
    // 老版本（v4）的设置：engine 是「自动全页翻译」那套取值
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 4, engine: 'local', target: 'zh', latinSource: 'en', hoverDelayMs: 0,
      minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const node = window.document.getElementById('p').firstChild
    const original = node.nodeValue
    const mod = loadClientInto(window)
    mod.apply({})

    assert.equal(mod.__test.settings.engine, 'hover', 'engine 必须归位为按需触发')
    assert.equal(mod.__test.settings.hoverEngine, 'local', '旧的 local/auto 应迁移成本机离线后端')
    assert.equal(mod.__test.settings.selectionMode, 'popup', '应写入框选模式的默认值')
    await sleep(600)
    assert.equal(node.nodeValue, original, '迁移后绝不自动翻译整页，实际: ' + JSON.stringify(node.nodeValue))
  } finally {
    window.close()
  }
})

test('E2E 0.4.0 迁移: 旧的「关闭」配置迁移后保持不翻译', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><p id="p">Hello world, this needs translation.</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 4, engine: 'off', target: 'zh', latinSource: 'en', minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
    }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const mod = loadClientInto(window)
    mod.apply({})
    assert.equal(mod.__test.settings.engine, 'hover')
    assert.equal(mod.__test.settings.enabled, false, '旧的「关闭」不得被悄悄打开')
  } finally {
    window.close()
  }
})

test('E2E 0.4.1 迁移: 沿用旧默认上限(1200)的用户被搬到 4000，自己改过的不动', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><p>Hello world.</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 5, engine: 'hover', hoverEngine: 'local', selectionMode: 'popup',
      selMaxChars: 1200, target: 'zh', latinSource: 'en', minChars: 2, lang: 'zh', enabled: true,
    }))
    const mod = loadClientInto(window)
    mod.apply({})
    assert.equal(mod.__test.settings.selMaxChars, 4000, '旧默认 1200 应被搬到 4000')
    assert.equal(mod.__test.settings.selChunkChars, 600, '应补上分块粒度默认值')
  } finally {
    window.close()
  }

  const dom2 = new JSDOM('<!doctype html><html><body><p>Hello world.</p></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true })
  const w2 = dom2.window
  try {
    w2.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 5, engine: 'hover', hoverEngine: 'local', selectionMode: 'popup',
      selMaxChars: 800, target: 'zh', latinSource: 'en', minChars: 2, lang: 'zh', enabled: true,
    }))
    const mod2 = loadClientInto(w2)
    mod2.apply({})
    assert.equal(mod2.__test.settings.selMaxChars, 800, '用户自己改过的上限不得被迁移覆盖')
  } finally {
    w2.close()
  }
})

test('E2E 0.4.0: 头部模式条反映「由谁翻 + 框选方式」，且不再有自动引擎选择器', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><p>Hello world.</p></body></html>', { url: 'http://127.0.0.1:3080/' })
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, hoverSettings({ selectionMode: 'inline' }))
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 120, height: 20, top: 0, left: 0, right: 120, bottom: 20, x: 0, y: 0 }
    }
    const mod = loadClientInto(window)
    mod.apply({})
    const root = window.document.getElementById('dsh-auto-translate-root')
    const card = root.shadowRoot.querySelector('.card')
    assert.ok(card, '面板应存在')
    assert.equal(card.querySelector('[data-set="engine"]'), null, '0.4.0 起不再提供「自动翻译」引擎选择器')
    assert.ok(card.querySelector('[data-set="hoverEngine"]'), '应提供「由谁翻」的后端选择器')
    assert.equal(card.querySelectorAll('details.grp').length, 4, '常用/引擎/高级/诊断 四个可折叠分组')
    assert.equal(card.querySelector('details.grp[open]').getAttribute('data-grp'), 'common', '默认只展开「常用」')

    const line = card.querySelector('[data-el="modeText"]').textContent
    assert.match(line, /就地替换/, '模式条应显示框选方式，实际: ' + line)
    assert.match(mod.__test.modeText(), /本机离线/, '模式条应显示当前后端，实际: ' + mod.__test.modeText())
  } finally {
    window.close()
  }
})

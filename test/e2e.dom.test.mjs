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

test('E2E: 翻译 → 悬停切回原文 → 观察者不覆盖 → 再悬停切回译文', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"><p id="t">Hello world, this needs translation.</p></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 4, engine: 'local', target: 'zh', latinSource: 'en', hoverDelayMs: 0, minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
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

    // 1) 自动翻译（需等 400ms 稳定期 + 一次"翻译"往返）
    assert.ok(await waitFor(() => node.nodeValue !== original), '应在稳定期后完成翻译，实际: ' + JSON.stringify(node.nodeValue))
    assert.match(node.nodeValue, /ZH</, '应写入译文')
    assert.equal(p.getAttribute('data-dsh-at'), 'translated', '宿主元素应被标记')

    // 2) 悬停 → 切回原文
    p.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => node.nodeValue === original, 2500), '悬停后应切回原文，实际: ' + JSON.stringify(node.nodeValue))

    // 3) 关键回归：等远超稳定窗口，确认观察者没有把原文覆盖成译文
    await sleep(1300)
    assert.equal(node.nodeValue, original, '切回原文后必须保持原文（观察者不得覆盖）')

    // 4) 移开再悬停 → 切回译文
    p.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body }))
    await sleep(60)
    p.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 2500), '再次悬停应切回译文，实际: ' + JSON.stringify(node.nodeValue))
  } finally {
    window.close()
  }
})

test('E2E: 流式追加的文本只在稳定后才翻译（不与追加剧烈打架）', { skip }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><p id="s">Streaming</p></body></html>', { url: 'http://127.0.0.1:3080/' })
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 4, engine: 'local', target: 'zh', latinSource: 'en', minChars: 2, lang: 'zh', enabled: true, cacheLimit: 50,
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
    // 追加剧烈期间不应写入译文（否则会与追加互相覆盖）
    await sleep(120)
    assert.equal(node.nodeValue, settled, '追加期间不应改写文本')
    // 停止追加后，应在稳定期内被翻译
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 3000), '停止追加后应翻译，实际: ' + JSON.stringify(node.nodeValue))
  } finally {
    window.close()
  }
})

test('E2E: 切换引擎时必须先把已翻译的页面还原成原文（不留孤儿译文）', { skip }, async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="a"><p id="p1">Hello world, this needs translation.</p></div></body></html>',
    { url: 'http://127.0.0.1:3080/', pretendToBeVisual: true },
  )
  const { window } = dom
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      version: 4, engine: 'local', target: 'zh', latinSource: 'en',
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

    // 等自动翻译把这一块翻出来
    assert.ok(await waitFor(() => /ZH</.test(node.nodeValue), 4000), '应该自动翻译，实际: ' + JSON.stringify(node.nodeValue))

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

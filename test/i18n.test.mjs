/**
 * i18n 完整性测试：面板/状态行用到的每个 key，都必须在 zh 与 en 两个语言包里存在。
 * 漏翻在运行时会显示成 key 名（如 stEngine），在浏览器里很难被发现。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'client.js'), 'utf8')

function collectKeys() {
  const keys = new Set()
  let m
  const reAttr = /data-i18n(?:-html)?="([^"]+)"/g
  while ((m = reAttr.exec(src))) keys.add(m[1])
  // 解析 t('key') —— 用 split，避免正则里的引号转义问题
  const parts = src.split("t('")
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]
    const before = prev.charAt(prev.length - 1)
    if (/[A-Za-z0-9_$]/.test(before)) continue   // 排除 createElement('div') 这类误匹配
    const end = parts[i].indexOf("'")
    if (end < 0) continue
    const k = parts[i].slice(0, end)
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) keys.add(k)
  }
  return keys
}

test('i18n: 每个 key 都有 zh 与 en 两个语言包', () => {
  const keys = collectKeys()
  assert.ok(keys.size > 40, 'i18n key 数量异常: ' + keys.size)
  const missing = []
  for (const k of keys) {
    const count = src.split(k + ": '").length - 1
    if (count < 2) missing.push(k + ' (found ' + count + ')')
  }
  assert.deepEqual(missing, [], '缺少语言包的 key: ' + missing.join(', '))
})

test('i18n: 语言选择器提供 auto/zh/en', () => {
  assert.match(src, /data-set="lang"/)
  assert.match(src, /lang: 'auto'/)
})

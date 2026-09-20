#!/usr/bin/env node
/**
 * 重新生成 vendor/：transformers.js 浏览器 ESM + ONNX Runtime 的 wasm。
 * 仓库可以不带这些大文件，克隆后执行 `npm run fetch-vendor` 即可。
 *
 * 依赖：Node 20+；系统自带 tar（Windows 10+ / macOS / Linux 均有）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join(ROOT, 'vendor')
const ORT_DIR = join(VENDOR, 'ort')

const TRANSFORMERS_VERSION = '4.2.0'
const ORT_VERSION = '1.26.0-dev.20260416-b7804b056c'
const ORT_FILES = [
  'ort.webgpu.min.mjs',
  'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jspi.mjs', 'ort-wasm-simd-threaded.jspi.wasm',
]

const tmp = join(tmpdir(), 'dsh-at-vendor-' + Date.now())
mkdirSync(tmp, { recursive: true })
mkdirSync(ORT_DIR, { recursive: true })

console.log('· 下载 transformers.js 浏览器 ESM（jsdelivr 预打包版）…')
const esmUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@' + TRANSFORMERS_VERSION + '/+esm'
let esm = await (await fetch(esmUrl)).text()
esm = esm
  .split('"/npm/onnxruntime-web@' + ORT_VERSION + '/webgpu/+esm"').join('"./ort/ort.webgpu.min.mjs"')
  .split('"/npm/onnxruntime-common/+esm"').join('"./ort/ort.webgpu.min.mjs"')
writeFileSync(join(VENDOR, 'transformers.esm.v2.js'), esm)

console.log('· 下载 onnxruntime-web@' + ORT_VERSION + ' …')
const tgz = join(tmp, 'ort.tgz')
const res = await fetch('https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-' + ORT_VERSION + '.tgz')
writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' })
for (const name of ORT_FILES) {
  const src = join(tmp, 'package', 'dist', name)
  if (!existsSync(src)) { console.warn('  ! 缺少 ' + name); continue }
  writeFileSync(join(ORT_DIR, name), readFileSync(src))
  console.log('  + ' + name)
}
rmSync(tmp, { recursive: true, force: true })
console.log('完成：vendor/ 已就绪（worker.v5.js 随仓库提供，无需生成）')

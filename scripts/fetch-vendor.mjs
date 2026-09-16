#!/usr/bin/env node
/**
 * 閲嶆柊鐢熸垚 vendor/锛歵ransformers.js 娴忚鍣?ESM + ONNX Runtime 鐨?wasm銆? * 浠撳簱鍙互涓嶅甫杩欎簺澶ф枃浠讹紝鍏嬮殕鍚庢墽琛?`npm run fetch-vendor` 鍗冲彲銆? *
 * 渚濊禆锛歂ode 20+锛涚郴缁熻嚜甯?tar锛圵indows 10+ / macOS / Linux 鍧囨湁锛夈€? */
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

console.log('路 涓嬭浇 transformers.js 娴忚鍣?ESM锛坖sdelivr 棰勬墦鍖呯増锛夆€?)
const esmUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@' + TRANSFORMERS_VERSION + '/+esm'
let esm = await (await fetch(esmUrl)).text()
esm = esm
  .split('"/npm/onnxruntime-web@' + ORT_VERSION + '/webgpu/+esm"').join('"./ort/ort.webgpu.min.mjs"')
  .split('"/npm/onnxruntime-common/+esm"').join('"./ort/ort.webgpu.min.mjs"')
writeFileSync(join(VENDOR, 'transformers.esm.v2.js'), esm)

console.log('路 涓嬭浇 onnxruntime-web@' + ORT_VERSION + ' 鈥?)
const tgz = join(tmp, 'ort.tgz')
const res = await fetch('https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-' + ORT_VERSION + '.tgz')
writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' })
for (const name of ORT_FILES) {
  const src = join(tmp, 'package', 'dist', name)
  if (!existsSync(src)) { console.warn('  ! 缂哄皯 ' + name); continue }
  writeFileSync(join(ORT_DIR, name), readFileSync(src))
  console.log('  + ' + name)
}
rmSync(tmp, { recursive: true, force: true })
console.log('瀹屾垚锛歷endor/ 宸插氨缁紙worker.v5.js 闅忎粨搴撴彁渚涳紝鏃犻渶鐢熸垚锛?)


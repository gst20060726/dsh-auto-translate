/**
 * dsh-auto-translate — 宿主半（host half）
 *
 * 插件本体在浏览器半（client.js / vendor/worker.js）：界面文本就地翻译 + 悬停切换。
 * 宿主半只做一件事：把插件自带的 vendor 目录（transformers.js 库 + ONNX Runtime
 * 的 wasm）以静态路由挂在 DSH web 服务器上，让浏览器半能同源加载它们。
 *
 * 本地引擎的全部推理都在浏览器里完成：不注册工具、不调用任何 LLM、
 * 不产生 token 消耗；模型文件由浏览器直接从 hf-mirror.com 拉取并缓存，
 * 服务器不代理、不落盘。
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { homedir } from 'node:os'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-auto-translate'
// 必须显式注入 webServer：否则本插件的 apply 先于 web 服务器提供该服务，
// 拿到的是 undefined，静态路由永远注册不上（客户端就会 "Failed to fetch"）。
export const inject = ['webServer']

const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vendor')
const ROUTE_PREFIX = '/dsh-auto-translate/vendor'
// 模型同源代理：hf-mirror 的 resolve 链接会 307 跳到 /api/resolve-cache/…，
// 跨域重定向后 CORS 头不可靠（浏览器报 Failed to fetch），故由宿主半转发。
const MODEL_PREFIX = '/dsh-auto-translate/model-v2'
const DIAG_PATH = '/dsh-auto-translate/diag'
const DIAG_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-auto-translate')
// 模型磁盘缓存：一次下好（带断点续传与重试），之后从本地磁盘直接发，避免流式转发时上游卡死
const MODEL_CACHE_DIR = join(DIAG_DIR, 'models')
const MODEL_UPSTREAM = 'https://hf-mirror.com'
const ALLOWED_REPOS = new Set([
	'Xenova/opus-mt-en-zh',
	'Xenova/opus-mt-zh-en',
	'Xenova/nllb-200-distilled-600M',
])

// 客户端诊断落盘：用户点「保存诊断到本机」→ 写文件，便于排障时直接读盘（不必复制长文本）
async function saveDiag(req, res) {
	try {
		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		const body = Buffer.concat(chunks).toString('utf8').slice(0, 500000)
		mkdirSync(DIAG_DIR, { recursive: true })
		const stamp = new Date().toISOString().replace(/[:.]/g, '-')
		const file = join(DIAG_DIR, 'diagnose-' + stamp + '.json')
		writeFileSync(file, body)
		console.log('[dsh-auto-translate] diagnose saved: ' + file)
		res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
		res.end(JSON.stringify({ ok: true, file }))
	} catch (err) {
		try {
			res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
			res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
		} catch { /* response already gone */ }
	}
}

async function downloadToCache(rel) {
	const dest = join(MODEL_CACHE_DIR, rel)
	mkdirSync(dirname(dest), { recursive: true })
	const tmp = dest + '.part'
	let attempt = 0
	let offset = 0
	try { offset = statSync(tmp).size } catch { offset = 0 }
	while (attempt < 12) {
		attempt++
		try {
			const headers = { 'User-Agent': 'dsh-auto-translate/0.4' }
			if (offset > 0) headers.Range = 'bytes=' + offset + '-'
			const res = await fetch(MODEL_UPSTREAM + '/' + rel, { headers, redirect: 'follow', signal: AbortSignal.timeout(45000) })
			if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status)
			if (offset > 0 && res.status === 200) offset = 0
			const ws = createWriteStream(tmp, { flags: offset > 0 ? 'a' : 'w' })
			for await (const chunk of res.body) {
				if (!ws.write(chunk)) await once(ws, 'drain')
				offset += chunk.length
			}
			ws.end()
			await once(ws, 'finish')
			renameSync(tmp, dest)
			console.log('[dsh-auto-translate] cached ' + rel + ' (' + Math.round(offset / 1048576) + ' MB, attempt ' + attempt + ')')
			return
		} catch (err) {
			console.log('[dsh-auto-translate] download retry ' + attempt + ' for ' + rel + ' @' + Math.round(offset / 1048576) + 'MB — ' + String((err && err.message) || err))
			await new Promise((r) => setTimeout(r, 1200))
		}
	}
	throw new Error('download failed after ' + attempt + ' attempts: ' + rel)
}

async function proxyModel(req, res) {
	try {
		const url = new URL(req.url ?? '/', 'http://localhost')
		const rel = decodeURIComponent(url.pathname.slice(MODEL_PREFIX.length)).replace(/^\/+/, '')
		const repo = rel.split('/').slice(0, 2).join('/')
		if (!ALLOWED_REPOS.has(repo)) {
			res.writeHead(403, { 'Content-Type': 'text/plain' })
			res.end('repo not allowed')
			return
		}
		const cached = join(MODEL_CACHE_DIR, rel)
		const cachedOk = existsSync(cached) && statSync(cached).size > 0
		console.log('[dsh-auto-translate] model ' + (cachedOk ? 'HIT ' : 'MISS ') + rel)
		if (!cachedOk) await downloadToCache(rel)
		const size = statSync(cached).size
		res.writeHead(200, {
			'Content-Type': rel.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream',
			'Content-Length': size,
			'Cache-Control': 'public, max-age=86400',
			'Accept-Ranges': 'bytes',
		})
		if (req.method === 'HEAD') {
			res.end()
			return
		}
		createReadStream(cached).pipe(res)
	} catch (err) {
		try {
			res.writeHead(502, { 'Content-Type': 'text/plain' })
			res.end('model proxy error: ' + String((err && err.message) || err))
		} catch { /* response already gone */ }
	}
}
const CONTENT_TYPES = {
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.cjs': 'text/javascript; charset=utf-8',
	'.wasm': 'application/wasm',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
}

function serveVendor(req, res) {
	try {
		const url = new URL(req.url ?? '/', 'http://localhost')
		let rel = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length))
		rel = rel.replace(/^\/+/, '')
		if (rel === '' || rel.includes('\u0000')) {
			res.writeHead(400, { 'Content-Type': 'text/plain' })
			res.end('bad path')
			return
		}
		const file = normalize(join(VENDOR_DIR, rel))
		if (file !== VENDOR_DIR && !file.startsWith(VENDOR_DIR + sep)) {
			res.writeHead(403, { 'Content-Type': 'text/plain' })
			res.end('forbidden')
			return
		}
		if (!existsSync(file) || !statSync(file).isFile()) {
			res.writeHead(404, { 'Content-Type': 'text/plain' })
			res.end('not found')
			return
		}
		const ext = extname(file).toLowerCase()
		res.writeHead(200, {
			'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
			// wasm 体积大且随 ORT 版本固定 → 长缓存；脚本类每次校验（便于热修，无需改名绕缓存）
			'Cache-Control': ext === '.wasm' ? 'public, max-age=31536000, immutable' : 'no-cache',
			'Cross-Origin-Resource-Policy': 'same-origin',
		})
		createReadStream(file).pipe(res)
	} catch (err) {
		try {
			res.writeHead(500, { 'Content-Type': 'text/plain' })
			res.end('error')
		} catch { /* response already gone */ }
		void err
	}
}

export function apply(ctx) {
	let registered = false
	const tryRegister = () => {
		// Cordis: 未注入(inject)且服务尚未注册时, 访问 ctx.webServer / ctx.get('webServer')
		// 会抛 "cannot get property ... without inject" 而非返回 undefined, 这里捕获即可。
		let webServer = null
		try {
			webServer = ctx.webServer ?? ctx.get?.('webServer')
		} catch {
			webServer = null
		}
		if (!webServer || registered) return false
		registered = true
		webServer.register({
			kind: 'prefix',
			path: ROUTE_PREFIX,
			handler: (req, res) => {
				if (req.method !== 'GET' && req.method !== 'HEAD') {
					res.writeHead(405, { 'Content-Type': 'text/plain' })
					res.end('method not allowed')
					return
				}
				serveVendor(req, res)
			},
		})
		webServer.register({
			kind: 'prefix',
			path: MODEL_PREFIX,
			handler: (req, res) => {
				if (req.method !== 'GET' && req.method !== 'HEAD') {
					res.writeHead(405, { 'Content-Type': 'text/plain' })
					res.end('method not allowed')
					return
				}
				proxyModel(req, res)
			},
		})
		webServer.register({
			kind: 'exact',
			path: DIAG_PATH,
			handler: (req, res) => {
				if (req.method !== 'POST') {
					res.writeHead(405, { 'Content-Type': 'text/plain' })
					res.end('method not allowed')
					return
				}
				saveDiag(req, res)
			},
		})
		console.log('[dsh-auto-translate] routes registered: ' + ROUTE_PREFIX + ' , ' + MODEL_PREFIX + ' , ' + DIAG_PATH + ' -> ' + DIAG_DIR)
		return true
	}

	// webServer 可能晚于本插件提供（base bundle 层先挂载），轮询等待。
	if (!tryRegister()) {
		const timer = setInterval(() => {
			if (tryRegister()) clearInterval(timer)
		}, 500)
		setTimeout(() => clearInterval(timer), 120000)
	}
}

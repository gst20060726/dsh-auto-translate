/**
 * dsh-auto-translate — 浏览器半（client half）
 *
 * 设计原则：零 token。绝不调用任何 LLM / DSH 模型接口，只用
 *   1) Chrome 138+ 内置端侧 Translator / LanguageDetector（本地模型，离线，免费）
 *   2) 可选的用户自建 HTTP 翻译端点（默认关闭）
 *   3) 内存 + localStorage 译文缓存（同一句永不重复翻译）
 *
 * 行为：把界面上检测到的“外语”文本就地替换为目标语言译文；
 *       鼠标在译文所在元素上悬停 hoverDelayMs 后，在“原文 / 译文”之间来回切换。
 */
window.__ModuleLoader__.load({
	id: 'dsh-auto-translate',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		// ===================== 配置 =====================
		var SETTINGS_KEY = 'dsh-auto-translate.settings.v1';
		var CACHE_KEY = 'dsh-auto-translate.cache.v1';
		var ROOT_ID = 'dsh-auto-translate-root';
		var DEFAULTS = {
			enabled: true,
			target: 'zh',
			hoverDelayMs: 600,
			engine: 'hover',         // hover(按需悬停翻译) | auto | ondevice | online | custom | local | off
			hoverEngine: 'local',    // 悬停模式实际用哪个引擎：local | online | custom
			onlineOrder: 'mymemory', // mymemory(此网络可达) | google(部分网络不可达)
			endpoint: '',            // 自定义端点模板：https://host/translate?q={text}&target={target}&source={source}
			maxChunk: 1000,
			maxChars: 40000,         // 单次会话翻译字符上限（保护免费额度）
			localWarmOnce: false,    // 曾成功加载过本机模型（用于启动自动预热，避免每次刷新都回退在线）
			lang: 'auto',            // auto | zh | en
			hotkeySummon: 'Ctrl+Alt+T', // 呼出翻译面板
			hotkeyHide: 'Ctrl+Alt+H',   // 显示/隐藏小圆点
			hotkeyPause: 'Ctrl+Alt+P',  // 暂停/恢复翻译
			version: 3,
			latinSource: 'en',       // 拉丁字母文本假定的源语言；auto = 用端侧检测器
			minChars: 2,
			maxNodes: 60,
			cacheLimit: 4000,
			workerMode: 'auto',      // auto(优先 SharedWorker) | shared | dedicated
			multiMode: 'two-hop',    // 多语种策略：two-hop(便宜快) | nllb(质量好, fp32 约 5GB)
			translateCode: false,    // 是否连 <pre>/<code>（思考过程常在这里）一起翻译
			chipCompact: true,       // 默认缩成小圆点，避免遮挡其他按钮
			chipHidden: false,       // Ctrl+Shift+H 可整只隐藏
			chipPos: null            // 拖拽后记住 {left, top}
		};
		var TARGETS = [['zh', '简体中文'], ['zh-Hant', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'],
			['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский'], ['pt', 'Português'], ['it', 'Italiano'], ['ar', 'العربية'],
			['hi', 'हिन्दी'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['tr', 'Türkçe'], ['id', 'Bahasa Indonesia'], ['nl', 'Nederlands'], ['pl', 'Polski']];
		var LATIN_TARGETS = { en: 1, fr: 1, de: 1, es: 1, pt: 1, it: 1, vi: 1, id: 1, tr: 1, pl: 1, nl: 1, ms: 1, cs: 1, ro: 1, hu: 1, sv: 1, da: 1, fi: 1, no: 1 };

		function loadSettings() {
			try {
				var raw = localStorage.getItem(SETTINGS_KEY);
				return Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {});
			} catch (e) {
				return Object.assign({}, DEFAULTS);
			}
		}
		function saveSettings() {
			try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { }
		}
		var settings = loadSettings();
		// v2 迁移：旧版默认「端侧」在本机网络下模型无法下载（Google 组件不可达）→ 自动切「自动」
		if (!settings.version || settings.version < 2) {
			settings.version = 2;
			if (settings.engine === 'ondevice') settings.engine = 'auto';
			saveSettings();
		}
		if (!settings.version || settings.version < 3) {
			settings.version = 3;
			settings.chipHidden = false;   // 曾被隐藏的小圆点重新出现，避免"找不到入口"
			saveSettings();
		}
		// v4 迁移：默认行为从「自动全页翻译」改为「悬停才翻译」
		if (!settings.version || settings.version < 4) {
			settings.version = 4;
			settings.engine = 'hover';
			saveSettings();
		}

		// ===================== 译文缓存 =====================
		var cache = new Map();
		try {
			var rawCache = localStorage.getItem(CACHE_KEY);
			if (rawCache) {
				var parsed = JSON.parse(rawCache);
				for (var k in parsed) cache.set(k, parsed[k]);
			}
		} catch (e) { }
		var cacheDirty = false;
		function cacheGet(key) { return cache.get(key); }
		// ===== 跨标签页协作：共享译文缓存，避免同一句话在多个标签里各翻一遍 =====
		var bc = null, bcPeers = 0, bcBroadcastTimer = null;
		try { bc = new BroadcastChannel('dsh-auto-translate'); } catch (e) { bc = null; }
		if (bc) {
			bc.onmessage = function (ev) {
				var m = ev.data || {};
				if (m.type === 'hello') { bcPeers++; updateStatus(); try { bc.postMessage({ type: 'here' }) } catch (e) { } return; }
				if (m.type === 'here') { bcPeers++; updateStatus(); return; }
				if (m.type === 'cache-batch' && m.entries) {
					for (var k in m.entries) { if (!cache.has(k)) { cache.set(k, m.entries[k]); cacheDirty = true; } }
					return;
				}
			};
			try { bc.postMessage({ type: 'hello' }) } catch (e) { }
		}
		function broadcastCache() {
			if (!bc || bcBroadcastTimer) return;
			bcBroadcastTimer = setTimeout(function () {
				bcBroadcastTimer = null;
				try {
					var entries = {};
					var n = 0;
					cache.forEach(function (v, k) { if (n++ < 200) entries[k] = v; });
					if (n) bc.postMessage({ type: 'cache-batch', entries: entries });
				} catch (e) { }
			}, 2000);
		}
		function cacheSet(key, value) {
			if (cache.size >= settings.cacheLimit) {
				var oldest = cache.keys().next().value;
				if (oldest !== undefined) cache.delete(oldest);
			}
			cache.set(key, value);
			cacheDirty = true;
			broadcastCache();
		}
		function cacheFlush() {
			if (!cacheDirty) return;
			cacheDirty = false;
			try {
				var obj = {};
				cache.forEach(function (v, k) { obj[k] = v; });
				localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
			} catch (e) { }
		}
		setInterval(cacheFlush, 8000);
		function cacheKey(text, src, tgt) { return tgt + '\u0001' + src + '\u0001' + text; }

		// ===================== 语言判定（纯本地启发式，零成本） =====================
		var SCRIPTS = [
			['ja', /[\u3040-\u30ff]/],
			['ko', /[\uac00-\ud7af\u1100-\u11ff]/],
			['zh', /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/],
			['ru', /[\u0400-\u04ff]/],
			['ar', /[\u0600-\u06ff\u0750-\u077f]/],
			['he', /[\u0590-\u05ff]/],
			['hi', /[\u0900-\u097f]/],
			['th', /[\u0e00-\u0e7f]/],
			['el', /[\u0370-\u03ff]/],
			['latin', /[A-Za-z\u00c0-\u024f]/]
		];
		function scriptTag(text) {
			var cjk = 0;
			for (var i = 0; i < SCRIPTS.length; i++) {
				if (SCRIPTS[i][1].test(text)) return SCRIPTS[i][0];
			}
			return null;
		}

		// 端侧语言检测器（可选；仅用于拉丁字母之间的判别）
		var detectorPromise = null, detectorDisabled = false;
		function getDetector() {
			if (detectorDisabled) return Promise.resolve(null);
			if (detectorPromise) return detectorPromise;
			detectorPromise = (async function () {
				try {
					var D = (typeof self.LanguageDetector === 'function' && self.LanguageDetector) || (self.ai && self.ai.languageDetector) || null;
					if (!D) { detectorDisabled = true; return null; }
					if (D.availability) {
						var av = await withTimeout(D.availability(), 3000, 'detector.availability');
						if (av === 'unavailable') { detectorDisabled = true; return null; }
					}
					return await withTimeout(D.create(), 5000, 'detector.create');
				} catch (e) {
					detectorDisabled = true;   // 语言包不可达时不再反复尝试，避免拖慢/挂起
					return null;
				}
			})();
			return detectorPromise;
		}
		var latinDetectCache = new Map();
		async function detectLatin(text) {
			var key = text.slice(0, 200);
			if (latinDetectCache.has(key)) return latinDetectCache.get(key);
			var out = null;
			try {
				var d = await getDetector();
				if (d) {
					var results = await d.detect(text.slice(0, 400));
					var best = Array.isArray(results) && results.length ? results[0] : null;
					if (best && typeof best.detectedLanguage === 'string' && (best.confidence === undefined || best.confidence >= 0.5)) {
						out = best.detectedLanguage.split('-')[0];
					}
				}
			} catch (e) { out = null; }
			if (latinDetectCache.size > 500) latinDetectCache.clear();
			latinDetectCache.set(key, out);
			return out;
		}

		// ===================== 翻译引擎 =====================
		function translatorCtor() {
			if (typeof self.Translator === 'function') return self.Translator;
			if (self.ai && self.ai.translator && typeof self.ai.translator.create === 'function') return self.ai.translator;
			return null;
		}
		var translators = new Map();
		function getTranslator(src, tgt) {
			var T = translatorCtor();
			if (!T) return Promise.reject(new Error('on-device Translator 不可用'));
			var key = src + '>' + tgt;
			var pending = translators.get(key);
			if (!pending) {
				pending = (async function () {
					if (T.availability) {
						var av = await T.availability({ sourceLanguage: src, targetLanguage: tgt });
						if (av === 'unavailable') throw new Error('该语言对不支持：' + src + '>' + tgt);
					}
					return await T.create({ sourceLanguage: src, targetLanguage: tgt });
				})();
				translators.set(key, pending);
			}
			return pending;
		}
		async function onDeviceTranslate(text, src, tgt) {
			var tr = await getTranslator(src, tgt);
			return String(await tr.translate(text)).trim();
		}
		async function httpTranslate(text, src, tgt) {
			var tpl = settings.endpoint;
			if (!tpl) throw new Error('未配置 HTTP 端点');
			var url = tpl.replace('{text}', encodeURIComponent(text)).replace('{target}', encodeURIComponent(tgt)).replace('{source}', encodeURIComponent(src));
			var res = await fetch(url, { method: 'GET' });
			if (!res.ok) throw new Error('HTTP ' + res.status);
			var ct = res.headers.get('content-type') || '';
			if (ct.indexOf('json') >= 0) {
				var j = await res.json();
				return String(j.translatedText || j.translation || j.text || j.result || '').trim();
			}
			return (await res.text()).trim();
		}
		// —— 在线免密钥兜底：不是 LLM，不消耗模型 token；文本会发往对应服务 ——
		async function googleTranslate(text, src, tgt) {
			var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + encodeURIComponent(src) + '&tl=' + encodeURIComponent(tgt) + '&q=' + encodeURIComponent(text);
			var res = await fetch(url);
			if (!res.ok) throw new Error('google ' + res.status);
			var data = await res.json();
			var segs = (data && data[0]) || [];
			var out = '';
			for (var i = 0; i < segs.length; i++) { if (segs[i] && segs[i][0]) out += segs[i][0]; }
			return out.trim();
		}
		function mmLang(code) {
			var c = String(code);
			if (c === 'zh') return 'zh-CN';
			if (c === 'zh-Hant') return 'zh-TW';
			return c;
		}
		function decodeEntities(s) {
			return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
		}
		async function mymemoryTranslate(text, src, tgt) {
			var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent(mmLang(src)) + '|' + encodeURIComponent(mmLang(tgt));
			var res = await fetch(url);
			if (!res.ok) throw new Error('mymemory ' + res.status);
			var j = await res.json();
			var out = j && j.responseData && j.responseData.translatedText;
			if (!out || j.quotaFinished || (j.responseStatus && j.responseStatus !== 200)) throw new Error('mymemory 限流或无结果');
			return decodeEntities(out).trim();
		}
		async function onlineTranslate(text, src, tgt) {
			if (settings.onlineOrder === 'google') {
				try { return await googleTranslate(text, src, tgt); } catch (e) { return await mymemoryTranslate(text, src, tgt); }
			}
			try { return await mymemoryTranslate(text, src, tgt); } catch (e) { return await googleTranslate(text, src, tgt); }
		}
		function chunkText(text, size) {
			if (text.length <= size) return [text];
			var parts = [], rest = text;
			while (rest.length > size) {
				var cut = rest.lastIndexOf(' ', size);
				if (cut < size * 0.5) cut = size;
				parts.push(rest.slice(0, cut));
				rest = rest.slice(cut);
			}
			if (rest) parts.push(rest);
			return parts;
		}
		async function translateLong(fn, text, src, tgt, size) {
			var chunks = chunkText(text, Math.max(200, size || settings.maxChunk || 1000));
			if (chunks.length === 1) return fn(text, src, tgt);
			var out = [];
			for (var i = 0; i < chunks.length; i++) {
				out.push(await fn(chunks[i], src, tgt));
			}
			return out.join(' ').trim();
		}
		// 本次会话字符上限只对「会产生外部额度/带宽成本」的引擎有意义：
		// 本机离线(WASM)与浏览器端侧都是零成本、不出网，不该被熔断线拦住
		// （auto 模式下本机模型就绪后同样零成本，故也不设限）。
		function sessionLimitActive() {
			var m = settings.engine;
			return m === 'online' || m === 'custom';
		}
		function sessionLimit() {
			if (!sessionLimitActive()) return 0;
			return Math.max(0, Number(settings.maxChars) || 0);
		}
		// 悬停模式下的「实际引擎」：由面板上的「切到本机」/「切到在线引擎」决定，默认本机离线
		// （刷新后若模型已在缓存里，本机离线是零成本且不出网的选择）
		function actualModeFor(node) {
			if (settings.engine !== 'hover') return settings.engine;
			var m = settings.hoverEngine;
			if (m !== 'local' && m !== 'online' && m !== 'custom') m = 'local';
			return m;
		}
		async function translateText(text, src, tgt) {
			var mode = settings.engine;
			if (mode === 'local') return translateLong(localTranslate, text, src, tgt, 600);
			if (mode === 'auto') {
				if (localWarm) {
					try { return await translateLong(localTranslate, text, src, tgt, 600); }
					catch (e) { lastError = '本机离线失败(' + ((e && e.message) || e) + ') → 在线'; }
				}
				// 在线放前面：端侧在本网络会长时间挂起（语言包下载不可达）
				try {
					stats.fellBack++;
					return await withTimeout(translateLong(onlineTranslate, text, src, tgt, 480), 12000, '在线翻译');
				} catch (e) {
					lastError = '在线失败(' + ((e && e.message) || e) + ') → 端侧';
				}
				if (!onDeviceDisabled) {
					try { return await withTimeout(onDeviceTranslate(text, src, tgt), 8000, '端侧翻译'); }
					catch (e) {
						onDeviceFailures++;
						if (onDeviceFailures >= 3) onDeviceDisabled = true;
						lastError = '端侧不可用(' + ((e && e.message) || e) + ') → 本机离线模型';
					}
				}
				stats.fellBack++;
				return await translateLong(localTranslate, text, src, tgt, 600);
			}
			if (mode === 'custom' || mode === 'http') return translateLong(httpTranslate, text, src, tgt);
			if (mode === 'online') return withTimeout(translateLong(onlineTranslate, text, src, tgt, 480), 12000, '在线翻译');
			if (mode === 'ondevice') return withTimeout(onDeviceTranslate(text, src, tgt), 8000, '端侧翻译');
			if (mode === 'off') return text;
			// 悬停模式：engine 本身只是「触发方式」，真正用哪个引擎看宿主上的标记；默认本机离线
			return translateLong(localTranslate, text, src, tgt, 600);
		}

		// 决定这句是否需要翻译，以及源语言是什么
		async function planSource(text) {
			var tgtBase = String(settings.target).split('-')[0];
			var tag = scriptTag(text);
			if (!tag) return null;
			if (tag === tgtBase) return null;
			if (tag === 'latin') {
				var detected = await detectLatin(text);
				if (detected) return detected === tgtBase ? null : detected;
				if (LATIN_TARGETS[tgtBase]) return null;           // 目标也是拉丁语言且无法判别 → 保守跳过
				// 检测器不可用（本网络下 Edge/Chrome 的端侧语言包同样拉不到）时，
				// auto 一律按英语处理——绝不能把字符串 'auto' 当源语言丢给模型。
				return settings.latinSource === 'auto' ? 'en' : settings.latinSource;
			}
			return tag;
		}

		// ===================== DOM 处理 =====================
		var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1, VAR: 1, SVG: 1, MATH: 1, CANVAS: 1, IMG: 1, VIDEO: 1, AUDIO: 1, IFRAME: 1, TEMPLATE: 1 };
		var processed = new WeakSet();
		var queued = new WeakSet();
		var dirtyNodes = new Map();      // 正在流式改写的节点 → 最后变动时间（等它稳定再翻，避免与追加剧烈打架）
		var selfWrites = new WeakMap();  // 我们刚写过的节点 → 时间戳（避免把"自己的写入"当成新内容重翻）
		var settleTimer = null;
		var skipReasons = {};            // 诊断用：为什么这段文本没被翻译
		function bumpSkip(el, why) {
			var k = why || ('tag:' + ((el && el.tagName) || '?'));
			skipReasons[k] = (skipReasons[k] || 0) + 1;
		}
		function markDirty(node) {
			if (!node || node.nodeType !== 3) return;
			dirtyNodes.set(node, Date.now());
			if (!settleTimer) settleTimer = setInterval(sweepDirty, 300);
		}
		function sweepDirty() {
			var now = Date.now();
			var ready = [];
			dirtyNodes.forEach(function (ts, node) {
				if (!node.isConnected) { dirtyNodes.delete(node); return; }
				if (now - ts >= 400) ready.push(node);   // 400ms 没再变动 → 视为稳定
			});
			for (var i = 0; i < ready.length; i++) {
				var node = ready[i];
				dirtyNodes.delete(node);
				try { processed.delete(node); } catch (e) { }
				enqueue(node);
			}
			if (!dirtyNodes.size && settleTimer) { clearInterval(settleTimer); settleTimer = null; }
		}
		var records = [];
		var recordByNode = new WeakMap();   // node → record（判断某节点当前是否正显示原文）
		var suppressMutationsUntil = 0;     // 悬停切换期间豁免 MutationObserver，避免被自己重译覆盖
		var queue = [];
		var working = false;
		var translatedCount = 0;
		var stats = { scanned: 0, queued: 0, translated: 0, skippedLang: 0, skippedShort: 0, failed: 0, fellBack: 0, chars: 0 };
		var onDeviceFailures = 0, onDeviceDisabled = false;
		// ===== 本机离线引擎（浏览器内 WASM，推理在 vendor/worker.js） =====
		var localWorker = null, localPending = new Map(), localSeq = 1, localWarm = false, localProgress = null;
		var localWarming = false, workerRecoveries = 0, storageInfo = '', progressHideTimer = null, sharedFailures = 0;
		var localLatencySum = 0, localLatencyCount = 0;   // 本机引擎平均耗时（给用户预期）
		var loadedPairs = {};   // { 'en-zh': true, 'nllb': true }
		var warmingPair = null;
		var QUEUE_MAX = 3000;      // 队列上限：超大页面时不再无节制入队
		var RECORDS_MAX = 5000;    // 已译文记录上限：避免内存无限增长

		/** 把出错的 worker 丢掉，下次调用会重建（fp32 建会话可能 OOM/崩溃，必须能自愈） */
		function resetWorker(reason) {
			if (localWorker) {
				try { localWorker.terminate(); } catch (e) { }   // 共享模式=发 reset，独立模式=硬杀
				if (localWorker.shared) {
					sharedFailures++;
					if (sharedFailures >= 2 && settings.workerMode !== 'dedicated') {
						settings.workerMode = 'dedicated';
						saveSettings();
						console.warn('[dsh-auto-translate] SharedWorker 连续失败，回退为独立 worker');
					}
				}
			}
			localWorker = null;
			localWarm = false;
			localWarming = false;
			localProgress = null;
			if (reason) { workerRecoveries++; console.warn('[dsh-auto-translate] worker reset: ' + reason); }
		}
		/** 把技术性报错翻译成用户能懂的下一步 */
		function hintFor(msg) {
			var m = String(msg || '');
			if (/Missing required scale|TransposeDQWeights|dq_actions/.test(m)) return t('hintScale');
			if (/Failed to fetch|NetworkError|Load failed/.test(m)) return t('hintNet');
			if (/不支持该语向|not support/i.test(m)) return t('hintLang');
			if (/quotaFinished|429|限流|quota/i.test(m)) return t('hintQuota');
			if (/OOM|out of memory|Array buffer allocation/i.test(m)) return t('hintOom');
			if (/worker/i.test(m)) return t('hintWorker');
			return '';
		}
		var hostCacheInfo = '';
		function refreshHostCacheInfo() {
			try {
				fetch('/dsh-auto-translate/cache-info').then(function (r) { return r.json(); }).then(function (j) {
					if (j && j.ok) {
						hostCacheInfo = t('cacheLabel') + ' ' + (j.totalBytes / 1073741824).toFixed(2) + 'GB' + (j.capBytes ? '/' + (j.capBytes / 1073741824).toFixed(0) + 'GB' : '');
						updateStatus();
					}
				}).catch(function () { });
			} catch (e) { }
		}
		function requestPersist() {
			try {
				if (navigator.storage && navigator.storage.persist) {
					navigator.storage.persist().then(function (granted) {
						storageInfo = granted ? '已申请持久化存储' : '浏览器未授予持久化存储';
					}, function () { });
				}
				if (navigator.storage && navigator.storage.estimate) {
					navigator.storage.estimate().then(function (est) {
						if (est && est.quota) storageInfo = '用量 ' + Math.round((est.usage || 0) / 1048576) + '/' + Math.round(est.quota / 1048576) + 'MB';
					}, function () { });
				}
			} catch (e) { }
		}

		function ensureLocalWorker() {
			if (localWorker) return localWorker;
			var workerUrl = '/dsh-auto-translate/vendor/worker.v5.js';
			// 预检：把「404 / 类型不对」这类失败变成可读信息（模块 worker 失败时浏览器只报 unknown）
			try {
				var xhr = new XMLHttpRequest();
				xhr.open('HEAD', workerUrl, false);
				xhr.send();
				if (xhr.status !== 200) throw new Error('HTTP ' + xhr.status);
				var ctype = xhr.getResponseHeader('content-type') || '';
				if (ctype.indexOf('javascript') < 0) throw new Error('content-type=' + ctype);
			} catch (e) {
				throw new Error('本地 worker 不可用(' + ((e && e.message) || e) + ') ' + workerUrl);
			}
			// 默认用 SharedWorker：同源多个标签页共用一份 WASM 会话（内存不翻倍）
			var handle = { shared: false, onmessage: null, onerror: null, post: null, terminate: null };
			if (settings.workerMode !== 'dedicated' && typeof SharedWorker === 'function') {
				try {
					var sw = new SharedWorker(workerUrl, { name: 'dsh-auto-translate', type: 'module' });
					var port = sw.port;
					port.onmessage = function (ev) { if (handle.onmessage) handle.onmessage(ev); };
					try { port.onerror = function (ev) { if (handle.onerror) handle.onerror(ev); } } catch (e) { }
					try { port.start(); } catch (e) { }
					handle.shared = true;
					handle.post = function (m) { try { port.postMessage(m) } catch (e) { } };
					handle.terminate = function () { try { port.postMessage({ type: 'reset' }) } catch (e) { } };   // 共享模式只能 reset
					localWorker = handle;
					handle.post({ type: 'config', multiMode: settings.multiMode });
				} catch (e) {
					console.warn('[dsh-auto-translate] SharedWorker 不可用，改用独立 worker: ' + ((e && e.message) || e));
					localWorker = null;
				}
			}
			if (!localWorker) {
				var w0 = new Worker(workerUrl, { type: 'module' });
				w0.onmessage = function (ev) { if (handle.onmessage) handle.onmessage(ev); };
				w0.onerror = function (ev) { if (handle.onerror) handle.onerror(ev); };
				handle.shared = false;
				handle.post = function (m) { try { w0.postMessage(m) } catch (e) { } };
				handle.terminate = function () { try { w0.terminate() } catch (e) { } };
				localWorker = handle;
				handle.post({ type: 'config', multiMode: settings.multiMode });
			}
			localWorker.onmessage = function (ev) {
				var m = ev.data || {};
				if (m.type === 'boot') { localBooted = true; updateStatus(); return; }
				if (m.type === 'progress') {
					localProgress = { key: m.key, status: m.status, file: m.file, progress: m.progress, loaded: m.loaded, total: m.total };
					updateStatus();
					return;
				}
				if (m.type === 'fatal') {
					lastError = '本地库加载失败: ' + m.error + ' @ ' + (m.where || '');
					failAllPending(lastError);
					resetWorker('fatal');
					updateStatus();
					return;
				}
				if (m.type === 'loaded') {
					localWarm = true; localProgress = null;
					if (m.key) loadedPairs[m.key] = true;
					warmingPair = null;
					if (!settings.localWarmOnce) { settings.localWarmOnce = true; saveSettings(); }
					if (m.variant && statusEl) lastError = '';
					updateStatus();
					return;
				}
				var p = localPending.get(m.id);
				if (!p) return;
				localPending.delete(m.id);
				if (m.ok) p.resolve(m.text); else p.reject(new Error(m.error || '本地翻译失败'));
			};
			localWorker.onerror = function (e) {
				lastError = '本地 worker 加载失败: ' + ((e && e.message) || 'unknown') + (e && e.filename ? ' @ ' + String(e.filename).split('/').pop() + ':' + e.lineno : '');
				failAllPending(lastError);
				resetWorker('onerror');
				updateStatus();
			};
			return localWorker;
		}
		function localTranslateOnce(text, src, tgt) {
			return new Promise(function (resolve, reject) {
				var w;
				try { w = ensureLocalWorker(); } catch (e) { reject(e); return; }
				var id = localSeq++;
				localPending.set(id, { resolve: resolve, reject: reject });
				var waited = 0;
				var timer = setInterval(function () {
					waited += 5000;
					if (!localPending.has(id)) { clearInterval(timer); return; }
					// 首次含模型下载，给足时间；但一旦 worker 崩了就不要傻等
					if (waited > 300000) {
						clearInterval(timer); localPending.delete(id);
						resetWorker('timeout');
						reject(new Error('本地翻译超时（模型可能正在下载或 worker 已崩溃）'));
					}
				}, 5000);
				var origResolve = resolve, origReject = reject;
				localPending.set(id, {
					resolve: function (v) { clearInterval(timer); origResolve(v); },
					reject: function (e) { clearInterval(timer); origReject(e); },
				});
				w.post({ id: id, type: 'translate', text: text, src: src, tgt: tgt });
			});
		}
		/** 失败一次就重建 worker 并重试一次（模型已在缓存里，重建代价很小） */
		async function localTranslate(text, src, tgt) {
			var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
			try {
				var res = await localTranslateOnce(text, src, tgt);
				var dt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
				localLatencySum += dt; localLatencyCount++;
				if (localLatencyCount % 5 === 0) updateStatus();
				return res;
			}
			catch (e) {
				if (/超时|worker/.test(String(e && e.message))) {
					resetWorker('auto-retry');
					await new Promise(function (r) { setTimeout(r, 300); });
					return await localTranslateOnce(text, src, tgt);
				}
				throw e;
			}
		}
		var localBooted = false;
		var rebinding = null;
		function comboOf(e) {
			var parts = [];
			if (e.ctrlKey) parts.push('Ctrl');
			if (e.altKey) parts.push('Alt');
			if (e.shiftKey) parts.push('Shift');
			if (e.metaKey) parts.push('Meta');
			var k = e.key;
			if (!k || k === 'Control' || k === 'Alt' || k === 'Shift' || k === 'Meta') return '';
			if (k.length === 1) k = k.toUpperCase();
			parts.push(k);
			return parts.join('+');
		}
		function summonPanel() {
			settings.chipHidden = false;
			// 位置若已跑到视口外（窗口缩小/换分辨率）→ 复位
			var pos = settings.chipPos;
			if (pos && (pos.left > window.innerWidth - 20 || pos.top > window.innerHeight - 20 || pos.left < -20 || pos.top < -20)) settings.chipPos = null;
			saveSettings();
			applySettingsToUI();
			if (cardEl) cardEl.classList.add('open');
			placeChip();
			updateStatus();
		}
		function failAllPending(msg) {
			localPending.forEach(function (p) { try { p.reject(new Error(msg)); } catch (e) { } });
			localPending.clear();
		}
		function withTimeout(promise, ms, label) {
			return new Promise(function (resolve, reject) {
				var done = false;
				var timer = setTimeout(function () { if (!done) { done = true; reject(new Error(label + ' 超时 ' + ms + 'ms')); } }, ms);
				promise.then(function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
					function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } });
			});
		}
		var PAIR_SAMPLES = { en: 'Hello, this is a warm-up sentence.', zh: '你好，这是一句预热用的测试文本。', ja: 'こんにちは、これは予熱用のテスト文です。', ko: '안녕하세요, 이것은 예열용 테스트 문장입니다.' };
		function warmPair(src, tgt) {
			if (warmingPair) return;   // 幂等
			warmingPair = src + '>' + tgt;
			requestPersist();
			try {
				var w = ensureLocalWorker();
				var id = localSeq++;
				localPending.set(id, {
					resolve: function () { warmingPair = null; localWarm = true; updateStatus(); },
					reject: function (e) { warmingPair = null; lastError = '语向预热失败(' + src + '→' + tgt + '): ' + ((e && e.message) || e); updateStatus(); },
				});
				if (statusEl) statusEl.textContent = '正在预热 ' + src + '→' + tgt + '（首次需下载对应模型）…';
				w.post({ id: id, type: 'warm', src: src, tgt: tgt, text: PAIR_SAMPLES[src] || 'Hello.' });
			} catch (e) { warmingPair = null; lastError = '本地 worker 启动失败: ' + ((e && e.message) || e); updateStatus(); }
		}
		function cancelWarm() {
			if (!localWarming && !warmingPair) { if (statusEl) statusEl.textContent = '当前没有进行中的下载'; return; }
			resetWorker('user-cancel');
			lastError = '';
			if (statusEl) statusEl.textContent = '已取消下载/初始化（宿主缓存与浏览器缓存已保留，重新预热会很快）';
			updateStatus();
		}
		function warmLocal() {
			if (localWarming) return;   // 幂等：重复点击不再叠加下载
			localWarming = true;
			requestPersist();
			var tgt = String(settings.target).split('-')[0];
			var src = settings.latinSource === 'auto' ? 'en' : settings.latinSource;
			try {
				var w = ensureLocalWorker();
				var id = localSeq++;
				localPending.set(id, {
					resolve: function () { localWarming = false; localWarm = true; updateStatus(); },
					reject: function (e) { localWarming = false; lastError = '本地模型下载失败: ' + ((e && e.message) || e); updateStatus(); }
				});
				if (statusEl) statusEl.textContent = '正在下载/初始化本地模型（首次约 425MB，之后离线）…';
				w.post({ id: id, type: 'warm', src: src, tgt: tgt });
			} catch (e) { localWarming = false; lastError = '本地 worker 启动失败: ' + ((e && e.message) || e); updateStatus(); }
		}
		var lastError = '';

		function isSkipped(el) {
			if (!el || el.nodeType !== 1) return true;
			if (SKIP_TAGS[el.tagName]) {
				// 思考过程常被渲染在 <pre>/<code> 里；开启开关后一并翻译
				if (settings.translateCode && (el.tagName === 'PRE' || el.tagName === 'CODE')) return false;
				return true;
			}
			if (el.isContentEditable) return true;
			if (el.closest && (el.closest('#' + ROOT_ID) || el.closest('[data-dsh-at-skip]') || el.closest('[translate="no"]'))) return true;
			if (el.closest && el.closest('.cm-editor, .monaco-editor, .cm-content')) return true;
			return false;
		}
		var WORDISH = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
		function enqueue(node) {
			if (!node || processed.has(node) || queued.has(node)) return;
			var text = node.nodeValue;
			if (!text) return;
			var trimmed = text.trim();
			stats.scanned++;
			if (trimmed.length < settings.minChars) { stats.skippedShort++; return; }
			if (!WORDISH.test(trimmed)) { stats.skippedShort++; return; }
			if (/^(https?:\/\/|www\.|[\w.-]+@[\w.-]+\.\w+)[^\s]*$/i.test(trimmed)) { stats.skippedShort++; return; }
			if (queue.length >= QUEUE_MAX) { stats.skippedShort++; if (!lastError) lastError = '页面文本超出队列上限(' + QUEUE_MAX + ')，已暂停新入队，可点「重试」'; return; }
			queued.add(node);
			queue.push(node);
			stats.queued++;
			schedule();
		}
		function inViewport(node) {
			try {
				var el = node.parentElement;
				if (!el) return false;
				var r = el.getBoundingClientRect();
				if (r.width === 0 && r.height === 0) return false;
				var vh = window.innerHeight || 800;
				return r.bottom > -200 && r.top < vh + 400;
			} catch (e) { return true; }
		}
		var io = null;
		function observeVisible(el) {
			if (!io || !el || el.nodeType !== 1) return;
			try { io.observe(el); } catch (e) { }
		}
		var shadowSeen = new WeakSet();
		function scanRoot(root, depth) {
			if (!root || !settings.enabled) return;
			if (settings.engine === 'hover') return;   // 悬停模式：不自动扫描、不自动翻译任何内容
			depth = depth || 0;
			if (depth > 6) return;
			if (root.nodeType === 3) { enqueue(root); return; }
			if (root.nodeType !== 1) return;
			if (isSkipped(root)) return;
			try {
				var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
				var n, count = 0;
				while ((n = walker.nextNode())) {
					if (n.nodeValue && n.nodeValue.trim()) {
						var pe = n.parentElement;
						if (isSkipped(pe)) bumpSkip(pe);
						else if (!inViewport(n)) { bumpSkip(null, 'offscreen'); observeVisible(pe); }
						else enqueue(n);
					}
					if (++count > 500) break;
				}
			} catch (e) { }
			if (root.shadowRoot && !shadowSeen.has(root)) {
				shadowSeen.add(root);
				scanRoot(root.shadowRoot, depth + 1);
			}
			try {
				var kids = root.querySelectorAll('*');
				for (var i = 0; i < kids.length && i < 600; i++) {
					var sr = kids[i].shadowRoot;
					if (sr && !shadowSeen.has(kids[i])) { shadowSeen.add(kids[i]); scanRoot(sr, depth + 1); }
				}
			} catch (e) { }
		}
		var scheduled = false;
		function schedule() {
			if (scheduled) return;
			scheduled = true;
			var run = function () { scheduled = false; pump(); };
			if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 1500 });
			else setTimeout(run, 80);
		}
		async function pump() {
			if (working || !settings.enabled) return;
			if (settings.engine === 'hover') {   // 悬停模式：丢弃自动扫描残留的队列，绝不自动翻译
				queue.length = 0; scheduled = false; updateStatus(); return;
			}
			working = true;
			var budget = Math.max(1, settings.maxNodes);
			try {
				while (queue.length && budget-- > 0) {
					var node = queue.shift();
					queued.delete(node);
					if (!node.isConnected || processed.has(node)) continue;
					var prior = recordByNode.get(node);
					if (prior && prior.showingOriginal) { processed.add(node); continue; }   // 用户正看着原文，别覆盖
					var el = node.parentElement;
					if (isSkipped(el)) { processed.add(node); continue; }
					if (!inViewport(node)) { observeVisible(el); continue; }
					var lim = sessionLimit();
					if (lim && stats.chars >= lim) { lastError = '达到本次会话翻译上限 ' + lim + ' 字符（仅在线/自定义引擎计数；点「清零计数」或「重试」可继续）'; break; }
					if (records.length >= RECORDS_MAX) { lastError = '已译文条目达到上限 ' + RECORDS_MAX + '，可点「重试」或「还原原文」释放'; break; }
					var dts = dirtyNodes.get(node);
					if (dts && Date.now() - dts < 400) continue;   // 仍在流式追加，等它稳定
					var text = node.nodeValue;
					if (!text || text.trim().length < settings.minChars) { processed.add(node); continue; }
					var src = null;
					try { src = await planSource(text); } catch (e) { src = null; }
					if (!src) { stats.skippedLang++; processed.add(node); continue; }
					var tgt = settings.target;
					var key = cacheKey(text, src, tgt);
					var out = cacheGet(key);
					if (out === undefined) {
						try { out = await translateText(text, src, tgt); }
						catch (e) { out = null; stats.failed++; lastError = String(e && e.message ? e.message : e); }
						if (out) cacheSet(key, out);
					}
					if (!out || out === text) { processed.add(node); updateStatus(); continue; }
					var lead = text.match(/^\s*/)[0];
					var tail = text.match(/\s*$/)[0];
					var rec = { node: node, original: text, translated: lead + out + tail, showingOriginal: false };
					records.push(rec);
					recordByNode.set(node, rec);
					processed.add(node);
					node.nodeValue = lead + out + tail;
					selfWrites.set(node, Date.now());
					translatedCount++;
					stats.translated++;
					stats.chars += text.length;
					if (el) el.setAttribute('data-dsh-at', 'translated');
				}
			} finally {
				working = false;
				updateStatus();
				if (queue.length) schedule();
			}
		}

		// ===================== 悬停切换原文/译文 =====================
		var hoverHost = null, hoverTimer = null, toggledHost = null;

		// ---------- 悬停翻译模式（engine === 'hover'）----------
		// 不自动扫描全页；只有鼠标停在同一块文字上达到 hoverDelayMs 才翻译那一块，且译文保持。
		var hoverDone = new WeakSet();      // 已在本模式下翻译过的宿主元素
		var hoverBusy = false;
		// 收集元素自身直接持有的文本节点（不下钻到子元素，避免悬停一个容器把整页都翻了）
		function collectOwnTextNodes(el) {
			var out = [], kids = el.childNodes || [];
			for (var i = 0; i < kids.length && out.length < settings.maxNodes; i++) {
				var n = kids[i];
				if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim().length >= settings.minChars) out.push(n);
			}
			return out;
		}
		// 针对悬停模式更精准的文本节点收集：优先「最内层、自身直接含文本」的元素
		function collectHoverText(host) {
			var nodes = collectOwnTextNodes(host);
			if (nodes.length) return nodes;
			var found = [];
			try {
				var all = host.querySelectorAll('*');
				for (var i = 0; i < all.length && found.length < settings.maxNodes && i < 120; i++) {
					var el = all[i];
					if (!el.childNodes || el.childElementCount) continue;   // 只取叶子元素
					var c = collectOwnTextNodes(el);
					for (var k = 0; k < c.length && found.length < settings.maxNodes; k++) found.push(c[k]);
				}
			} catch (e) { }
			return found;
		}
		async function translateNodeNow(node) {
			if (processed.has(node)) return false;
			var text = node.nodeValue;
			if (!text || text.trim().length < settings.minChars) { processed.add(node); return false; }
			var el = node.parentElement;
			if (el && isSkipped(el)) { processed.add(node); return false; }
			var src = null;
			try { src = await planSource(text); } catch (e) { src = null; }
			if (!src) { stats.skippedLang++; processed.add(node); return false; }
			var realMode = actualModeFor(node);
			var tgt = settings.target;
			var key = cacheKey(text, src, tgt);
			var out = cacheGet(key);
			if (out === undefined) {
				try {
					if (realMode === 'local') out = await translateLong(localTranslate, text, src, tgt, 600);
					else if (realMode === 'online') out = await withTimeout(translateLong(onlineTranslate, text, src, tgt, 480), 12000, '在线翻译');
					else if (realMode === 'custom') out = await translateLong(httpTranslate, text, src, tgt);
					else out = await translateText(text, src, tgt);
				}
				catch (e) { out = null; stats.failed++; lastError = String(e && e.message ? e.message : e); }
				if (out) cacheSet(key, out);
			}
			if (!out || out === text) { processed.add(node); return false; }
			var lead = text.match(/^\s*/)[0];
			var tail = text.match(/\s*$/)[0];
			var rec = { node: node, original: text, translated: lead + out + tail, showingOriginal: false };
			records.push(rec);
			recordByNode.set(node, rec);
			processed.add(node);
			node.nodeValue = lead + out + tail;
			selfWrites.set(node, Date.now());
			translatedCount++;
			stats.translated++;
			stats.chars += text.length;
			return true;
		}
		async function translateHost(host) {
			if (hoverBusy) return;
			hoverBusy = true;
			suppressMutationsUntil = Date.now() + 1500;
			try {
				var nodes = collectHoverText(host);
				var changed = 0;
				for (var i = 0; i < nodes.length; i++) {
					var node = nodes[i];
					if (records.length >= RECORDS_MAX) { lastError = '已译文条目达到上限 ' + RECORDS_MAX + '，可点「还原原文」释放'; break; }
					if (await translateNodeNow(node)) changed++;
				}
				if (changed) {
					host.setAttribute('data-dsh-at', 'translated');
					hoverDone.add(host);
				} else {
					stats.skippedShort++;
				}
				updateStatus();
			} finally { hoverBusy = false; }
		}
		// 找鼠标下面真正该翻译的那一块（向上找到最小且自身直接含文本的祖先）
		function hoverTargetOf(el) {
			var cur = el;
			while (cur && cur !== document.body && cur.nodeType === 1) {
				if (cur.hasAttribute && cur.hasAttribute('data-dsh-at')) return null;   // 这块已翻过，保持译文
				if (collectOwnTextNodes(cur).length) return isSkipped(cur) ? null : cur;  // 面板/代码块/输入框不翻
				cur = cur.parentElement;
			}
			return null;
		}
		function onOverHoverMode(e) {
			if (!settings.enabled || hoverBusy) return;
			var el = e.target && e.target.nodeType === 1 ? e.target : null;
			if (!el || !el.closest) return;
			var host = hoverTargetOf(el);
			if (!host || host === hoverHost) return;
			if (hoverTimer) clearTimeout(hoverTimer);
			hoverHost = host;
			var delay = e.altKey ? 60 : Math.max(0, settings.hoverDelayMs);
			hoverTimer = setTimeout(function () { if (hoverHost === host) translateHost(host); }, delay);
		}

		function onOver(e) {
			if (!settings.enabled) return;
			if (settings.engine === 'hover') return onOverHoverMode(e);
			var el = e.target && e.target.nodeType === 1 ? e.target : null;
			if (!el || !el.closest) return;
			var host = el.closest('[data-dsh-at]');
			if (!host || host === toggledHost) return;
			if (host !== hoverHost) {
				hoverHost = host;
				if (hoverTimer) clearTimeout(hoverTimer);
				var delay = e.altKey ? 60 : Math.max(0, settings.hoverDelayMs);
				hoverTimer = setTimeout(function () { toggleHost(host); }, delay);
			}
		}
		function onOut(e) {
			var el = e.target && e.target.nodeType === 1 ? e.target : null;
			var host = el && el.closest ? el.closest('[data-dsh-at]') : null;
			var to = e.relatedTarget;
			if (host && to && host.contains(to)) return;   // 仍在同一宿主内移动
			if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
			hoverHost = null;
			toggledHost = null;
		}
		function toggleHost(host) {
			hoverTimer = null;
			toggledHost = host;
			suppressMutationsUntil = Date.now() + 1500;
			var changed = 0;
			for (var i = 0; i < records.length && changed < 400; i++) {
				var r = records[i];
				if (!r.node.isConnected) continue;
				if (!host.contains(r.node)) continue;
				if (r.showingOriginal) { r.node.nodeValue = r.translated; r.showingOriginal = false; }
				else { r.node.nodeValue = r.original; r.showingOriginal = true; }
				selfWrites.set(r.node, Date.now());
				changed++;
			}
		}
		function toggleAll() {
			var anyOriginal = false;
			for (var i = 0; i < records.length; i++) { if (records[i].showingOriginal) { anyOriginal = true; break; } }
			suppressMutationsUntil = Date.now() + 1500;
			for (var j = 0; j < records.length; j++) {
				var r = records[j];
				if (!r.node.isConnected) continue;
				if (anyOriginal) { r.node.nodeValue = r.translated; r.showingOriginal = false; }
				else { r.node.nodeValue = r.original; r.showingOriginal = true; }
				selfWrites.set(r.node, Date.now());
			}
			if (statusEl) statusEl.textContent = (anyOriginal ? '已全部切回译文' : '已全部切回原文') + '（' + records.length + ' 处）';
		}
		var HELP_TEXT = [
			'【自动翻译 · 使用指南】',
			'',
			'· 自动工作:页面上的外语文本就地替换为目标语言',
			'· 悬停约 0.6 秒:该块在「译文 ↔ 原文」之间来回切换',
			'· Alt + 悬停:立即切换(不必等 0.6 秒)',
			'· Ctrl+Alt+T:呼出/关闭本面板(圆点找不到时用这个)',
			'· Ctrl+Alt+H:显示/隐藏左下角圆点',
			'· Ctrl+Alt+P:暂停 / 恢复翻译(暂停会还原原文)',
			'',
			'【引擎】',
			'· 本机离线(推荐):浏览器内 WASM 推理,零 token、不限量、文本不出本机;首次需下载模型',
			'· 在线免密钥:MyMemory,免 key 但有每日额度限制',
			'· 端侧:浏览器内置 Translator(需要能连 Google 组件服务器,多数国内网络不可用)',
			'· 自定义端点:填你自己的翻译服务模板,如 ?q={text}&target={target}&source={source}',
			'',
			'【本地模型】',
			'· 英→中 / 中→英:opus-mt 专用小模型(约 425MB,量化版与本机 ORT 不兼容,故用 fp32)',
			'· 日/韩等其它语向:需 NLLB 600M(约 600MB,按需下载)',
			'· 模型缓存在浏览器中,之后完全离线;黑屏/卡住时点「重试」,出错时点「保存诊断到本机」',
			'',
			'【不消耗 token】',
			'· 全程不调用任何大模型,不产生 API 费用;译文按句缓存,同一句不重复翻译',
		].join('\n');
		function restoreAll() {
			for (var i = 0; i < records.length; i++) {
				var r = records[i];
				if (r.node.isConnected && r.showingOriginal === false) { r.node.nodeValue = r.original; selfWrites.set(r.node, Date.now()); }
			}
			records = [];
			recordByNode = new WeakMap();
			processed = new WeakSet();
			translatedCount = 0;
			try { document.querySelectorAll('[data-dsh-at]').forEach(function (el) { el.removeAttribute('data-dsh-at'); }); } catch (e) { }
			updateStatus();
		}

		// ===================== 面板国际化（zh / en，auto 跟随浏览器） =====================
		var I18N = {
			zh: {
				chipLabel: '译', cacheLabel: '宿主缓存', clearHostCache: '清空宿主缓存', cacheCleared: '宿主缓存已清空',
				translateCode: '也翻译代码/思考块(实验)', avgLatency: '平均 {ms}ms/句',
				multiTab: '检测到 {n} 个其他标签页(译文缓存共享,内存会翻倍)',
				workerMode: '推理实例', wmAuto: '自动(共享优先)', multiMode: '多语种策略', mmTwoHop: '两跳(省内存/快)',
				title: '自动翻译（零 token）', close: '收起', enabled: '启用', target: '目标语言',
				hoverDelay: '悬停切换(ms)', engine: '引擎', onlineOrder: '在线优先', customTemplate: '自定义模板',
				latinSource: '拉丁源语言', initOnDevice: '初始化端侧引擎', warmBtn: '预热',
				summonPanel: '呼出面板', rebind: '改键', summon: '呼出', toggleChip: '显示/隐藏圆点',
				pauseRow: '暂停/恢复', selfCheck: '自检', test: '测试翻译', diag: '诊断',
				ondevUnavailable: '端侧不可用?', useOnline: '切到在线引擎', localModel: '本机离线模型',
				warmLocal: '下载/预热', useLocal: '切到本机', singlePair: '单个语向', warmPair: '预热',
				abort: '中止', cancelWarm: '取消下载/初始化', compactChip: '挂件缩为小圆点',
				resetPos: '复位位置', hideChip: '隐藏挂件', clearCache: '清缓存', rescan: '重扫页面',
				sessionLimit: '会话字符上限(仅在线)', resetChars: '清零计数',
				restore: '还原原文', saveDiag: '保存诊断到本机', copyDiag: '复制诊断', retry: '重试',
				toggleAll: '全部原文/译文', helpBtn: '使用指南', lang: '语言', langAuto: '自动',
				engineHover: '悬停翻译(不自动翻)', engineAuto: '自动(本机→端侧→在线)', engineLocal: '本机离线(小模型)', engineOnDevice: '端侧仅',
				engineOnline: '在线免密钥', engineCustom: '自定义端点', engineOff: '关闭',
				footerHint: '悬停 0.6 秒翻译鼠标下那一块（默认模式）；Alt+悬停可立即触发。快捷键（可改键）：Ctrl+Alt+T 呼出面板 · Ctrl+Alt+H 显示/隐藏圆点 · Ctrl+Alt+P 暂停/恢复。全程不调用大模型。',
				stEngine: '引擎', stOnDevOk: ' · 端侧可用', stOnDevNo: ' · 端侧不可用',
				stCounters: ' | 扫描 {s} / 入队 {q} / 已译 {t} / 跳过语言 {sl} / 失败 {f}',
				stFallback: ' / 回退 {fb}', stCache: ' | 缓存 {c}', stPaused: ' | 已暂停',
				stChars: ' | 本次会话 {u}/{l} 字符(在线计数)',
				stLast: ' | 最近: ', stTruncated: ' …(完整见下方框/点保存诊断)', stRecovered: ' | worker 自愈 {n} 次',
				stLoaded: ' | 已加载: ', stWarming: ' | 正在预热 ', stWarm: ' | 本机模型已就绪',
				stDownloading: ' | 本机模型下载中 ', stWorkerDown: ' | 本机 worker 未启动',
				stFirstRun: ' | 提示:点「切到本机」启用本地离线翻译(仅首次需下载模型)',
				stOnDevFailed: ' | ⚠ 端侧模型下载失败，请点「切到在线引擎」', stOnDevOff: ' | 端侧已停用',
				modeAuto: '自动(本机→端侧→在线)', modeOnDevice: '端侧仅', modeOnline: '在线免密钥',
				modeCustom: '自定义端点', modeOff: '关闭',
				hintScale: '建议:使用 fp32 干净图(插件默认已是)或点「重试」', hintNet: '建议:检查网络/代理,或点「重试」(宿主端会断点续传)',
				hintLang: '建议:把「拉丁源语言」从 auto 改成具体语言(如 English)', hintQuota: '建议:切换到「本机离线」引擎(不限量)',
				hintOom: '建议:关闭其他标签页后点「重试」(fp32 模型占用较大内存)', hintWorker: '建议:刷新页面(Ctrl+F5)让 worker 重建',
				help: '【自动翻译 · 使用指南】\n\n· 自动工作:页面上的外语文本就地替换为目标语言\n· 悬停约 0.6 秒:在「译文 ↔ 原文」之间来回切换\n· Alt + 悬停:立即切换\n· Ctrl+Alt+T:呼出/关闭本面板(圆点找不到时用这个)\n· Ctrl+Alt+H:显示/隐藏左下角圆点\n· Ctrl+Alt+P:暂停 / 恢复翻译\n\n【引擎】\n· 本机离线(推荐):浏览器内 WASM 推理,零 token、不限量、文本不出本机\n· 在线免密钥:MyMemory,免 key 但有每日额度限制\n· 端侧:浏览器内置 Translator(需能连 Google 组件服务器)\n· 自定义端点:填你自己的翻译服务模板\n\n【本地模型】\n· en↔zh:opus-mt 专用小模型(约 425MB,用 fp32)\n· ja/ko 等:需 NLLB 600M(约 600MB,按需下载)\n· 模型缓存在浏览器,之后完全离线;出错点「保存诊断到本机」',
			},
			en: {
				chipLabel: 'Tr', cacheLabel: 'host cache', clearHostCache: 'Clear host cache', cacheCleared: 'Host cache cleared',
				translateCode: 'Also translate code/thinking blocks (experimental)', avgLatency: 'avg {ms}ms/sentence',
				multiTab: '{n} other tab(s) detected (translation cache shared, memory doubles)',
				workerMode: 'Inference instance', wmAuto: 'Auto (prefer shared)', multiMode: 'Multilingual strategy', mmTwoHop: 'Two-hop (light/fast)',
				title: 'Auto-translate (zero token)', close: 'Collapse', enabled: 'Enabled', target: 'Target language',
				hoverDelay: 'Hover toggle (ms)', engine: 'Engine', onlineOrder: 'Online priority', customTemplate: 'Custom template',
				latinSource: 'Latin source', initOnDevice: 'Init built-in engine', warmBtn: 'Warm up',
				summonPanel: 'Open panel', rebind: 'Rebind', summon: 'Open', toggleChip: 'Show/hide chip',
				pauseRow: 'Pause/resume', selfCheck: 'Self-test', test: 'Test', diag: 'Diagnose',
				ondevUnavailable: 'Built-in unusable?', useOnline: 'Use online engine', localModel: 'On-device model',
				warmLocal: 'Download/warm up', useLocal: 'Use on-device', singlePair: 'Single pair', warmPair: 'Warm up',
				abort: 'Abort', cancelWarm: 'Cancel download/init', compactChip: 'Collapse chip to a dot',
				resetPos: 'Reset position', hideChip: 'Hide chip', clearCache: 'Clear cache', rescan: 'Rescan page',
				sessionLimit: 'Session char cap (online only)', resetChars: 'Reset counter',
				restore: 'Restore original', saveDiag: 'Save diagnostics', copyDiag: 'Copy diagnostics', retry: 'Retry',
				toggleAll: 'All original/translated', helpBtn: 'Guide', lang: 'Language', langAuto: 'Auto',
				engineHover: 'Hover to translate (no auto)', engineAuto: 'Auto (local → built-in → online)', engineLocal: 'On-device (small model)', engineOnDevice: 'Built-in only',
				engineOnline: 'Online keyless', engineCustom: 'Custom endpoint', engineOff: 'Off',
				footerHint: 'Hover a block for ~0.6s to translate just that block (default mode); Alt+hover triggers instantly. Hotkeys (rebindable): Ctrl+Alt+T panel · Ctrl+Alt+H chip · Ctrl+Alt+P pause. No LLM is ever called.',
				stEngine: 'Engine', stOnDevOk: ' · built-in available', stOnDevNo: ' · built-in unavailable',
				stCounters: ' | scanned {s} / queued {q} / translated {t} / skipped {sl} / failed {f}',
				stFallback: ' / fallback {fb}', stCache: ' | cache {c}', stPaused: ' | paused',
				stChars: ' | session {u}/{l} chars (online only)',
				stLast: ' | last: ', stTruncated: ' ...(full text in the box below / save diagnostics)', stRecovered: ' | worker self-healed {n}x',
				stLoaded: ' | loaded: ', stWarming: ' | warming ', stWarm: ' | on-device model ready',
				stDownloading: ' | downloading model ', stWorkerDown: ' | worker not started',
				stFirstRun: ' | tip: click "Use on-device" to enable offline translation (model downloads once)',
				stOnDevFailed: ' | ! built-in model download failed — click "Use online engine"', stOnDevOff: ' | built-in disabled',
				modeAuto: 'Auto (local → built-in → online)', modeOnDevice: 'Built-in only', modeOnline: 'Online keyless',
				modeCustom: 'Custom endpoint', modeOff: 'Off',
				hintScale: 'Tip: use the clean fp32 graphs (the default) or click Retry', hintNet: 'Tip: check network/proxy, or click Retry (the host cache resumes)',
				hintLang: 'Tip: set "Latin source" to a concrete language (e.g. English) instead of auto', hintQuota: 'Tip: switch to the on-device engine (no quota)',
				hintOom: 'Tip: close other tabs and click Retry (the fp32 model needs memory)', hintWorker: 'Tip: refresh the page (Ctrl+F5) to rebuild the worker',
				help: '[Auto-translate · Guide]\n\n· Automatic: foreign text on screen is replaced in place\n· Hover ~0.6s: flip between translation and original\n· Alt + hover: flip immediately\n· Ctrl+Alt+T: open/close this panel (use it if the chip is lost)\n· Ctrl+Alt+H: show/hide the chip\n· Ctrl+Alt+P: pause/resume\n\n[Engines]\n· On-device (recommended): WASM in your browser, no tokens, no quota, text never leaves the machine\n· Online keyless: MyMemory, no key but a daily quota\n· Built-in: browser Translator API (needs Google component servers)\n· Custom endpoint: point at your own service\n\n[Local models]\n· en<->zh: opus-mt small models (~425MB, fp32)\n· ja/ko etc.: NLLB 600M (~600MB, on demand)\n· Cached in the browser; fully offline afterwards. On errors click "Save diagnostics".',
			},
		};
		function L() {
			if (settings.lang === 'zh' || settings.lang === 'en') return settings.lang;
			try {
				var n = (typeof navigator !== 'undefined' && navigator.language) || '';
				return String(n).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
			} catch (e) { return 'zh'; }
		}
		function t(key) {
			var pack = I18N[L()] || I18N.zh;
			return (pack && pack[key]) || I18N.zh[key] || key;
		}
		function applyI18n() {
			if (!cardEl) return;
			cardEl.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
			cardEl.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
			if (statusEl) updateStatus();
		}
		function helpText() { return t('help'); }

		// ===================== 变更监听 =====================
		var mo = null;
		function createObserver() { return new MutationObserver(function (muts) {
			if (!settings.enabled) return;
			var suppressing = Date.now() < suppressMutationsUntil;
			var pending = [];
			for (var i = 0; i < muts.length; i++) {
				var m = muts[i];
				if (m.type === 'characterData') {
					if (suppressing) continue;
					var sw = selfWrites.get(m.target);
					if (sw && Date.now() - sw < 1500) continue;   // 我们自己刚写的，不是新内容
					if (m.target && m.target.nodeValue && m.target.nodeValue.trim()) markDirty(m.target);
				} else if (m.addedNodes) {
					for (var j = 0; j < m.addedNodes.length && j < 40; j++) pending.push(m.addedNodes[j]);
				}
			}
			var cap = Math.max(1, settings.maxNodes);
			for (var k = 0; k < pending.length && k < cap; k++) scanRoot(pending[k], 0);
		}); }

		// ===================== 控制面板（Shadow DOM，避免被自身翻译） =====================
		var statusEl = null, cardEl = null, chipEl = null;
		function updateStatus() {
			if (!statusEl) return;
			var T = translatorCtor();
			var modeName = { hover: t('engineHover'), auto: t('modeAuto'), ondevice: t('modeOnDevice'), online: t('modeOnline'), custom: t('modeCustom'), http: t('modeCustom'), off: t('modeOff') }[settings.engine] || settings.engine;
			statusEl.textContent = t('stEngine') + ' ' + modeName + (settings.engine === 'auto' || settings.engine === 'ondevice' ? (T ? t('stOnDevOk') : t('stOnDevNo')) : '')
				+ t('stCounters').replace('{s}', stats.scanned).replace('{q}', stats.queued).replace('{t}', stats.translated).replace('{sl}', stats.skippedLang).replace('{f}', stats.failed)
				+ (stats.fellBack ? t('stFallback').replace('{fb}', stats.fellBack) : '')
				+ t('stCache').replace('{c}', cache.size) + (settings.enabled ? '' : t('stPaused'));
			var lim = sessionLimit();
			if (lim && statusEl) statusEl.textContent += ' | ' + t('stChars').replace('{u}', stats.chars).replace('{l}', lim);
			if (lastError) {
				statusEl.textContent += t('stLast') + String(lastError).slice(0, 80) + (String(lastError).length > 80 ? t('stTruncated') : '');
				var hint = hintFor(lastError);
				if (hint) statusEl.textContent += ' | ' + hint;
			}
			if (workerRecoveries && statusEl) statusEl.textContent += t('stRecovered').replace('{n}', workerRecoveries);
			if (localLatencyCount > 0 && statusEl) statusEl.textContent += ' | ' + t('avgLatency').replace('{ms}', Math.round(localLatencySum / localLatencyCount));
			var paired = Object.keys(loadedPairs);
			if (paired.length && statusEl) statusEl.textContent += t('stLoaded') + paired.join(',');
			if (warmingPair && statusEl) statusEl.textContent += t('stWarming') + warmingPair;
			if (hostCacheInfo && statusEl) statusEl.textContent += ' | ' + hostCacheInfo;
			if (bcPeers > 0 && statusEl) statusEl.textContent += ' | ' + t('multiTab').replace('{n}', bcPeers);
			var errBoxEl = cardEl && cardEl.querySelector('[data-el="errbox"]');
			if (errBoxEl) {
				if (lastError) { errBoxEl.value = String(lastError); errBoxEl.style.display = 'block'; }
				else { errBoxEl.style.display = 'none'; }
			}
			if (stats.failed > 0 && !stats.translated && settings.engine === 'ondevice') statusEl.textContent += t('stOnDevFailed');
			if (onDeviceDisabled) statusEl.textContent += t('stOnDevOff');
			if (localWarm) {
				statusEl.textContent += t('stWarm');
			} else if (localProgress) {
				var pct = localProgress.progress ? Math.max(0, Math.min(100, Math.round(localProgress.progress))) : 0;
				var mb = localProgress.total ? ' (' + (localProgress.loaded / 1048576).toFixed(1) + '/' + (localProgress.total / 1048576).toFixed(1) + 'MB)' : '';
				statusEl.textContent += t('stDownloading') + pct + '%' + mb + (localProgress.file ? ' · ' + String(localProgress.file).slice(-26) : '');
			} else if (!localBooted) {
				statusEl.textContent += t('stWorkerDown');
			}
			if (!localWarm && !settings.localWarmOnce && settings.engine !== 'off') statusEl.textContent += t('stFirstRun');
			var pbarEl = cardEl && cardEl.querySelector('[data-el="pbar"]');
			var pfillEl = cardEl && cardEl.querySelector('[data-el="pfill"]');
			if (pbarEl && pfillEl) {
				if (localProgress) {
					if (progressHideTimer) { clearTimeout(progressHideTimer); progressHideTimer = null; }
					pbarEl.classList.add('on');
					pfillEl.style.width = (localProgress.progress ? Math.max(2, Math.min(100, Math.round(localProgress.progress))) : 3) + '%';
				} else if (localWarm) {
					// 完成：先显示 100% 约 1.5 秒，然后撤掉进度条（避免"到底下没下完"的困惑）
					pfillEl.style.width = '100%';
					if (!progressHideTimer) {
						progressHideTimer = setTimeout(function () {
							progressHideTimer = null;
							if (pbarEl) pbarEl.classList.remove('on');
							if (pfillEl) pfillEl.style.width = '0';
						}, 1500);
					}
				} else {
					if (progressHideTimer) { clearTimeout(progressHideTimer); progressHideTimer = null; }
					pbarEl.classList.remove('on');
					pfillEl.style.width = '0';
				}
			}
			if (chipEl) chipEl.className = 'dot' + (settings.enabled && settings.engine !== 'off' ? (lastError ? ' warn' : '') : ' off');
		}
		var hostEl = null, chipNode = null;
		function buildPanel() {
			if (document.getElementById(ROOT_ID)) return;
			var host = document.createElement('div');
			host.id = ROOT_ID;
			host.setAttribute('data-dsh-at-skip', '1');
			host.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483000;pointer-events:none;font:12px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif;';
			hostEl = host;
			var sr = host.attachShadow({ mode: 'open' });
			var style = document.createElement('style');
			style.textContent = '.chip{display:inline-flex;gap:6px;align-items:center;cursor:grab;background:rgba(20,22,28,.86);color:#e8eaf0;border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:4px 10px;backdrop-filter:blur(6px);pointer-events:auto;user-select:none;touch-action:none;opacity:.55;transition:opacity .15s ease,transform .15s ease,padding .15s ease}'
				+ '.chip:hover{opacity:1}.chip.dragging{cursor:grabbing;opacity:1}'
				+ '.chip.compact{padding:3px 7px;opacity:.5;transform:scale(.95)}'
				+ '.chip.compact:hover{opacity:1;transform:scale(1);padding:4px 10px}'
				+ '.chip.compact .label{display:inline;font-size:11px;opacity:.9}'
				+ '.chip.hidden{display:none}'
				+ '.dot{width:7px;height:7px;border-radius:50%;background:#3ddc84;flex:0 0 auto}.dot.off{background:#888}.dot.warn{background:#e8b23d}'
				+ '.help{display:none;max-height:190px;overflow:auto;background:#111318;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:8px;margin:6px 0;font-size:11px;line-height:1.6;white-space:pre-wrap}.help.on{display:block}'
				+ '.card{display:none;position:absolute;left:0;bottom:calc(100% + 8px);width:290px;max-height:min(74vh,600px);overflow-y:auto;pointer-events:auto;background:rgba(20,22,28,.94);color:#e8eaf0;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.35)}'
				+ '.card.open{display:block}'
				+ '.row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:6px 0}'
				+ 'label{opacity:.8}select,input[type=text],input[type=number]{background:#111318;color:#e8eaf0;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:3px 6px;max-width:160px}'
				+ 'button{background:#2a2f3a;color:#e8eaf0;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;cursor:pointer}'
				+ '.hint{opacity:.65;font-size:11px;margin-top:6px}'
				+ '.pbar{display:none;height:6px;background:#2a2f3a;border-radius:3px;overflow:hidden;margin:6px 0}.pbar.on{display:block}'
				+ '.pfill{height:100%;width:0;background:#3ddc84;transition:width .2s ease}'
				+ '.errbox{display:none;width:100%;box-sizing:border-box;max-height:96px;overflow:auto;white-space:pre-wrap;word-break:break-all;background:#111318;color:#ffd9a0;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:6px;font:11px/1.45 ui-monospace,Consolas,monospace;margin:6px 0;resize:vertical}'
				// 滚动条：细、圆角、透明轨道、拇指内缩 —— 与面板的深色圆角融为一体
				+ '::-webkit-scrollbar{width:10px;height:10px}'
				+ '::-webkit-scrollbar-track{background:transparent}'
				+ '::-webkit-scrollbar-thumb{background-color:rgba(255,255,255,.16);border-radius:999px;border:3px solid transparent;background-clip:content-box}'
				+ '::-webkit-scrollbar-thumb:hover{background-color:rgba(255,255,255,.32)}'
				+ '::-webkit-scrollbar-corner{background:transparent}'
				+ '.card{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent;scrollbar-gutter:stable}'
				+ '.help{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent}'
				+ '.errbox{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent}';
			sr.appendChild(style);
			cardEl = document.createElement('div');
			cardEl.className = 'card';
			cardEl.innerHTML = '<div class="row"><strong data-i18n="title"></strong><button data-act="close" data-i18n="close"></button></div>'
				+ '<div class="row"><label data-i18n="lang"></label><select data-set="lang"><option value="auto" data-i18n="langAuto"></option><option value="zh">中文</option><option value="en">English</option></select></div>'
				+ '<div class="row"><label data-i18n="enabled"></label><input type="checkbox" data-set="enabled"></div>'
				+ '<div class="row"><label data-i18n="target"></label><select data-set="target"></select></div>'
				+ '<div class="row"><label data-i18n="hoverDelay"></label><input type="number" min="0" max="5000" step="100" data-set="hoverDelayMs" style="width:80px"></div>'
				+ '<div class="row"><label data-i18n="engine"></label><select data-set="engine"><option value="hover" data-i18n="engineHover"></option><option value="auto" data-i18n="engineAuto"></option><option value="local" data-i18n="engineLocal"></option><option value="ondevice" data-i18n="engineOnDevice"></option><option value="online" data-i18n="engineOnline"></option><option value="custom" data-i18n="engineCustom"></option><option value="off" data-i18n="engineOff"></option></select></div>'
				+ '<div class="row"><label data-i18n="onlineOrder"></label><select data-set="onlineOrder"><option value="google">Google</option><option value="mymemory">MyMemory</option></select></div>'
				+ '<div class="row"><label data-i18n="customTemplate"></label><input type="text" data-set="endpoint" placeholder="…?q={text}&target={target}" style="max-width:150px"></div>'
				+ '<div class="row"><label data-i18n="latinSource"></label><select data-set="latinSource"></select></div>'
				+ '<div class="row"><label data-i18n="initOnDevice"></label><button data-act="warm" data-i18n="warmBtn"></button></div>'
				+ '<div class="row"><label data-i18n="summonPanel"></label><button data-act="rebindSummon"><span data-el="hkSummon"></span> <span data-i18n="rebind"></span></button><button data-act="summon" data-i18n="summon"></button></div>'
				+ '<div class="row"><label data-i18n="toggleChip"></label><button data-act="rebindHide"><span data-el="hkHide"></span> <span data-i18n="rebind"></span></button></div>'
				+ '<div class="row"><label data-i18n="pauseRow"></label><button data-act="rebindPause"><span data-el="hkPause"></span> <span data-i18n="rebind"></span></button></div>'
				+ '<div class="row"><label data-i18n="selfCheck"></label><button data-act="test" data-i18n="test"></button><button data-act="diag" data-i18n="diag"></button></div>'
				+ '<div class="row"><label data-i18n="ondevUnavailable"></label><button data-act="useonline" data-i18n="useOnline"></button></div>'
				+ '<div class="row"><label data-i18n="localModel"></label><button data-act="warmlocal" data-i18n="warmLocal"></button><button data-act="uselocal" data-i18n="useLocal"></button></div>'
				+ '<div class="row"><label data-i18n="workerMode"></label><select data-set="workerMode"><option value="auto" data-i18n="wmAuto"></option><option value="shared">SharedWorker</option><option value="dedicated">Worker</option></select></div>'
				+ '<div class="row"><label data-i18n="multiMode"></label><select data-set="multiMode"><option value="two-hop" data-i18n="mmTwoHop"></option><option value="nllb">NLLB 600M</option></select></div>'
				+ '<div class="row"><label data-i18n="singlePair"></label><select data-el="pairSel"><option value="en>zh">en → zh</option><option value="zh>en">zh → en</option><option value="ja>zh">ja → zh (NLLB)</option><option value="ko>zh">ko → zh (NLLB)</option></select><button data-act="warmPair" data-i18n="warmPair"></button></div>'
				+ '<div class="row"><label data-i18n="abort"></label><button data-act="cancelWarm" data-i18n="cancelWarm"></button></div>'
				+ '<div class="row"><label data-i18n="sessionLimit"></label><input type="number" min="0" step="1000" data-set="maxChars" style="width:96px"><button data-act="resetChars" data-i18n="resetChars"></button></div>'
				+ '<div class="row"><label data-i18n="compactChip"></label><input type="checkbox" data-set="chipCompact"></div>'
				+ '<div class="row"><label data-i18n="translateCode"></label><input type="checkbox" data-set="translateCode"></div>'
				+ '<div class="row"><button data-act="clearHostCache" data-i18n="clearHostCache"></button></div>'
				+ '<div class="row"><button data-act="resetpos" data-i18n="resetPos"></button><button data-act="hide" data-i18n="hideChip"></button><button data-act="clearcache" data-i18n="clearCache"></button></div>'
				+ '<div class="row"><button data-act="rescan" data-i18n="rescan"></button><button data-act="restore" data-i18n="restore"></button></div>'
				+ '<div class="hint" data-el="status"></div>'
				+ '<div class="pbar" data-el="pbar"><div class="pfill" data-el="pfill"></div></div>'
				+ '<textarea class="errbox" data-el="errbox" readonly rows="4" spellcheck="false"></textarea>'
				+ '<div class="row"><button data-act="savediag" data-i18n="saveDiag"></button><button data-act="copydiag" data-i18n="copyDiag"></button></div>'
				+ '<div class="row"><button data-act="retry" data-i18n="retry"></button><button data-act="toggleAll" data-i18n="toggleAll"></button><button data-act="help" data-i18n="helpBtn"></button></div>'
				+ '<div class="help" data-el="help"></div>'
				+ '<div class="hint" data-i18n="footerHint"></div>';
			var chip = document.createElement('div');
			chip.className = 'chip';
			chip.title = '拖动可移动 · 单击打开设置';
			chip.innerHTML = '<span class="dot"></span><span class="label" data-el="chiptext">译</span>';
			chipEl = chip.querySelector('.dot');
			chipNode = chip;
			sr.appendChild(cardEl);
			sr.appendChild(chip);
			document.documentElement.appendChild(host);
			statusEl = cardEl.querySelector('[data-el="status"]');

			var tgtSel = cardEl.querySelector('[data-set="target"]');
			TARGETS.forEach(function (t) { var o = document.createElement('option'); o.value = t[0]; o.textContent = t[0] + ' · ' + t[1]; tgtSel.appendChild(o); });
			var srcSel = cardEl.querySelector('[data-set="latinSource"]');
			[['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['auto', '自动检测']].forEach(function (t) { var o = document.createElement('option'); o.value = t[0]; o.textContent = t[1]; srcSel.appendChild(o); });
			// 拖动移动 + 单击开卡（拖动中不触发点击）
			var dragState = null;
			chip.addEventListener('pointerdown', function (e) {
				dragState = { x: e.clientX, y: e.clientY, moved: false };
				try { chip.setPointerCapture(e.pointerId); } catch (err) { }
				chip.classList.add('dragging');
			});
			chip.addEventListener('pointermove', function (e) {
				if (!dragState) return;
				var dx = e.clientX - dragState.x, dy = e.clientY - dragState.y;
				if (!dragState.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
				dragState.moved = true;
				var rect = chip.getBoundingClientRect();
				var left = Math.min(Math.max(4, e.clientX - rect.width / 2), window.innerWidth - rect.width - 4);
				var top = Math.min(Math.max(4, e.clientY - rect.height / 2), window.innerHeight - rect.height - 4);
				host.style.left = left + 'px'; host.style.top = top + 'px'; host.style.right = 'auto'; host.style.bottom = 'auto';
			});
			function endDrag() {
				if (!dragState) return;
				var moved = dragState.moved;
				dragState = null;
				chip.classList.remove('dragging');
				if (moved) {
					var rect = chip.getBoundingClientRect();
					settings.chipPos = { left: Math.round(rect.left), top: Math.round(rect.top) };
					saveSettings();
					placeChip();
				} else {
					cardEl.classList.toggle('open');
				}
			}
			chip.addEventListener('pointerup', endDrag);
			chip.addEventListener('pointercancel', endDrag);
			cardEl.addEventListener('click', function (e) {
				var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
				if (act === 'close') cardEl.classList.remove('open');
				else if (act === 'rescan') { stats.chars = 0; lastError = ''; scanRoot(document.body, 0); updateStatus(); }
				else if (act === 'restore') restoreAll();
				else if (act === 'clearcache') { cache.clear(); cacheDirty = true; cacheFlush(); stats.chars = 0; updateStatus(); }
				else if (act === 'warm') warmUp();
				else if (act === 'test') testTranslate();
				else if (act === 'diag') {
					var full = diagnose();
					var box = cardEl && cardEl.querySelector('[data-el="errbox"]');
					if (box) { box.value = full; box.style.display = 'block'; box.scrollTop = 0; }
					if (statusEl) statusEl.textContent = '诊断已生成(' + full.length + ' 字);点「保存诊断到本机」或「复制诊断」';
				}
				else if (act === 'savediag') saveDiagToHost();
				else if (act === 'retry') {
					lastError = '';
					stats.chars = 0;                 // 重试即开启新一轮会话，否则会立刻再次撞上限
					records = []; recordByNode = new WeakMap(); processed = new WeakSet(); translatedCount = 0;
					if (!localWarm) warmLocal();
					scanRoot(document.body, 0);
					updateStatus();
				}
				else if (act === 'resetChars') {
					stats.chars = 0;
					lastError = '';
					updateStatus();
					scanRoot(document.body, 0);
				}
				else if (act === 'toggleAll') toggleAll();
				else if (act === 'help') {
					var helpEl = cardEl && cardEl.querySelector('[data-el="help"]');
					if (helpEl) {
						helpEl.textContent = helpText();
						helpEl.classList.toggle('on');
					}
				}
				else if (act === 'copydiag') copyDiag();
				else if (act === 'warmlocal') warmLocal();
				else if (act === 'warmPair') {
					var sel = cardEl.querySelector('[data-el="pairSel"]');
					var parts = String(sel && sel.value || 'en>zh').split('>');
					warmPair(parts[0], parts[1]);
				}
				else if (act === 'cancelWarm') cancelWarm();
				else if (act === 'clearHostCache') {
					fetch('/dsh-auto-translate/cache-clear', { method: 'POST' }).then(function () {
						hostCacheInfo = '';
						if (statusEl) statusEl.textContent = t('cacheCleared');
						refreshHostCacheInfo();
					}).catch(function () { });
				}
				else if (act === 'summon') summonPanel();
				else if (act === 'rebindSummon') { rebinding = 'hotkeySummon'; if (statusEl) statusEl.textContent = '请按下新的「呼出面板」组合键…（Esc 取消）'; }
				else if (act === 'rebindHide') { rebinding = 'hotkeyHide'; if (statusEl) statusEl.textContent = '请按下新的「显示/隐藏圆点」组合键…（Esc 取消）'; }
				else if (act === 'rebindPause') { rebinding = 'hotkeyPause'; if (statusEl) statusEl.textContent = '请按下新的「暂停/恢复」组合键…（Esc 取消）'; }
				else if (act === 'uselocal') {
					if (settings.engine === 'hover') {
						// 悬停模式下这两个按钮是「选哪个引擎来翻」的开关，不改变触发方式
						settings.hoverEngine = 'local';
						saveSettings();
						applySettingsToUI();
						warmLocal();
						if (statusEl) statusEl.textContent = '悬停模式：改用【本机离线】翻译（悬停 ' + Math.round(settings.hoverDelayMs / 100) / 10 + ' 秒触发）';
					} else {
						settings.engine = 'local';
						saveSettings();
						applySettingsToUI();
						records = []; recordByNode = new WeakMap(); processed = new WeakSet(); translatedCount = 0;
						scanRoot(document.body, 0);
						warmLocal();
						updateStatus();
					}
				}
				else if (act === 'useonline') {
					if (settings.engine === 'hover') {
						settings.hoverEngine = 'online';
						saveSettings();
						applySettingsToUI();
						if (statusEl) statusEl.textContent = '悬停模式：改用【在线免密钥】翻译（有每日额度限制）';
					} else {
						settings.engine = 'online';
						saveSettings();
						applySettingsToUI();
						records = []; recordByNode = new WeakMap(); processed = new WeakSet(); translatedCount = 0;
						scanRoot(document.body, 0);
						updateStatus();
					}
				}
				else if (act === 'hide') { settings.chipHidden = true; saveSettings(); applySettingsToUI(); }
				else if (act === 'resetpos') { settings.chipPos = null; saveSettings(); applySettingsToUI(); }
			});
			cardEl.addEventListener('change', function (e) {
				var key = e.target && e.target.getAttribute && e.target.getAttribute('data-set');
				if (!key) return;
				var val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
				if (key === 'hoverDelayMs' || key === 'cacheLimit') val = Number(val) || 0;
				settings[key] = val;
				saveSettings();
				if (key === 'lang') applyI18n();
				applySettingsToUI();
				if (key === 'enabled') { if (!settings.enabled) restoreAll(); else scanRoot(document.body, 0); }
				if (key === 'workerMode') { resetWorker('mode-change'); }
				if (key === 'multiMode' && localWorker && localWorker.post) { localWorker.post({ type: 'config', multiMode: settings.multiMode }); }
				if (key === 'engine' || key === 'target' || key === 'latinSource') { records = []; recordByNode = new WeakMap(); processed = new WeakSet(); translatedCount = 0; scanRoot(document.body, 0); }
			});
			applyI18n();
			applySettingsToUI();
			updateStatus();
		}
		function placeChip() {
			if (!hostEl) return;
			var pos = settings.chipPos;
			if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
				hostEl.style.left = pos.left + 'px'; hostEl.style.top = pos.top + 'px'; hostEl.style.right = 'auto'; hostEl.style.bottom = 'auto';
			} else {
				hostEl.style.left = '10px'; hostEl.style.top = 'auto'; hostEl.style.right = 'auto'; hostEl.style.bottom = '10px';
			}
			hostEl.style.display = settings.chipHidden ? 'none' : 'block';
			if (cardEl) {
				var rect = hostEl.getBoundingClientRect();
				var above = rect.top > 380;
				cardEl.style.bottom = above ? 'calc(100% + 8px)' : 'auto';
				cardEl.style.top = above ? 'auto' : 'calc(100% + 8px)';
				// 距离右边缘过近（放不下 290px 卡片）时改为向左展开，避免出屏
				var spaceRight = window.innerWidth - rect.right;
				var flipLeft = spaceRight < 306;
				cardEl.style.left = flipLeft ? 'auto' : '0';
				cardEl.style.right = flipLeft ? '0' : 'auto';
			}
		}
		function applySettingsToUI() {
			if (!cardEl) return;
			cardEl.querySelectorAll('[data-set]').forEach(function (el) {
				var key = el.getAttribute('data-set');
				if (!(key in settings)) return;
				if (el.type === 'checkbox') el.checked = !!settings[key];
				else el.value = settings[key];
			});
			if (chipEl) chipEl.className = 'dot' + (settings.enabled && settings.engine !== 'off' ? (lastError ? ' warn' : '') : ' off');
			var chipText = chipEl && chipEl.parentElement && chipEl.parentElement.querySelector('[data-el="chiptext"]');
			if (chipText) {
				if (localProgress) chipText.textContent = t('chipLabel') + ' ' + (localProgress.progress ? Math.round(localProgress.progress) + '%' : '…');
				else chipText.textContent = t('chipLabel') + ' ' + settings.target;
			}
			if (chipNode) { chipNode.classList.toggle('compact', !!settings.chipCompact); chipNode.classList.toggle('hidden', !!settings.chipHidden); }
			var hkS = cardEl && cardEl.querySelector('[data-el="hkSummon"]'); if (hkS) hkS.textContent = settings.hotkeySummon || '(未设置)';
			var hkH = cardEl && cardEl.querySelector('[data-el="hkHide"]'); if (hkH) hkH.textContent = settings.hotkeyHide || '(未设置)';
			var hkP = cardEl && cardEl.querySelector('[data-el="hkPause"]'); if (hkP) hkP.textContent = settings.hotkeyPause || '(未设置)';
			placeChip();
		}
		async function warmUp() {
			// 用户手势触发的模型下载/初始化
			try {
				var pair = settings.latinSource === 'auto' ? 'en' : settings.latinSource;
				await getTranslator(pair, String(settings.target).split('-')[0]);
				await getDetector();
				updateStatus();
			} catch (e) {
				if (statusEl) statusEl.textContent = '端侧引擎初始化失败：' + (e && e.message ? e.message : e);
			}
		}
		async function testTranslate() {
			if (!statusEl) return;
			var sample = 'Hello, this is a translation test from the DSH auto-translate plugin.';
			statusEl.textContent = '测试中…';
			try {
				var src = (await planSource(sample)) || (settings.latinSource === 'auto' ? 'en' : settings.latinSource);
				var out = await translateText(sample, src, String(settings.target).split('-')[0]);
				statusEl.textContent = '测试 OK [' + src + ' → ' + settings.target + '] ' + String(out).slice(0, 70);
			} catch (e) {
				lastError = String(e && e.message ? e.message : e);
				statusEl.textContent = '测试失败: ' + String(lastError).slice(0, 80) + '(完整见下方框)';
			}
			updateStatus();
		}
		function diagnose() {
			var T = translatorCtor();
			return JSON.stringify({
				version: settings.version,
				ua: navigator.userAgent,
				engine: settings.engine, target: settings.target, latinSource: settings.latinSource,
				onlineOrder: settings.onlineOrder,
				onDeviceTranslator: !!T,
				languageDetector: !!(typeof self.LanguageDetector === 'function' || (self.ai && self.ai.languageDetector)),
				stats: stats, lastError: lastError, cacheSize: cache.size,
				localWarm: localWarm, localWarming: localWarming, localBooted: localBooted, localProgress: localProgress,
				detectorDisabled: detectorDisabled, workerRecoveries: workerRecoveries, queue: queue.length, records: records.length,
				storage: storageInfo, limits: { queue: QUEUE_MAX, records: RECORDS_MAX },
				loadedPairs: Object.keys(loadedPairs), warmingPair: warmingPair,
				skipReasons: Object.keys(skipReasons).sort(function (a, b) { return skipReasons[b] - skipReasons[a]; }).slice(0, 8).map(function (k) { return k + '=' + skipReasons[k]; }),
				avgLatencyMs: localLatencyCount ? Math.round(localLatencySum / localLatencyCount) : 0,
				pendingSettle: dirtyNodes.size,
				records: records.length, panelMounted: !!hostEl, enabled: settings.enabled
			});
		}
		function copyDiag() {
			var payload = diagnose();
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(payload).then(
						function () { if (statusEl) statusEl.textContent = '诊断已复制到剪贴板(' + payload.length + ' 字)'; },
						function () { fallbackCopy(payload); });
					return;
				}
			} catch (e) { /* fall through */ }
			fallbackCopy(payload);
		}
		function fallbackCopy(text) {
			try {
				var ta = document.createElement('textarea');
				ta.value = text;
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				document.execCommand('copy');
				document.body.removeChild(ta);
				if (statusEl) statusEl.textContent = '诊断已复制(' + text.length + ' 字)';
			} catch (e) {
				if (statusEl) statusEl.textContent = '复制失败 → 请点「保存诊断到本机」';
			}
		}
		function saveDiagToHost() {
			var payload = diagnose();
			try {
				fetch('/dsh-auto-translate/diag', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: payload,
				}).then(function (r) { return r.json(); }).then(function (j) {
					if (statusEl) statusEl.textContent = (j && j.ok) ? ('诊断已保存到本机: ' + j.file) : ('保存失败: ' + JSON.stringify(j));
				}).catch(function (e) {
					if (statusEl) statusEl.textContent = '保存请求失败(' + ((e && e.message) || e) + ') → 改用剪贴板';
					fallbackCopy(payload);
				});
			} catch (e) { fallbackCopy(payload); }
		}
		function setEnabled(on) {
			settings.enabled = !!on;
			saveSettings();
			applySettingsToUI();
			if (!settings.enabled) restoreAll(); else scanRoot(document.body, 0);
		}

		// ===================== 启动 =====================
		var started = false;
		function start() {
			if (started) return;
			started = true;
			try { buildPanel(); } catch (e) { console.warn('[dsh-auto-translate] panel', e); }
			window.addEventListener('resize', function () { placeChip(); });
			document.addEventListener('mouseover', onOver, true);
			document.addEventListener('mouseout', onOut, true);
			document.addEventListener('keydown', function (e) {
				var combo = comboOf(e);
				if (!combo) return;
				if (rebinding) {
					e.preventDefault(); e.stopPropagation();
					settings[rebinding] = combo;
					rebinding = null;
					saveSettings();
					applySettingsToUI();
					return;
				}
				if (combo === settings.hotkeySummon) { e.preventDefault(); e.stopPropagation(); summonPanel(); return; }
				if (combo === settings.hotkeyHide) { e.preventDefault(); e.stopPropagation(); settings.chipHidden = !settings.chipHidden; saveSettings(); applySettingsToUI(); return; }
				if (combo === settings.hotkeyPause) { e.preventDefault(); e.stopPropagation(); setEnabled(!settings.enabled); return; }
			}, true);
			try { mo = createObserver(); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (e) { }
			try {
				io = new IntersectionObserver(function (entries) {
					for (var i = 0; i < entries.length && i < 40; i++) {
						if (entries[i].isIntersecting) { io.unobserve(entries[i].target); scanRoot(entries[i].target, 1); }
					}
				}, { rootMargin: '300px 0px' });
			} catch (e) { }
			setTimeout(function () { scanRoot(document.body, 0); }, 900);
			refreshHostCacheInfo();
			// 启动自动预热：模型已在浏览器缓存里，只需重建会话（几百毫秒~数秒）
			if (settings.enabled && settings.engine !== 'off' && (settings.localWarmOnce || settings.engine === 'local')) {
				setTimeout(function () { try { warmLocal(); } catch (e) { } }, 1500);
			}
			window.__dshAutoTranslate = {
				settings: settings, scan: function () { scanRoot(document.body, 0); }, restore: restoreAll,
				enable: setEnabled, warmUp: warmUp, cache: cache, stats: function () { return { cached: cache.size, translated: translatedCount }; },
				showChip: function () { settings.chipHidden = false; saveSettings(); applySettingsToUI(); },
				test: testTranslate, diagnose: function () { return diagnose(); }, warmLocal: warmLocal, summon: summonPanel,
				saveDiag: saveDiagToHost, copyDiag: copyDiag, warmPair: warmPair, cancelWarm: cancelWarm,
				skipReasons: function () { return skipReasons; }
			};
			console.info('[dsh-auto-translate] active — on-device, zero LLM tokens');
		}
		function apply(ctx) {
			try {
				if (document.body) start();
				else document.addEventListener('DOMContentLoaded', start, { once: true });
			} catch (e) { console.warn('[dsh-auto-translate]', e); }
		}
		exports.apply = apply;
		exports.inject = [];
		// 供离线单测使用（不影响运行时）
		exports.__test = {
			scriptTag: scriptTag, chunkText: chunkText, comboOf: comboOf, hintFor: hintFor,
			mmLang: typeof mmLang === 'function' ? mmLang : null, inViewport: inViewport, planSource: planSource,
			sessionLimitActive: sessionLimitActive, sessionLimit: sessionLimit, settings: settings,
			actualModeFor: actualModeFor,
			limits: { QUEUE_MAX: QUEUE_MAX, RECORDS_MAX: RECORDS_MAX },
		};
		return module.exports;
	}
});

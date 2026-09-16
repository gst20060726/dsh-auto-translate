/**
 * dsh-auto-translate — 本地翻译 Worker v5（浏览器内 WASM 推理）
 *
 * 同一份代码同时支持两种装载方式：
 *   · SharedWorker（默认）：同源多个标签页共用一份 WASM 会话，内存不翻倍
 *   · 独立 Worker：作为回退（SharedWorker 不可用，或需要"硬杀自愈"时）
 * 模型请求走宿主半同源代理；按语向懒加载，只用干净图（fp32 / fp16）。
 */
const BASE = self.location.origin + '/dsh-auto-translate/vendor/';
const BUNDLE = BASE + 'transformers.esm.v2.js';

// 锁定模型 revision：上游改模型不影响行为，可复现、可回滚
const REVISIONS = {
  'Xenova/opus-mt-en-zh': '046f55aec303cdee3e0318604406d4df20f1e8ea',
  'Xenova/opus-mt-zh-en': '39d480d52a9ea3065a1f117adfe4dbc55de10e6f',
  'Xenova/opus-mt-ja-en': 'main',
  'Xenova/opus-mt-ko-en': 'main',
  'Xenova/nllb-200-distilled-600M': '261c31d1a5732c67cdd16d80e8d6088507c7ccea',
};

// 只用干净图：量化变体含 DequantizeLinear/MatMulNBits，会崩在本机 ORT 的 QDQ 优化器上
const LADDER = [
  { label: 'fp32', opts: { dtype: 'fp32' } },
  { label: 'fp16', opts: { dtype: 'fp16' } },
];

// 多语种策略：two-hop 便宜快（各 74M 模型），nllb 质量好但 fp32 约 5GB
let MULTI_MODE = 'two-hop';

let libPromise = null;
let lib = null;

function norm(code) {
  const c = String(code || '');
  if (c === 'zh-CN' || c === 'zh-Hans' || c === 'zh') return 'zh';
  if (c === 'zh-TW' || c === 'zh-HK' || c === 'zh-Hant') return 'zh-Hant';
  return c.split('-')[0];
}

const NLLB_LANG = {
  en: 'eng_Latn', zh: 'zho_Hans', 'zh-Hant': 'zho_Hant', ja: 'jpn_Jpan', ko: 'kor_Hang',
  fr: 'fra_Latn', de: 'deu_Latn', es: 'spa_Latn', pt: 'por_Latn', it: 'ita_Latn',
  ru: 'rus_Cyrl', ar: 'arb_Arab', hi: 'hin_Deva', th: 'tha_Thai', vi: 'vie_Latn',
  tr: 'tur_Latn', id: 'ind_Latn', nl: 'nld_Latn', pl: 'pol_Latn', he: 'heb_Hebr', el: 'ell_Grek',
};

function progressReporter(key, respond) {
  return (data) => {
    try {
      if (!data) return;
      respond({
        type: 'progress', key,
        status: data.status, file: data.file, progress: data.progress,
        loaded: data.loaded, total: data.total,
      });
    } catch (e) { /* ignore */ }
  };
}

async function getLib(respond) {
  if (lib) return lib;
  if (!libPromise) {
    libPromise = (async () => {
      let mod;
      try {
        mod = await import(BUNDLE);
      } catch (e) {
        respond({ type: 'fatal', where: 'import ' + BUNDLE, error: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 400) });
        throw e;
      }
      const env = mod.env;
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = true;
      env.remoteHost = self.location.origin;
      env.remotePathTemplate = 'dsh-auto-translate/model-v2/{model}/resolve/{revision}/';
      try {
        env.backends.onnx.wasm.wasmPaths = BASE + 'ort/';
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.proxy = false;
      } catch (e) { /* ignore */ }
      lib = mod;
      return mod;
    })();
  }
  return libPromise;
}

const pipes = {};
async function loadPipe(key, model, respond) {
  const mod = await getLib(respond);
  const errors = [];
  for (const step of LADDER) {
    try {
      respond({ type: 'ladder', key, model, step: step.label });
      const opts = Object.assign({ revision: REVISIONS[model] || 'main', progress_callback: progressReporter(key, respond) }, step.opts);
      const pipe = await mod.pipeline('translation', model, opts);
      respond({ type: 'loaded', key, model, variant: step.label });
      return pipe;
    } catch (e) {
      const msg = String((e && e.message) || e);
      errors.push(step.label + ': ' + msg.slice(0, 160));
      respond({ type: 'ladderFail', key, step: step.label, error: msg.slice(0, 200) });
    }
  }
  throw new Error('所有精度组合均失败 → ' + errors.join(' | '));
}
async function getPipe(key, model, respond) {
  if (pipes[key]) return pipes[key];
  pipes[key] = loadPipe(key, model, respond);
  try { return await pipes[key]; } catch (e) { delete pipes[key]; throw e; }
}

async function oneHop(src, tgt, text, respond) {
  const p = await getPipe(src + '-' + tgt, 'Xenova/opus-mt-' + src + '-' + tgt, respond);
  const out = await p(text);
  return (out && out[0] && out[0].translation_text) || '';
}

async function doTranslate(text, srcRaw, tgtRaw, respond) {
  const src = norm(srcRaw), tgt = norm(tgtRaw);
  if (src === tgt) return text;
  if (src === 'en' && tgt === 'zh') return await oneHop('en', 'zh', text, respond);
  if (src === 'zh' && tgt === 'en') return await oneHop('zh', 'en', text, respond);
  if (MULTI_MODE === 'two-hop') {
    if (tgt === 'zh') { const viaEn = await oneHop(src, 'en', text, respond); return await oneHop('en', 'zh', viaEn, respond); }
    if (tgt === 'en') return await oneHop(src, 'en', text, respond);
  }
  const s = NLLB_LANG[src], t = NLLB_LANG[tgt];
  if (!s || !t) throw new Error('本地模型不支持该语向: ' + src + '>' + tgt);
  const p = await getPipe('nllb', 'Xenova/nllb-200-distilled-600M', respond);
  const out = await p(text, { src_lang: s, tgt_lang: t });
  return (out && out[0] && out[0].translation_text) || '';
}

async function handle(msg, respond) {
  const id = msg && msg.id;
  try {
    if (msg.type === 'ping') { await getLib(respond); respond({ id, ok: true, pong: true }); return; }
    if (msg.type === 'config') { if (msg.multiMode) MULTI_MODE = msg.multiMode; respond({ id, ok: true, multiMode: MULTI_MODE }); return; }
    if (msg.type === 'reset') {
      // 共享模式不能 terminate：清掉会话，让下次从浏览器缓存重建
      for (const k of Object.keys(pipes)) delete pipes[k];
      respond({ id, ok: true, reset: true });
      return;
    }
    if (msg.type === 'warm') {
      const sample = String(msg.text || 'Hello.');
      await doTranslate(sample, msg.src || 'en', msg.tgt || 'zh', respond);
      respond({ id, ok: true, warm: true, src: msg.src || 'en', tgt: msg.tgt || 'zh' });
      return;
    }
    if (msg.type === 'translate') {
      const out = await doTranslate(String(msg.text || ''), msg.src, msg.tgt, respond);
      respond({ id, ok: true, text: out });
      return;
    }
    respond({ id, ok: false, error: 'unknown message type: ' + msg.type });
  } catch (e) {
    respond({ id, ok: false, error: String((e && e.message) || e) });
  }
}

// SharedWorker：每个标签页一个 port；独立 Worker：直接用 self
if ('onconnect' in self) {
  self.onconnect = (ev) => {
    const port = ev.ports[0];
    port.onmessage = (e) => { handle(e.data, (m) => port.postMessage(m)); };
    try { port.start(); } catch (e) { /* ignore */ }
  };
} else {
  self.onmessage = (ev) => { handle(ev.data, (m) => self.postMessage(m)); };
}

self.__test = { REVISIONS: REVISIONS, NLLB_LANG: NLLB_LANG, LADDER: LADDER };

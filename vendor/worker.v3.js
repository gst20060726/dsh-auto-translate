/**
 * dsh-auto-translate — 本地翻译 Worker v3（浏览器内 WASM 推理）
 *
 * v3 变化：启动即自报({type:'boot'})；库导入失败时上报详细原因({type:'fatal'})，
 * 便于区分「worker 没跑起来」与「模型/下载失败」。
 */
self.postMessage({ type: 'boot', origin: self.location.origin });

const BASE = self.location.origin + '/dsh-auto-translate/vendor/';
const BUNDLE = BASE + 'transformers.esm.v2.js';

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

function progressReporter(key) {
  return (data) => {
    try {
      if (!data) return;
      self.postMessage({
        type: 'progress', key,
        status: data.status, file: data.file, progress: data.progress,
        loaded: data.loaded, total: data.total,
      });
    } catch (e) { /* ignore */ }
  };
}

async function getLib() {
  if (lib) return lib;
  if (!libPromise) {
    libPromise = (async () => {
      let mod;
      try {
        mod = await import(BUNDLE);
      } catch (e) {
        self.postMessage({
          type: 'fatal', where: 'import ' + BUNDLE,
          error: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 400),
        });
        throw e;
      }
      const env = mod.env;
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = true;
      env.remoteHost = 'https://hf-mirror.com';
      env.remotePathTemplate = '{model}/resolve/{revision}/';
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
async function getPipe(key, model, opts) {
  if (pipes[key]) return pipes[key];
  pipes[key] = (async () => {
    const mod = await getLib();
    const base = Object.assign({ progress_callback: progressReporter(key) }, opts || {});
    let pipe;
    try {
      pipe = await mod.pipeline('translation', model, Object.assign({ quantized: true, dtype: 'q8' }, base));
    } catch (e) {
      pipe = await mod.pipeline('translation', model, base);
    }
    self.postMessage({ type: 'loaded', key, model });
    return pipe;
  })();
  try { return await pipes[key]; } catch (e) { delete pipes[key]; throw e; }
}

async function doTranslate(text, srcRaw, tgtRaw) {
  const src = norm(srcRaw), tgt = norm(tgtRaw);
  if (src === tgt) return text;
  if (src === 'en' && tgt === 'zh') {
    const p = await getPipe('en-zh', 'Xenova/opus-mt-en-zh');
    const out = await p(text);
    return (out && out[0] && out[0].translation_text) || '';
  }
  if (src === 'zh' && tgt === 'en') {
    const p = await getPipe('zh-en', 'Xenova/opus-mt-zh-en');
    const out = await p(text);
    return (out && out[0] && out[0].translation_text) || '';
  }
  const s = NLLB_LANG[src], t = NLLB_LANG[tgt];
  if (!s || !t) throw new Error('本地模型不支持该语向: ' + src + '>' + tgt);
  const p = await getPipe('nllb', 'Xenova/nllb-200-distilled-600M');
  const out = await p(text, { src_lang: s, tgt_lang: t });
  return (out && out[0] && out[0].translation_text) || '';
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    if (msg.type === 'ping') { await getLib(); self.postMessage({ id, ok: true, pong: true }); return; }
    if (msg.type === 'warm') { await doTranslate('Hello.', msg.src || 'en', msg.tgt || 'zh'); self.postMessage({ id, ok: true, warm: true }); return; }
    if (msg.type === 'translate') {
      const out = await doTranslate(String(msg.text || ''), msg.src, msg.tgt);
      self.postMessage({ id, ok: true, text: out });
      return;
    }
    self.postMessage({ id, ok: false, error: 'unknown message type: ' + msg.type });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e && e.message) || e) });
  }
};

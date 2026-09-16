/**
 * dsh-auto-translate 鈥?鏈湴缈昏瘧 Worker锛堟祻瑙堝櫒鍐?WASM 鎺ㄧ悊锛? *
 * - 搴撲笌 ORT 杩愯鏃跺叏閮ㄧ敱鎻掍欢瀹夸富鍗婁粠鏈満 vendor 鐩綍鎻愪緵锛堝悓婧愶紝涓嶈蛋 CDN锛? * - 妯″瀷鏂囦欢棣栨浠?hf-mirror.com 鎷夊彇锛坔uggingface.co 鍦ㄩ儴鍒嗙綉缁滀笉鍙揪锛夛紝
 *   涔嬪悗鐢?transformers.js 瀛樺叆娴忚鍣?Cache Storage 鈫?鍚庣画瀹屽叏绂荤嚎
 * - 鍗曠嚎绋?WASM锛涗笉娑堣€椾换浣?LLM token锛屼笉闄愰噺
 *
 * 璇悜锛? *   en 鈫?zh   Xenova/opus-mt-en-zh       锛?4M锛屽揩锛? *   zh 鈫?en   Xenova/opus-mt-zh-en       锛?4M锛屽揩锛? *   鍏跺畠      Xenova/nllb-200-distilled-600M锛?00M锛岃鐩?200 璇█锛岃緝鎱紝鎸夐渶涓嬭浇锛? */
const BASE = self.location.origin + '/dsh-auto-translate/vendor/';

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
      if (data && (data.status === 'progress' || data.status === 'download' || data.status === 'initiate')) {
        self.postMessage({ type: 'progress', key, status: data.status, file: data.file, progress: data.progress, loaded: data.loaded, total: data.total });
      }
    } catch (e) { /* ignore */ }
  };
}

async function getLib() {
  if (lib) return lib;
  if (!libPromise) {
    libPromise = (async () => {
      const mod = await import(BASE + 'transformers.esm.v2.js');
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
  if (!pipes[key]) {
    // 鍚屼竴涓ā鍨嬪苟鍙戝彧鍔犺浇涓€娆?    pipes[key] = (async () => {
      const mod = await getLib();
      const base = Object.assign({ progress_callback: progressReporter(key) }, opts || {});
      let pipe;
      try {
        pipe = await mod.pipeline('translation', model, Object.assign({ quantized: true, dtype: 'q8' }, base));
      } catch (e) {
        // 鏌愪簺鐗堟湰涓嶆帴鍙?dtype/quantized 鈫?閫€鍥為粯璁ょ簿搴﹂噸璇曚竴娆?        pipe = await mod.pipeline('translation', model, base);
      }
      self.postMessage({ type: 'loaded', key, model });
      return pipe;
    })();
    try { return await pipes[key]; } catch (e) { delete pipes[key]; throw e; }
  }
  return pipes[key];
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
  if (!s || !t) throw new Error('鏈湴妯″瀷涓嶆敮鎸佽璇悜锛堥渶 NLLB 璇█鐮侊級: ' + src + '>' + tgt);
  const p = await getPipe('nllb', 'Xenova/nllb-200-distilled-600M');
  const out = await p(text, { src_lang: s, tgt_lang: t });
  return (out && out[0] && out[0].translation_text) || '';
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    if (msg.type === 'ping') {
      await getLib();
      self.postMessage({ id, ok: true, pong: true });
      return;
    }
    if (msg.type === 'warm') {
      await doTranslate('Hello.', msg.src || 'en', msg.tgt || 'zh');
      self.postMessage({ id, ok: true, warm: true });
      return;
    }
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

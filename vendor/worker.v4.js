/**
 * dsh-auto-translate — 本地翻译 Worker v4（浏览器内 WASM 推理）
 *
 * v4：模型请求走宿主半同源代理；量化模型与 ORT 版本不兼容时按「回退阶梯」逐级尝试。
 */
self.postMessage({ type: 'boot', origin: self.location.origin });

const BASE = self.location.origin + '/dsh-auto-translate/vendor/';
const BUNDLE = BASE + 'transformers.esm.v2.js';

// 锁定模型 revision：上游改一次模型就可能行为变化或复现旧 bug，锁版本后才可复现、可回滚
const REVISIONS = {
  'Xenova/opus-mt-en-zh': '046f55aec303cdee3e0318604406d4df20f1e8ea',
  'Xenova/opus-mt-zh-en': '39d480d52a9ea3065a1f117adfe4dbc55de10e6f',
  'Xenova/nllb-200-distilled-600M': '261c31d1a5732c67cdd16d80e8d6088507c7ccea',
};
self.__test = { REVISIONS: REVISIONS };

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

// 量化模型与 ORT 版本的兼容性阶梯：从省流量到保成功
// 只用「干净图」：已核实该仓库的 fp32/_model.onnx 与 _fp16 不含任何量化算子，
// 而 int8/uint8/quantized/q4/bnb4 都含 DequantizeLinear/MatMulNBits，
// 会在本机 ORT(1.26-dev) 的 QDQ 优化器上崩：
//   qdq_actions.cc TransposeDQWeightsForMatMulNBits Missing required scale
// fp32 放在第一位：图最干净、wasm EP 支持最好（体积大，但已缓存在宿主磁盘）。
const LADDER = [
  { label: 'fp32', opts: { dtype: 'fp32' } },
  { label: 'fp16', opts: { dtype: 'fp16' } },
];

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
      env.remoteHost = self.location.origin;   // 走宿主半同源代理，避免跨域重定向丢 CORS
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
async function loadPipe(key, model) {
  const mod = await getLib();
  const errors = [];
  for (const step of LADDER) {
    try {
      self.postMessage({ type: 'ladder', key, model, step: step.label });
      const opts = Object.assign({ revision: REVISIONS[model] || 'main', progress_callback: progressReporter(key) }, step.opts);
      const pipe = await mod.pipeline('translation', model, opts);
      self.postMessage({ type: 'loaded', key, model, variant: step.label });
      return pipe;
    } catch (e) {
      const msg = String((e && e.message) || e);
      errors.push(step.label + ': ' + msg.slice(0, 160));
      self.postMessage({ type: 'ladderFail', key, step: step.label, error: msg.slice(0, 200) });
    }
  }
  throw new Error('所有精度/优化组合均失败 → ' + errors.join(' | '));
}
async function getPipe(key, model) {
  if (pipes[key]) return pipes[key];
  pipes[key] = loadPipe(key, model);
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

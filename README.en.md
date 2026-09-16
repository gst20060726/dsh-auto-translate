# dsh-auto-translate

> Zero-token auto-translation for the DeepSeek Harness web GUI. Foreign text is translated **in place**; hover ~0.6s to flip between the translation and the original.

MIT · DeepSeek Harness `0.1.5-rc.1`+ · Chrome/Edge 116+

## Why "zero token"

- **No LLM is called** — no DSH model traffic, no API cost.
- Translation runs **inside your browser** via ONNX Runtime WebAssembly (transformers.js). The model is downloaded once, then works offline.
- Results are cached per sentence; the same sentence is never translated twice.
- Text to translate **never leaves your machine** (only model weights are fetched, from a mirror).

## Install

    # npm (once published)
    dsh plugin --profile web add dsh-auto-translate

    # local directory
    dsh plugin --profile web add link:/absolute/path/to/dsh-auto-translate

    # straight from GitHub
    dsh plugin --profile web add github:<you>/dsh-auto-translate

Restart `dsh web` and refresh the browser. A translucent chip labelled 译 appears at the bottom-left.

## Usage

| Action | Effect |
| --- | --- |
| automatic | foreign text on screen is replaced with the target language |
| hover ~0.6s | that block flips back to the original; move away and hover again to flip back |
| `Alt` + hover | flip immediately |
| `Ctrl+Alt+T` | open/close the panel (use this if you lost the chip) |
| `Ctrl+Alt+H` | show/hide the chip |
| `Ctrl+Alt+P` | pause/resume translation |

All three hotkeys are rebindable inside the panel.

## Engines

| Engine | Tokens | Network | Notes |
| --- | --- | --- | --- |
| **On-device WASM (recommended)** | none | first model download only | ~425MB for en<->zh |
| Online keyless | none | every string goes to MyMemory | anonymous daily quota |
| Browser built-in | none | needs Google component servers | usually unreachable on some networks |
| Custom endpoint | none | your own service | e.g. self-hosted LibreTranslate |

## Local models

| Pair | Model | Size |
| --- | --- | --- |
| en -> zh | Xenova/opus-mt-en-zh | 200MB encoder + 225MB decoder |
| zh -> en | Xenova/opus-mt-zh-en | same |
| ja/ko/others -> zh | Xenova/nllb-200-distilled-600M | ~600MB, on demand |

Quantized exports of these repos trigger the ONNX Runtime error `TransposeDQWeightsForMatMulNBits Missing required scale`, so the plugin intentionally uses the clean **fp32** graphs.

## Troubleshooting

- Chip missing: press `Ctrl+Alt+T`.
- Nothing translated: open the panel and check the counters (scanned / queued / translated / skipped / failed).
- Model load failure: click **Save diagnostics to file** and inspect `$DSH_HOME/dsh-auto-translate/diagnose-*.json`.
- Stuck download: click **Retry**; the host-side cache resumes and retries automatically.

## Architecture

    index.js      # host: static vendor route, same-origin model proxy with disk cache, diagnostics sink
    client.js     # browser: DOM scan, translation, hover toggle, settings panel
    vendor/
      worker.v4.js          # Web Worker: WASM inference, lazy per-pair pipelines
      transformers.esm.v2.js# transformers.js browser ESM with local ORT imports
      ort/                  # ONNX Runtime loaders (+ wasm fetched from CDN if absent)
    scripts/fetch-vendor.mjs# regenerate vendor/ for a fully offline install

## License

MIT

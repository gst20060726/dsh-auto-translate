/**
 * 抓 README 用的「悬停翻译」演示图组 —— **完全合成，不含任何真实会话内容**。
 *
 * 用法：
 *   node scripts/capture-demo.mjs [token] [outDir]
 *   不给 token 时按 launcher.log → dsh-web-server.log 的顺序找。
 *
 * 产出（outDir 默认 demo/，三张同尺寸 560×150）：
 *   hover-1-original.png    光标在空白处 · 英文原文（没触发翻译）
 *   hover-2-translated.png  光标停在文字上 · 已就地换成中文
 *   hover-3-restored.png    移开后再停一次 · 换回英文原文
 *
 * 两点如实说明：
 * 1. 画面是**合成舞台**：脚本往页面注入一块白底面版 + 一个对话块 + 一个光标标记。
 *    这样「光标在空白处」那帧里的空白也是我注入的，可以放大裁切而不带出真实会话。
 * 2. **操作系统光标截不到**（headless 截图不含指针），所以箭头是脚本画上去的标记，
 *    但它落在**真鼠标当时的坐标**上，而悬停本身是真实鼠标事件（page.mouse.move）。
 *
 * 为什么单独一个脚本，而不是塞进 verify-browser.mjs：
 * 那个是**验收工具**（会断言、会以非 0 退出），这里是**纯出图**。混在一起的话，
 * 为了出图而调整截图时机就可能动到验收判据 —— 不值得。
 *
 * 依赖与 verify-browser.mjs 相同：puppeteer-core（DSH 配置目录或本地 node_modules）+ 本机 Edge/Chrome。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');
const SETTINGS_KEY = 'dsh-auto-translate.settings.v1';
const STAGE_ID = 'dsh-at-stage';
const BLOCK_ID = 'dsh-at-demo';
const CURSOR_ID = 'dsh-at-cursor';
const PROBE_TEXT = 'The plan is ready — I refactored the parser and added tests.';
const STAGE = { x: 40, y: 40, width: 560, height: 150 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findToken() {
  if (process.argv[2] && !process.argv[2].startsWith('--')) return process.argv[2];
  const logs = [path.join(DSH_HOME, 'launcher', 'launcher.log'), path.join(DSH_HOME, 'dsh-web-server.log')];
  for (const log of logs) {
    try {
      const m = [...fs.readFileSync(log, 'utf8').matchAll(/[A-Za-z0-9_-]{43}|token=([A-Za-z0-9_-]+)/g)]
        .map((x) => x[1] || x[0]);
      if (m.length) return m[m.length - 1];
    } catch (e) { /* 换下一个日志 */ }
  }
  throw new Error('找不到 GUI token：请作为第一个参数传入');
}

function findPuppeteer() {
  const candidates = [
    path.join(DSH_HOME, 'profiles', 'web', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js'),
    path.join(DSH_HOME, 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return pathToFileURL(c).href;
  return 'puppeteer-core';
}

function findBrowser() {
  if (process.env.EDGE_PATH && fs.existsSync(process.env.EDGE_PATH)) return process.env.EDGE_PATH;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome/Edge 可执行文件：请设置 EDGE_PATH');
}

const token = findToken();
const outDir = process.argv[3] || path.join(process.cwd(), 'demo');
const URL_ = 'http://127.0.0.1:3080/?token=' + token;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-demo-'));
const report = { token: token.slice(0, 4) + '…', stage: STAGE, frames: [] };

const puppeteer = (await import(findPuppeteer())).default;
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 720 },
    args: ['--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions-except=', '--mute-audio'],
  });
} catch (e) {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e2) { }
  console.error('浏览器启动失败：' + e.message);
  process.exit(2);
}

/** 三帧必须同尺寸：按舞台矩形裁切（舞台是注入的，裁进来也没有真实内容）。 */
const shot = async (page, file) => {
  await page.screenshot({ path: path.join(outDir, file), clip: STAGE });
  report.frames.push({ file, bytes: fs.statSync(path.join(outDir, file)).size });
};

/** 把画上去的光标标记挪到 (x, y)（箭头尖即在坐标点上）。 */
const placeCursor = (page, x, y) => page.evaluate((id, cx, cy) => {
  const el = document.getElementById(id);
  el.style.left = cx + 'px';
  el.style.top = cy + 'px';
}, CURSOR_ID, x, y);

let failure = null;
try {
  fs.mkdirSync(outDir, { recursive: true });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((key) => {
    try {
      const cur = JSON.parse(localStorage.getItem(key) || '{}');
      // 用在线引擎出图：本机 WASM 要先下 425MB 模型，出图不值得
      localStorage.setItem(key, JSON.stringify(Object.assign({
        version: 6, engine: 'hover', hoverEngine: 'online', selectionMode: 'popup',
        lang: 'zh', target: 'zh', enabled: true, chipHidden: true, hoverDelayMs: 150,
      }, cur)));
    } catch (e) { }
  }, SETTINGS_KEY);
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dsh-auto-translate-root', { timeout: 30000 });
  await sleep(1200);

  // 合成舞台：白底面版 + 对话块 + 画上去的光标
  await page.evaluate((ids, box, text) => {
    const stage = document.createElement('div');
    stage.id = ids.stage;
    stage.style.cssText = 'position:fixed;left:' + box.x + 'px;top:' + box.y + 'px;width:' + box.width
      + 'px;height:' + box.height + 'px;box-sizing:border-box;z-index:2147483001;background:#f6f8fa;'
      + 'border:1px solid #d0d7de;border-radius:12px;padding:12px;';
    const block = document.createElement('p');
    block.id = ids.block;
    block.textContent = text;
    block.style.cssText = 'margin:0;box-sizing:border-box;width:100%;height:92px;overflow:hidden;'
      + 'font:15px/1.7 ui-sans-serif,system-ui,"Segoe UI",sans-serif;background:#ffffff;color:#111111;'
      + 'border:1px solid #d8dee4;border-radius:8px;padding:14px 16px;';
    const cursor = document.createElement('div');
    cursor.id = ids.cursor;
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483002;'
      + 'pointer-events:none;';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M2 1 L2 17.5 L6.2 13.4 L8.9 19.4 L11.6 18.2 L8.9 12.3 L14.6 12.1 Z" '
      + 'fill="#ffffff" stroke="#111111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    stage.appendChild(block);
    document.body.appendChild(stage);
    document.body.appendChild(cursor);
  }, { stage: STAGE_ID, block: BLOCK_ID, cursor: CURSOR_ID }, STAGE, PROBE_TEXT);
  await sleep(400);

  const box = await page.evaluate((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, BLOCK_ID);
  const onText = { x: Math.round(box.x + 120), y: Math.round(box.y + 46) };
  const empty = { x: Math.round(STAGE.x + 60), y: Math.round(STAGE.y + STAGE.height - 26) };
  const textOf = () => page.evaluate((id) => document.getElementById(id).textContent, BLOCK_ID);

  // ① 真鼠标停在空白处：不该翻译
  await page.mouse.move(empty.x, empty.y, { steps: 6 });
  await sleep(700);
  if ((await textOf()) !== PROBE_TEXT) throw new Error('光标在空白处却触发了翻译');
  await placeCursor(page, empty.x, empty.y);
  await shot(page, 'hover-1-original.png');

  // ② 真鼠标移到文字上 → 等就地翻译（在线引擎）
  await page.mouse.move(onText.x, onText.y, { steps: 6 });
  const translated = await page
    .waitForFunction((id, orig) => {
      const el = document.getElementById(id);
      return el.getAttribute('data-dsh-at') === 'translated' && el.textContent !== orig ? el.textContent : false;
    }, { timeout: 30000 }, BLOCK_ID, PROBE_TEXT)
    .then((h) => h.jsonValue())
    .catch(() => null);
  report.translated = translated;
  if (!translated) throw new Error('悬停翻译未生效（在线引擎；可能网络不可达/额度用尽）');
  await placeCursor(page, onText.x, onText.y);
  await shot(page, 'hover-2-translated.png');

  // ③ 移开 → 再停一次 → 换回原文（还原手势本身就是「再悬停」，所以这一帧光标仍在文字上）
  await page.mouse.move(empty.x, empty.y, { steps: 4 });
  await sleep(300);
  await page.mouse.move(onText.x, onText.y, { steps: 6 });
  const restored = await page
    .waitForFunction((id, orig) => document.getElementById(id).textContent === orig, { timeout: 30000 }, BLOCK_ID, PROBE_TEXT)
    .then(() => true)
    .catch(() => false);
  report.restored = restored;
  if (!restored) throw new Error('再停一次没有换回原文');
  await placeCursor(page, onText.x, onText.y);
  await shot(page, 'hover-3-restored.png');
  report.cursor = { onText, empty };
} catch (e) {
  failure = e.message;
} finally {
  if (browser) { try { await browser.close(); } catch (e) { } }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
}

report.ok = failure === null;
if (failure) report.error = failure;
console.log(JSON.stringify(report, null, 2));
process.exit(failure === null ? 0 : 1);

/**
 * 抓 README 用的「悬停翻译」演示图组 —— **完全合成，不含任何真实会话内容**。
 *
 * 用法：
 *   node scripts/capture-demo.mjs [token] [outDir]
 *   不给 token 时按 launcher.log → dsh-web-server.log 的顺序找，并逐个用 HTTP 200 校验。
 *
 * 产出（outDir 默认 demo/）：
 *   hover-1-original.png    注入的英文块（还没悬停）
 *   hover-2-translated.png  真鼠标停在上面之后：就地换成中文
 *   hover-3-restored.png    移开再停一次：换回原文
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
const PROBE_ID = 'dsh-at-demo';
const PROBE_TEXT = 'The plan is ready — I refactored the parser and added tests.';
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
const report = { token: token.slice(0, 4) + '…', frames: [] };

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

/** 三帧必须同样大小，所以注入块用固定宽高，并按它的矩形精确裁切（不含任何页面内容）。 */
const shot = async (page, box, file) => {
  await page.screenshot({ path: path.join(outDir, file), clip: box });
  const bytes = fs.statSync(path.join(outDir, file)).size;
  report.frames.push({ file, ...box, bytes });
  return bytes;
};

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
        lang: 'zh', target: 'zh', enabled: true, chipHidden: false, hoverDelayMs: 150,
      }, cur)));
    } catch (e) { }
  }, SETTINGS_KEY);
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#dsh-auto-translate-root', { timeout: 30000 });
  await sleep(1200);

  await page.evaluate((id, text) => {
    const d = document.createElement('div');
    d.id = id;
    d.textContent = text;
    d.style.cssText = 'position:fixed;left:40px;top:40px;width:540px;height:112px;box-sizing:border-box;'
      + 'z-index:2147483001;font:15px/1.7 ui-sans-serif,system-ui,"Segoe UI",sans-serif;padding:14px 16px;margin:0;'
      + 'background:#ffffff;color:#111111;border:1px solid #d0d7de;border-radius:10px;overflow:hidden';
    document.body.appendChild(d);
  }, PROBE_ID, PROBE_TEXT);
  await sleep(400);

  const box = await page.evaluate((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, PROBE_ID);
  const center = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };

  const textOf = () => page.evaluate((id) => document.getElementById(id).textContent, PROBE_ID);

  // ① 原文
  if ((await textOf()) !== PROBE_TEXT) throw new Error('注入的合成块被意外改写');
  await shot(page, box, 'hover-1-original.png');

  // ② 真鼠标移上去 → 等就地翻译
  await page.mouse.move(center.x, center.y, { steps: 6 });
  const translated = await page
    .waitForFunction((id, orig) => {
      const el = document.getElementById(id);
      return el.getAttribute('data-dsh-at') === 'translated' && el.textContent !== orig ? el.textContent : false;
    }, { timeout: 30000 }, PROBE_ID, PROBE_TEXT)
    .then((h) => h.jsonValue())
    .catch(() => null);
  report.translated = translated;
  if (!translated) throw new Error('悬停翻译未生效（在线引擎；可能网络不可达/额度用尽）');
  await shot(page, box, 'hover-2-translated.png');

  // ③ 移开 → 再停一次 → 应换回原文
  await page.mouse.move(center.x, 680, { steps: 4 });
  await sleep(300);
  await page.mouse.move(center.x, center.y, { steps: 6 });
  const restored = await page
    .waitForFunction((id, orig) => document.getElementById(id).textContent === orig, { timeout: 30000 }, PROBE_ID, PROBE_TEXT)
    .then(() => true)
    .catch(() => false);
  report.restored = restored;
  if (!restored) throw new Error('再停一次没有换回原文');
  await shot(page, box, 'hover-3-restored.png');
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

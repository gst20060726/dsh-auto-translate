/**
 * 真浏览器验收（可选工具，不在 npm test 里跑，因为它需要本机 Chrome/Edge + puppeteer-core）
 *
 * 为什么需要它：jsdom 没有布局引擎，测不出「面板太高要滚动」「文字被裁」「CSS 变量/伪元素
 * 内容没渲染」这类问题；真机还能用**真实鼠标事件**验证悬停翻译、用真实 mouseup 验证框选浮层。
 *
 * 用法：
 *   node scripts/verify-browser.mjs                     # token 自动从 ~/.dsh/dsh-web-server.log 读
 *   node scripts/verify-browser.mjs <token> <outPrefix>
 *
 * 依赖发现（找不到就明确报错退出，不静默跳过）：
 *   - puppeteer-core：优先 DSH 配置目录里的 node_modules，其次正常 require 解析
 *   - Edge/Chrome：EDGE_PATH 环境变量 → 常见安装路径
 *
 * 注意：它用**独立临时 profile**启动浏览器，不碰用户正在用的浏览器数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');
const LOG = path.join(DSH_HOME, 'dsh-web-server.log');
const SETTINGS_KEY = 'dsh-auto-translate.settings.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findToken() {
  if (process.argv[2] && !process.argv[2].startsWith('--')) return process.argv[2];
  try {
    const m = [...fs.readFileSync(LOG, 'utf8').matchAll(/token=([A-Za-z0-9_-]+)/g)];
    if (m.length) return m[m.length - 1][1];
  } catch (e) { }
  throw new Error('找不到 GUI token：请把 token 作为第一个参数传入（见 ' + LOG + '）');
}

function findPuppeteer() {
  const candidates = [
    path.join(DSH_HOME, 'profiles', 'web', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js'),
    path.join(DSH_HOME, 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return pathToFileURL(c).href;
  return 'puppeteer-core';   // 交给正常模块解析（装成依赖时）
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
const URL_ = 'http://127.0.0.1:3080/?token=' + token;
const outPrefix = process.argv[3] || path.join(process.cwd(), 'panel-preview');
const OUT = outPrefix + '.png';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-verify-'));
const report = { token: token.slice(0, 4) + '…', phase: {} };
const failures = [];

const puppeteer = (await import(findPuppeteer())).default;
let browser = null;
try {
  browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    userDataDir: profile,
    defaultViewport: { width: 1400, height: 900 },
    // --disable-extensions-except= 是必要的：Edge 装上解压扩展后，全新 profile 的首次启动
    // 会被扩展/首启 UI 卡住，puppeteer 就等不到 DevTools 端点（实测报 "Timed out waiting for the WS endpoint"）。
    args: ['--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions-except=', '--mute-audio'],
  });
} catch (e) {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { }
  console.error('浏览器启动失败：' + e.message);
  process.exit(2);
}

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((key) => {
    try {
      const cur = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify(Object.assign({
        version: 6, engine: 'hover', hoverEngine: 'local', selectionMode: 'popup',
        selectionMinChars: 8, selMaxChars: 4000, selChunkChars: 600,
        lang: 'zh', target: 'zh', enabled: true, chipHidden: false, hoverDelayMs: 600,
      }, cur)));
    } catch (e) { }
  }, SETTINGS_KEY);
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // ---------- A. 面板真实布局 ----------
  try {
    await page.waitForSelector('#dsh-auto-translate-root', { timeout: 30000 });
    await sleep(1500);
    const a = await page.evaluate(() => {
      const root = document.getElementById('dsh-auto-translate-root');
      const sr = root && root.shadowRoot;
      const card = sr && sr.querySelector('.card');
      const chip = sr && sr.querySelector('.chip');
      const out = { pluginRoot: !!root, shadowRoot: !!sr, chip: !!chip, card: !!card };
      if (!card) return out;
      out.chipOpacity = chip ? getComputedStyle(chip).opacity : null;
      card.classList.add('open');
      const cs = getComputedStyle(card);
      const r = card.getBoundingClientRect();
      out.card = {
        cssWidth: cs.width, maxHeight: cs.maxHeight,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        insideViewport: r.x >= 0 && r.y >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        scrollH: card.scrollHeight, clientH: card.clientHeight,
      };
      // 关键判据：面板内容是否装得下（真机才发现得了「必须滚动」）
      out.needsScroll = card.scrollHeight > card.clientHeight + 1;
      out.groups = Array.from(card.querySelectorAll('details.grp')).map((d) => ({
        key: d.getAttribute('data-grp'), open: d.open,
        label: (d.querySelector('summary') || {}).textContent.trim(),
        rows: d.querySelectorAll('.row').length,
        arrow: getComputedStyle(d.querySelector('summary'), '::before').content,
      }));
      out.modeText = (card.querySelector('[data-el="modeText"]') || {}).textContent;
      out.status = (card.querySelector('[data-el="status"]') || {}).textContent;
      out.oldEngineSelect = card.querySelector('[data-set="engine"]') ? 'PRESENT-BUG' : null;
      const he = card.querySelector('[data-set="hoverEngine"]');
      out.hoverEngine = he ? { value: he.value, options: Array.from(he.options).map((o) => o.value) } : null;
      out.selectionMode = (card.querySelector('[data-set="selectionMode"]') || {}).value;
      out.selMaxChars = (card.querySelector('[data-set="selMaxChars"]') || {}).value;
      out.clippedText = Array.from(card.querySelectorAll('.row label, .row button, .row select, summary'))
        .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2)
        .map((el) => (el.textContent || '').trim().slice(0, 26));
      out.horizontalOverflow = card.scrollWidth > card.clientWidth + 2;
      out.childHeights = Array.from(card.children).map((el) => ({
        cls: el.className, key: el.getAttribute('data-grp') || el.getAttribute('data-el') || '',
        h: Math.round(el.getBoundingClientRect().height),
      }));
      return out;
    });
    report.phase.A_panel = a;
    if (!a.pluginRoot || !a.card) failures.push('插件未在真机加载（找不到 root/.card）');
    if (a.needsScroll) failures.push('面板内容装不下，需要滚动（' + a.card.scrollH + ' > ' + a.card.clientH + '）');
    if (a.oldEngineSelect) failures.push('面板里仍有会整页自动翻译的 engine 选择器');
    if (a.clippedText.length) failures.push('有文字被裁：' + a.clippedText.join(', '));
    if (a.horizontalOverflow) failures.push('面板横向溢出');

    // 真实鼠标移到面板自身：插件绝不能翻自己
    const chipBox = await page.evaluate(() => {
      const r = document.getElementById('dsh-auto-translate-root').getBoundingClientRect();
      return { x: r.x + 20, y: r.y + 8 };
    });
    await page.mouse.move(chipBox.x, chipBox.y, { steps: 4 });
    await sleep(900);
    a.selfTranslationMarkers = await page.evaluate(() =>
      document.getElementById('dsh-auto-translate-root').shadowRoot.querySelectorAll('[data-dsh-at]').length);
    if (a.selfTranslationMarkers) failures.push('面板把自己翻译了（' + a.selfTranslationMarkers + ' 个标记）');

    const r = a.card.rect;
    const pad = 16;
    await page.screenshot({
      path: OUT,
      clip: {
        x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad),
        width: Math.min(1400 - Math.max(0, r.x - pad), r.w + pad * 2),
        height: Math.min(900 - Math.max(0, r.y - pad), r.h + pad * 2),
      },
    });
    a.screenshot = OUT;
  } catch (e) {
    report.phase.A_panel = { error: e.message };
    failures.push('面板检查异常：' + e.message);
  }

  // ---------- B/C. 真实交互（用在线引擎，避免下载 425MB 模型） ----------
  try {
    await page.evaluate((key) => {
      const cur = JSON.parse(localStorage.getItem(key) || '{}');
      cur.hoverEngine = 'online';
      cur.hoverDelayMs = 150;
      localStorage.setItem(key, JSON.stringify(cur));
    }, SETTINGS_KEY);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#dsh-auto-translate-root', { timeout: 30000 });
    await sleep(1200);
    await page.evaluate(() => {
      const mk = (id, top, text) => {
        const p = document.createElement('p');
        p.id = id;
        p.textContent = text;
        p.style.cssText = 'position:fixed;left:28px;top:' + top + 'px;z-index:2147483001;font:15px/1.7 sans-serif;'
          + 'padding:10px 12px;margin:0;background:#fff;color:#111;border:1px solid #ccc;border-radius:6px;max-width:520px';
        document.body.appendChild(p);
      };
      mk('dsh-at-probe', 28, 'Hello world, this needs translation.');
      mk('dsh-at-probe2', 120, 'Another sentence for the selection test.');
    });
    await sleep(400);

    const b1 = await page.evaluate(() => {
      const r = document.getElementById('dsh-at-probe').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    await page.mouse.move(b1.x, b1.y, { steps: 6 });   // 先真的把鼠标移上去，再等结果
    const hover = await page
      .waitForFunction(() => {
        const el = document.getElementById('dsh-at-probe');
        return el.getAttribute('data-dsh-at') === 'translated' ? el.textContent : false;
      }, { timeout: 30000 })
      .then((h) => h.jsonValue())
      .catch((e) => null);
    report.phase.B_hover = hover;
    if (!hover) {
      failures.push('悬停翻译未生效（在线引擎；可能是网络不可达）');
      report.phase.B_diagnose = await page.evaluate(() => {
        const api = window.__dshAutoTranslate;
        if (!api) return { hasApi: false };
        let d = '';
        try { d = JSON.stringify(api.diagnose()).slice(0, 1200); } catch (err) { d = 'diagnose threw'; }
        return { hasApi: true, diagnose: d, probeText: document.getElementById('dsh-at-probe').textContent };
      });
    }

    await page.evaluate(() => {
      const p = document.getElementById('dsh-at-probe2');
      const r = document.createRange();
      r.setStart(p.firstChild, 0);
      r.setEnd(p.firstChild, 14);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
    });
    const sel = await page
      .waitForFunction(() => {
        const sr = document.getElementById('dsh-auto-translate-root').shadowRoot;
        const pop = sr.querySelector('.selpop');
        if (!pop || !pop.classList.contains('on')) return false;
        const dst = (pop.querySelector('.dst') || {}).textContent || '';
        if (!dst || /翻译中/.test(dst)) return false;
        return { src: (pop.querySelector('.src') || {}).textContent, dst: dst, info: (pop.querySelector('.info') || {}).textContent };
      }, { timeout: 30000 })
      .then((h) => h.jsonValue())
      .catch((e) => null);
    report.phase.C_selection = sel;
    if (!sel) failures.push('框选浮层未出现');
    await page.screenshot({ path: outPrefix + '-selpop.png' });
    report.phase.C_selection_screenshot = outPrefix + '-selpop.png';
  } catch (e) {
    report.phase.BC = { error: e.message };
    failures.push('交互检查异常：' + e.message);
  }
} finally {
  if (browser) { try { await browser.close(); } catch (e) { } }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
}

report.passed = failures.length === 0;
report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length ? 1 : 0);

<div align="center">

# dsh-auto-translate

**悬停一块，就地翻成中文。不自动翻页、不花 token、文本不出本机。**

[![npm version](https://img.shields.io/npm/v/dsh-auto-translate?color=4D6BFE&label=npm)](https://www.npmjs.com/package/dsh-auto-translate)
[![npm downloads](https://img.shields.io/npm/dm/dsh-auto-translate?color=4D6BFE&label=downloads)](https://www.npmjs.com/package/dsh-auto-translate)
[![license](https://img.shields.io/npm/l/dsh-auto-translate?color=4D6BFE)](LICENSE)
![platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20116%2B-4D6BFE)
[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)

<img src="demo/hover-flow.svg" width="820" alt="悬停 0.6 秒 → 该块就地替换为译文；再停一次换回原文">

<img src="demo/panel.png" width="248" alt="设置面板实拍（真机截图）">

</div>

## 30 秒看懂

- 你在读 DSH 的回复，某一块是英文 —— **鼠标停在那块上约 0.6 秒**，那一块就地变成中文；**再停一次换回原文**，可反复。
- 也可以**拖选一段文字**松手即译：默认弹浮层（原文+译文，可复制），面板里可改成**就地替换**。
- **绝不自动翻译整页**（0.4.0 起的刻意设计）：你没有主动操作时，插件完全不碰页面，不会改掉你正在读或正在输入的界面。
- **零 token**：不经过 DSH 模型、不产生 API 费用；默认走浏览器内 WASM 推理（模型下载一次，之后完全离线），译文不出本机。

## 和「自动翻整页」那类插件有什么不同

| | 本插件 | 常见的自动翻译插件 |
| --- | --- | --- |
| 触发 | **悬停 / 框选，按需** | 页面加载即自动翻 |
| 成本 | **零 token**（端侧 WASM 或免费引擎，不经模型） | 多数走模型 / 云 API，按量计费 |
| 隐私 | **默认不出本机**（只有首次下模型走镜像） | 文本发往第三方服务 |
| 副作用 | 不碰页面：跳过输入框、代码块、编辑器、自己的面板 | 常会连正在输入的内容一起翻 |

> 如果你要的是「**整页 + 思考链自动翻成 8 种语言**」，那 [dsh-think-translate](https://github.com/UncleK/dsh-think-translate) 更合适 ——
> 它是另一种取舍（覆盖面换自动触发与云端引擎）。本插件选的是**按需 + 零成本 + 不出本机**。

## 安装

```bash
# 一条命令（npm）
dsh plugin --profile web add dsh-auto-translate
# 然后重启 dsh web，再刷新浏览器页面
```

左下角出现半透明「译 xx」小圆点即成功；找不到圆点时按 `Ctrl+Alt+T` 呼出面板。

<details>
<summary>其它四种装法（GitHub / 本地目录 / tgz / Gitee 镜像）</summary>

```bash
# GitHub
dsh plugin --profile web add github:gst20060726/dsh-auto-translate

# 本地目录（开发 / 离线）
dsh plugin --profile web add link:/absolute/path/to/dsh-auto-translate

# 本地 tgz：先 npm pack 得到 dsh-auto-translate-<版本>.tgz，再把文件发给对方
dsh plugin --profile web add /对方/路径/dsh-auto-translate-0.4.2.tgz

# Gitee 镜像（国内可推）
dsh plugin --profile web add 'git+https://gitee.com/nysjn/dsh-auto-translate.git#<commit>'
```

三条发布路线都有现成脚本：`powershell -File scripts/publish.ps1 -Target tgz|zip|bundle|gitee|github|npm`
（tgz/zip/bundle 全本地、无需账号；gitee/github/npm 会交互式问凭据，脚本不保存）。

> 包内**不含**约 74MB 的 ONNX Runtime wasm：首次使用时宿主端从 CDN 取回并缓存。要**完全离线**，先 `npm run fetch-vendor` 再打包。

</details>

## 使用

| 操作 | 效果 |
| --- | --- |
| 悬停约 0.6 秒 | 该块就地换成译文；移开再悬入再停 → 换回原文（可反复切换） |
| 拖选文字后松手 | 翻译选区：默认弹**浮层**（原文 + 译文，可复制）；面板可改成**就地替换**（点击页面/按 `Esc` 还原）。**大段选区会按句子分块逐段翻译**，浮层里边翻边显示「正在翻译 i/n 段…」 |
| `Alt` + 悬停 | 立即翻译/切换，不等 0.6 秒 |
| `Ctrl+Alt+T` | 呼出/关闭设置面板（**找不到圆点时用它**） |
| `Ctrl+Alt+H` | 显示/隐藏左下角圆点 |
| `Ctrl+Alt+P` | 暂停/恢复翻译（暂停会还原原文） |

面板按「常用 / 触发与框选 / 引擎与模型 / 高级 / 诊断与重置」**分组折叠**（默认只展开「常用」，顶部可一键展开/折叠全部，还能切「窄面板」）。面板里还有：目标语言、悬停延迟、**由谁翻**（本机离线 / 在线免密钥 / 自定义端点）、框选方式、最少选取字数、**框选上限（0 = 不限）**、在线端点、拉丁源语言、**下载/预热**、**切到本机**、重试、全部原文/译文、还原原文、清缓存、使用指南、保存/复制诊断。

### 覆盖范围（能翻 / 不能翻）

| | 内容 |
| --- | --- |
| **能翻** | DSH 界面本体（外壳、侧栏、按钮、对话框、消息、工具输出）＋ 其它插件渲染出来的内容 ＋ **Web Component（shadow root）内部的文字** |
| **不翻** | 输入框、`code`/`pre`（除非打开「也翻译代码」）、`contenteditable`、CodeMirror/Monaco、本插件面板自身 |
| **翻不到** | DSH 页面**之外**的界面：别的浏览器标签页、其它网站、桌面原生 App。插件只被注入到 DSH 的 Web 界面里，拿不到别的标签页 —— 那类需求要用浏览器扩展/用户脚本 |

单次框选默认最多翻 **4000 字符**（面板可改，0 = 不限；另有 60000 字符硬兜底）；超出会明确提示「已按上限只翻前 N 字符」。

## 引擎对照

> 0.4.0 起引擎**只决定「由谁来翻」**，不决定触发方式（触发恒为按需）。

| 引擎 | 是否花 token | 是否出网 | 限制 |
| --- | --- | --- | --- |
| **本机离线（推荐，默认）** | 否 | 仅首次下模型 | 首次约 425MB（en↔zh）；磁盘与内存占用 |
| 在线免密钥 | 否 | 每次翻译发往 MyMemory | 匿名每日额度有限，可能 429 |
| 自定义端点 | 否 | 发往你自己的服务 | 需自建（如 LibreTranslate） |

## 本地模型说明

| 语向 | 模型 | 体积 | 备注 |
| --- | --- | --- | --- |
| en → zh | `Xenova/opus-mt-en-zh` | 200MB(encoder) + 225MB(decoder) | 使用 **fp32**：该仓库的量化版含 `MatMulNBits/DequantizeLinear`，在本机 ONNX Runtime 上会触发 `TransposeDQWeightsForMatMulNBits Missing required scale` 而无法建会话 |
| zh → en | `Xenova/opus-mt-zh-en` | 同上 | 同理使用 fp32 |
| ja/ko/其它 → zh | `Xenova/nllb-200-distilled-600M` | 约 600MB | 覆盖 200 语言，按需下载，较慢 |

- 模型经插件自带的**同源代理路由**下载（`/dsh-auto-translate/model-v2/...`），宿主端带**断点续传 + 12 次重试**并落盘缓存，避免浏览器直连镜像时的跨域与中断问题。
- 缓存在浏览器 Cache Storage；宿主缓存位于 `$DSH_HOME/dsh-auto-translate/models`。
- 想省流量可先只装 en↔zh；其它语向在首次遇到时再下载。
- **仓库体积**：默认不含 ONNX Runtime 的 wasm（约 74MB）。首次使用时宿主端会从 CDN 取回并缓存到 `$DSH_HOME/dsh-auto-translate/ort-cache`；要**完全离线**运行，先执行 `npm run fetch-vendor` 把它们落到本地 `vendor/ort/`。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 圆点找不到 | `Ctrl+Alt+T` 呼出面板（会自动显示圆点并修正跑到屏外的位置） |
| 翻译不生效 | 看面板状态行的计数：扫描 / 入队 / 已译 / 跳过语言 / 失败。若「已译」一直为 0，看错误框 |
| 本机模型加载失败 | 点「保存诊断到本机」，把 `~/.dsh/dsh-auto-translate/diagnose-*.json` 交给维护者 |
| 进度条卡住 | 点「重试」；宿主缓存已断点续传，通常第二次即通 |
| 想彻底重置 | 面板「清缓存」+ 浏览器站点数据清理（模型在 Cache Storage） |

## 架构

```
dsh-auto-translate/
|- index.js              # 宿主半：静态资源路由 + 模型同源代理 + 诊断落盘
|- client.js             # 浏览器半：扫描/翻译/悬停切换/设置面板
|- vendor/
|   |- worker.v5.js      # Web Worker：SharedWorker 单实例推理、按语向懒加载
|   |- transformers.esm.v2.js  # transformers.js 浏览器 ESM（ORT 引用已指向本地）
|   |- ort/              # ONNX Runtime 的 wasm 与加载器
|- scripts/fetch-vendor.mjs     # 重新生成 vendor/（仓库可不带大文件）
|- scripts/verify-browser.mjs   # 真浏览器验收（可选，见下）
|- demo/                 # README 用的图：hover-flow.svg 自制示意；panel.png 真机截图裁剪
|- package.json / cordis.patch.yml
```

- 宿主半只做三件事：`/dsh-auto-translate/vendor/*`（静态）、`/model-v2/*`（模型代理+缓存）、`/diag`（诊断落盘）。
- 浏览器半不注册工具、不调用模型；推理全在 Worker 中，主线程只做文本替换。

### 改代码后怎么验

```bash
npm test                  # 47 项：契约 + i18n + jsdom E2E（不需要浏览器）
npm run verify:browser    # 真浏览器：面板真实布局/是否滚动/是否裁字 + 真实鼠标悬停与框选
```

`verify:browser` 用你本机的 Edge/Chrome 起**独立临时 profile**（不碰你在用的浏览器数据），需要 `puppeteer-core`
（DSH 配置目录里通常已有；没有就 `npm i --no-save puppeteer-core`）。它专治 jsdom 测不出的问题：
**没有布局引擎就发现不了「面板装不下要滚动」「文字被裁」**。输出截图 `panel-preview.png` 与 JSON 报告，
任一项不通过就以非 0 退出。

> `README` 里的 `demo/panel.png` 就是这个脚本的产物，再裁掉四周 16px 的页面边带（只留插件面板本身，
> 不带你自己的会话内容）。**整页截图只留本机 `demo/raw/`（已 gitignore）**：那里面有真实会话。

## 兼容性

- DeepSeek Harness `0.1.5-rc.1` 及以上（profile `web`）。
- Chrome / Edge 116+（module worker + WASM）；端侧引擎需 Chrome/Edge 138+。

## License

MIT

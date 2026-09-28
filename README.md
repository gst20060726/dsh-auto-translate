# dsh-auto-translate

> 给 DeepSeek Harness Web GUI 的**零 token 按需翻译**插件：**不会自动翻译整页**，
> 鼠标悬停某一块约 0.6 秒才翻译那一块（再停一次换回原文），或拖选一段文字松手即译。

![version](https://img.shields.io/badge/version-0.4.2-blue)
![license](https://img.shields.io/badge/license-MIT-green)

---

## 为什么是「零 token」

- **不调用任何大模型**：不经过 DSH 模型、不产生 API 费用（这一点和「让模型翻译」完全不同）。
- 默认走**浏览器内 WASM 推理**（transformers.js + ONNX Runtime），模型只下载一次，之后完全离线。
- 译文按「原文+源语言+目标语言」缓存，同一句永不重复翻译。
- 待翻译文本**不出本机**（只有下载模型时会从镜像取权重文件）。

## 特性

| 能力 | 说明 |
| --- | --- |
| 按需触发 | **绝不自动翻页**：只有你悬停或框选时才翻译，其余时间完全不碰页面 |
| 悬停翻译 | 悬停某一块约 0.6 秒 → 就地换成译文；再停一次 → 换回原文（可反复） |
| 框选翻译 | 拖选文字松手即译：默认弹**浮层**（可复制），也可在面板改成**就地替换**（点击还原） |
| 多种引擎 | 本机离线(WASM) / 在线免密钥 / 自定义端点，面板内一键切换（只决定「由谁翻」） |
| 可调热键 | 默认 `Ctrl+Alt+T` 呼出、`Ctrl+Alt+H` 显隐圆点、`Ctrl+Alt+P` 暂停，均可改键 |
| 不添乱 | 跳过代码块、输入框、CodeMirror/Monaco 与面板自身；面板按分组折叠、可切「窄面板」 |
| 可诊断 | 面板内「保存诊断到本机」把完整状态写成 JSON，排障不用复制长文本 |

## 安装

    # 方式 A：npm（上架后可用）
    dsh plugin --profile web add dsh-auto-translate

    # 方式 B：本地目录（开发/离线）
    dsh plugin --profile web add link:/absolute/path/to/dsh-auto-translate

    # 方式 C：直接从 GitHub
    dsh plugin --profile web add github:gst20060726/dsh-auto-translate

安装后**重启 dsh web**，再刷新浏览器。左下角出现半透明「译 xx」小圆点即成功。

### 没有 GitHub 也能分发（三种都验证过）

| 方式 | 你要做的 | 别人怎么装 |
| --- | --- | --- |
| **本地 tgz（最省事）** | [[npm pack]] 得到 [[dsh-auto-translate-0.2.0.tgz]]（约 236KB），把文件发给对方 | [[dsh plugin --profile web add /对方/路径/dsh-auto-translate-0.2.0.tgz]] |
| **Gitee 镜像（国内可推，已上线）** | [[git remote add gitee https://gitee.com/nysjn/dsh-auto-translate.git]] → [[git push -u gitee main]] | [[dsh plugin --profile web add 'git+https://gitee.com/nysjn/dsh-auto-translate.git#<commit>']] |
| **npm（不需要 GitHub）** | [[npm login]] → [[npm publish --access public]] | [[dsh plugin --profile web add dsh-auto-translate]] |

> 三条路都有现成脚本:**[[powershell -File scripts/publish.ps1 -Target tgz|zip|bundle|gitee|github|npm]]**
> （tgz/zip/bundle 全本地无需账号;gitee/github/npm 会交互式问你要凭据,脚本不保存）
> 插件市场的**自动收录**需要 GitHub 仓库带 [[dsh-plugin]] 话题；打不开 GitHub 时用上面三种分发即可，功能完全一样。
> 包内**不含** 74MB 的 ONNX Runtime wasm（首次使用时宿主端从 CDN 取回并缓存）；要完全离线，先 [[npm run fetch-vendor]] 再打包。

## 使用

| 操作 | 效果 |
| --- | --- |
| 悬停约 0.6 秒 | 该块就地换成译文；移开再悬入再停 → 换回原文（可反复切换） |
| 拖选文字后松手 | 翻译选区：默认弹**浮层**（原文 + 译文，可复制）；面板可改成**就地替换**（点击页面/按 Esc 还原）。**大段选区会按句子分块逐段翻译**，浮层里边翻边显示「正在翻译 i/n 段…」 |
| `Alt` + 悬停 | 立即翻译/切换，不等 0.6 秒 |
| `Ctrl+Alt+T` | 呼出/关闭设置面板（**找不到圆点时用它**） |
| `Ctrl+Alt+H` | 显示/隐藏左下角圆点 |
| `Ctrl+Alt+P` | 暂停/恢复翻译（暂停会还原原文） |

> **不会自动翻译整页** —— 这是 0.4.0 起的刻意设计：只有上面这些主动操作才会触发翻译，
> 其余时间插件完全不碰页面，因此不会把你正在读/正在输入的界面改掉。

面板按「常用 / 触发与框选 / 引擎与模型 / 高级 / 诊断与重置」**分组折叠**（默认只展开「常用」，顶部可一键展开/折叠全部，
还能切「窄面板」）。面板里还有：目标语言、悬停延迟、**由谁翻**（本机离线 / 在线免密钥 / 自定义端点）、
框选方式、最少选取字数、**框选上限（0 = 不限）**、在线端点、拉丁源语言、**下载/预热**、**切到本机**、
重试、全部原文/译文、还原原文、清缓存、使用指南、保存/复制诊断。

### 覆盖范围（能翻 / 不能翻）

| | 内容 |
| --- | --- |
| **能翻** | DSH 界面本体（外壳、侧栏、按钮、对话框、消息、工具输出）＋ 其它插件渲染出来的内容 ＋ **Web Component（shadow root）内部的文字** |
| **不翻** | 输入框、`code`/`pre`（除非打开「也翻译代码」）、`contenteditable`、CodeMirror/Monaco、本插件面板自身 |
| **翻不到** | DSH 页面**之外**的界面：别的浏览器标签页、其它网站、桌面原生 App。插件只被注入到 DSH 的 Web 界面里，拿不到别的标签页——那类需求要用浏览器扩展/用户脚本 |

单次框选默认最多翻 **4000 字符**（面板可改，0 = 不限；另有 60000 字符硬兜底）；超出会明确提示「已按上限只翻前 N 字符」。

## 引擎对照

> 0.4.0 起引擎**只决定「由谁来翻」**，不决定触发方式（触发恒为按需）。面板里的三选一：

| 引擎 | 是否花 token | 是否出网 | 限制 |
| --- | --- | --- | --- |
| **本机离线（推荐，默认）** | 否 | 仅首次下模型 | 首次约 425MB（en↔zh）；磁盘与内存占用 |
| 在线免密钥 | 否 | 每次翻译发往 MyMemory | 匿名每日额度有限，可能 429 |
| 自定义端点 | 否 | 发往你自己的服务 | 需自建（如 LibreTranslate） |

## 本地模型说明

| 语向 | 模型 | 体积 | 备注 |
| --- | --- | --- | --- |
| en -> zh | Xenova/opus-mt-en-zh | 200MB(encoder) + 225MB(decoder) | 使用 **fp32**：该仓库的量化版含 `MatMulNBits/DequantizeLinear`，在本机 ONNX Runtime 上会触发 `TransposeDQWeightsForMatMulNBits Missing required scale` 而无法建会话 |
| zh -> en | Xenova/opus-mt-zh-en | 同上 | 同理使用 fp32 |
| ja/ko/其它 -> zh | Xenova/nllb-200-distilled-600M | 约 600MB | 覆盖 200 语言，按需下载，较慢 |

- 模型经插件自带的**同源代理路由**下载（`/dsh-auto-translate/model-v2/...`），宿主端带**断点续传 + 12 次重试**并落盘缓存，避免浏览器直连镜像时的跨域与中断问题。
- 缓存在浏览器 Cache Storage；宿主缓存位于 `$DSH_HOME/dsh-auto-translate/models`。
- 想省流量可先只装 en↔zh；其它语向在首次遇到时再下载。
- **仓库体积**：默认不含 ONNX Runtime 的 wasm（约 74MB）。首次使用时宿主端会从 CDN 取回并缓存到 [[$DSH_HOME/dsh-auto-translate/ort-cache]]；要**完全离线**运行，先执行 [[npm run fetch-vendor]] 把它们落到本地 [[vendor/ort/]]。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 圆点找不到 | `Ctrl+Alt+T` 呼出面板（会自动显示圆点并修正跑到屏外的位置） |
| 翻译不生效 | 看面板状态行的计数：扫描 / 入队 / 已译 / 跳过语言 / 失败。若「已译」一直为 0，看错误框 |
| 本机模型加载失败 | 点「保存诊断到本机」，把 `~/.dsh/dsh-auto-translate/diagnose-*.json` 交给维护者 |
| 进度条卡住 | 点「重试」；宿主缓存已断点续传，通常第二次即通 |
| 想彻底重置 | 面板「清缓存」+ 浏览器站点数据清理（模型在 Cache Storage） |

## 架构

    dsh-auto-translate/
    |- index.js              # 宿主半：静态资源路由 + 模型同源代理 + 诊断落盘
    |- client.js             # 浏览器半：扫描/翻译/悬停切换/设置面板
    |- vendor/
    |   |- worker.v5.js      # Web Worker：SharedWorker 单实例推理、按语向懒加载
    |   |- transformers.esm.v2.js  # transformers.js 浏览器 ESM（ORT 引用已指向本地）
    |   |- ort/              # ONNX Runtime 的 wasm 与加载器
    |- scripts/fetch-vendor.mjs    # 重新生成 vendor/（仓库可不带大文件）
    |- scripts/verify-browser.mjs  # 真浏览器验收（可选，见下）
    |- package.json / cordis.patch.yml

- 宿主半只做三件事：`/dsh-auto-translate/vendor/*`（静态）、`/model-v2/*`（模型代理+缓存）、`/diag`（诊断落盘）。
- 浏览器半不注册工具、不调用模型；推理全在 Worker 中，主线程只做文本替换。

### 改代码后怎么验

    npm test                  # 46 项：契约 + i18n + jsdom E2E（不需要浏览器）
    npm run verify:browser    # 真浏览器：面板真实布局/是否滚动/是否裁字 + 真实鼠标悬停与框选

`verify:browser` 用你本机的 Edge/Chrome 起**独立临时 profile**（不碰你在用的浏览器数据），需要 `puppeteer-core`
（DSH 配置目录里通常已有）。它专治 jsdom 测不出的问题：**没有布局引擎就发现不了「面板装不下要滚动」「文字被裁」**。
输出截图 `panel-preview.png` 与 JSON 报告，任一项不通过就以非 0 退出。

## 兼容性

- DeepSeek Harness `0.1.5-rc.1` 及以上（profile `web`）。
- Chrome / Edge 116+（module worker + WASM）；端侧引擎需 Chrome/Edge 138+。

## License

MIT

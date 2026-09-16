# dsh-auto-translate

> 给 DeepSeek Harness Web GUI 的**零 token 自动翻译**插件：页面上的外语文本就地变成你的语言，鼠标悬停 0.6 秒即可来回切换原文/译文。

![version](https://img.shields.io/badge/version-0.2.0-blue)
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
| 就地翻译 | 正文、工具调用输出、系统提示、模型回复、插件自绘面板（含 open shadow root） |
| 悬停切换 | 悬停译文约 0.6 秒在原文/译文间来回切换；`Alt+悬停` 立即切换 |
| 多种引擎 | 本机离线(WASM) / 在线免密钥 / 浏览器端侧 / 自定义端点，可一键切换 |
| 可调热键 | 默认 `Ctrl+Alt+T` 呼出、`Ctrl+Alt+H` 显隐圆点、`Ctrl+Alt+P` 暂停，均可改键 |
| 不添乱 | 跳过代码块、输入框、CodeMirror/Monaco；卡片贴边自动翻转；圆点可拖拽记忆位置 |
| 可诊断 | 面板内「保存诊断到本机」把完整状态写成 JSON，排障不用复制长文本 |

## 安装

    # 方式 A：npm（上架后可用）
    dsh plugin --profile web add dsh-auto-translate

    # 方式 B：本地目录（开发/离线）
    dsh plugin --profile web add link:/absolute/path/to/dsh-auto-translate

    # 方式 C：直接从 GitHub
    dsh plugin --profile web add github:<your-name>/dsh-auto-translate

安装后**重启 dsh web**，再刷新浏览器。左下角出现半透明「译 xx」小圆点即成功。

### 没有 GitHub 也能分发（三种都验证过）

| 方式 | 你要做的 | 别人怎么装 |
| --- | --- | --- |
| **本地 tgz（最省事）** | [[npm pack]] 得到 [[dsh-auto-translate-0.2.0.tgz]]（约 236KB），把文件发给对方 | [[dsh plugin --profile web add /对方/路径/dsh-auto-translate-0.2.0.tgz]] |
| **Gitee 镜像（国内可推）** | 在 gitee 建仓库 → [[git remote add gitee https://gitee.com/<你>/dsh-auto-translate.git]] → [[git push -u gitee main]] | [[dsh plugin --profile web add 'git+https://gitee.com/<你>/dsh-auto-translate.git#<commit>']] |
| **npm（不需要 GitHub）** | [[npm login]] → [[npm publish --access public]] | [[dsh plugin --profile web add dsh-auto-translate]] |

> 三条路都有现成脚本:**[[powershell -File scripts/publish.ps1 -Target tgz|zip|bundle|gitee|github|npm]]**
> （tgz/zip/bundle 全本地无需账号;gitee/github/npm 会交互式问你要凭据,脚本不保存）
> 插件市场的**自动收录**需要 GitHub 仓库带 [[dsh-plugin]] 话题；打不开 GitHub 时用上面三种分发即可，功能完全一样。
> 包内**不含** 74MB 的 ONNX Runtime wasm（首次使用时宿主端从 CDN 取回并缓存）；要完全离线，先 [[npm run fetch-vendor]] 再打包。

### 没有 GitHub 也能分发（三种都验证过）

| 方式 | 你要做的 | 别人怎么装 |
| --- | --- | --- |
| **本地 tgz（最省事）** | [[npm pack]] 得到 [[dsh-auto-translate-0.2.0.tgz]]（约 236KB），把文件发出去 | [[dsh plugin --profile web add /对方/的路径/dsh-auto-translate-0.2.0.tgz]] |
| **Gitee 镜像（国内可推）** | 在 gitee 建仓库 → [[git remote add gitee https://gitee.com/<你>/dsh-auto-translate.git]] → [[git push -u gitee main]] | [[dsh plugin --profile web add 'git+https://gitee.com/<你>/dsh-auto-translate.git#<commit>']] |
| **npm（不需要 GitHub）** | [[npm login]] → [[npm publish --access public]] | [[dsh plugin --profile web add dsh-auto-translate]] |

> 插件市场的**自动收录**需要 GitHub 仓库带 [[dsh-plugin]] 话题；若打不开 GitHub，用上面三种方式分发即可，功能完全一样。
> 包内不含 74MB 的 ONNX Runtime wasm（首次使用时由宿主端从 CDN 取回并缓存）；要完全离线安装，先 [[npm run fetch-vendor]] 再打包。

## 使用

| 操作 | 效果 |
| --- | --- |
| 自动 | 页面上的外语文本自动就地变译文 |
| 悬停译文约 0.6 秒 | 该块切换回原文；移开再悬入再切回译文（可反复） |
| `Alt` + 悬停 | 立即切换，不等 0.6 秒 |
| `Ctrl+Alt+T` | 呼出/关闭设置面板（**找不到圆点时用它**） |
| `Ctrl+Alt+H` | 显示/隐藏左下角圆点 |
| `Ctrl+Alt+P` | 暂停/恢复翻译（暂停会还原原文） |

面板里还有：目标语言、悬停延迟、引擎选择、在线端点、拉丁源语言、**下载/预热**、**切到本机**、重试、全部原文/译文、还原原文、清缓存、使用指南、保存/复制诊断。

## 引擎对照

| 引擎 | 是否花 token | 是否出网 | 限制 |
| --- | --- | --- | --- |
| **本机离线（推荐）** | 否 | 仅首次下模型 | 首次约 425MB（en↔zh）；磁盘与内存占用 |
| 在线免密钥 | 否 | 每次翻译发往 MyMemory | 匿名每日额度有限，可能 429 |
| 浏览器端侧 | 否 | 需连 Google 组件服务器下载语言包 | 国内网络通常不可用 |
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
    |   |- worker.v4.js      # Web Worker：WASM 推理、按语向懒加载、精度回退
    |   |- transformers.esm.v2.js  # transformers.js 浏览器 ESM（ORT 引用已指向本地）
    |   |- ort/              # ONNX Runtime 的 wasm 与加载器
    |- scripts/fetch-vendor.mjs    # 重新生成 vendor/（仓库可不带大文件）
    |- package.json / cordis.patch.yml

- 宿主半只做三件事：`/dsh-auto-translate/vendor/*`（静态）、`/model-v2/*`（模型代理+缓存）、`/diag`（诊断落盘）。
- 浏览器半不注册工具、不调用模型；推理全在 Worker 中，主线程只做文本替换。

## 兼容性

- DeepSeek Harness `0.1.5-rc.1` 及以上（profile `web`）。
- Chrome / Edge 116+（module worker + WASM）；端侧引擎需 Chrome/Edge 138+。

## License

MIT

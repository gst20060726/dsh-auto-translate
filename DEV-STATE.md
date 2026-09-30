# 开发状态（续接笔记）

> dsh web 重启或上下文压缩之后，先读这个文件即可继续工作。

## 上下文自动压缩（2026-09-17 调整）

**这是 dsh 内置能力，不是插件**：`@deepseek-ai/dsh-base` 的 84 个依赖里已含
`dsh-compaction-basic`（token-meter 驱动的策略 + LLM 摘要后端）、`dsh-compaction-tool-result-pruner`
（无需模型的 head/middle/tail 修剪）、`dsh-spill-policy`/`dsh-spill-local`（超大输出移出上下文落盘）、
`dsh-output-retention`、`dsh-token-meter`、`dsh-command-compact`（即 `/compact` 手动触发）。

- **触发阈值**：`DEFAULT_THRESHOLD_RATIO = .8` → 上下文用到 **80%** 自动压缩；
  **压缩后只保留最近 16% 原文**（`DEFAULT_RETAIN_RATIO = .16`），其余由模型总结成结构化 checkpoint。
- 摘要提示词要求：preserve still-true facts、drop stale ones、保住文件路径/命令/错误串/标识符。
- **原始日志无损落盘**：`~/.dsh/sessions/<工作区>/<sessionId>/session.v3.jsonl.zstd`（压缩后仍在）。
- 可配置字段（`dsh-compaction-basic` 的 Config）：`thresholdRatio`、`retainRatio`、`retainTokens`、
  `summarizationProvider`、`summarizationModel`、`maxTokens`、`compactionRetries`、`maxOverflowRetries`、
  `modelPolicies`、`auto`（**缺省即 true**，不写不会关掉自动压缩）。
- **本机已调整为 0.7**（更早触发，留更多余量）：写在 `~/.dsh/profiles/web/cordis.patch.yml`。

### corpus patch 语义（踩过的坑，务必记住）

`dsh-app-boot/lib/index.js` 的 `applyPatches` 规则：

    const { id, insert, name, ...overrides } = patch;
    if (insert) { ...新增一行... }                  // 对已存在的 id 用 insert → "duplicate loader entry id" → 启动失败
    const target = entryMap.get(id);                 // 不带 insert = 按 id 定位既有行
    if (name && name !== target.name) { 跳过并警告 }  // name 只用于校验
    for (const [k, v] of Object.entries(overrides)) target[k] = v   // 顶层 key 直接覆盖

- **覆盖既有行：不要写 `insert:`**，直接 `- id: <行id>` + `name:`（校验）+ 顶层 `config:`。
- **`config` 是整体替换，不是深合并** → 覆盖前先确认原行有没有 config；有就得把完整配置抄一遍。
- 行 id 取自 `dsh-base` 的 patch（例如 `compaction-basic`、`spill-policy`、`tool-result-pruner`）。
- **验证方法（务必照做）**：改完 patch 先用**临时端口起一次**再重启生产——
  `node <rc2>/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 0 --no-open`
  写错会立刻以 `duplicate loader entry id` 或 `entry not found` 拒启；**直接重启生产会让服务起不来**。

## 当前版本

- 版本 **0.4.2**（仓库 HEAD 见 `git log --oneline -1`）｜ 前几版 0.4.1（大量框选+shadow 穿透）/ 0.4.0（按需翻译）/ 0.3.0（指标入口 `metrics.mjs`）
- npm 上的 latest 是 **0.4.2**（**2026-09-20 已发布**）｜ shasum `8e41e2f51b64979b147ada0b0c5e061a624c5cb5`｜ 23 个文件 / 304KB
  - 实测**发布后 65 秒** registry 同步完成（`dist-tags.latest=0.4.2`）；已核对**已发布 tarball 里的 `client.js` 与本地源码 SHA256 完全一致**
  - ⚠️ 这次把 latest 从 0.2.2 **一次跳到 0.4.2** → 对已装用户是**行为变更**（不再自动翻页，改悬停/框选触发）；0.3.0 / 0.4.0 / 0.4.1 只存在于仓库历史，未单独发布
- 已安装为 profile link：`dsh plugin --profile web add link:C:/Users/20549/.dsh/plugins/dsh-auto-translate`
- 已上线镜像：**https://gitee.com/nysjn/dsh-auto-translate.git**（远端名 `gitee`，`main` 跟踪 `gitee/main`）
- 已发布 npm：**dsh-auto-translate@0.4.2**（latest）｜ 0.2.0 / 0.2.1 / 0.2.2 也在线上
  - 别人安装：`dsh plugin --profile web add dsh-auto-translate`（拿到 latest = 0.4.2，含按需翻译 + 框选翻译）
  - ✅ **更正**：0.2.1 当时并非「发布失败」——`npm publish` 打印成功行后，registry 的 packument 与 tarball
    **同步有延迟（实测约 3~5 分钟）**，我当时立刻查询才看到 404。现在 0.2.1 的 tarball 已可正常下载。
    教训：**判定发布成功要轮询几分钟**，别用发布后立刻的第一次查询下结论；也不要只看 publish 的输出。
    排查办法：`npm view <pkg> --json` 看 `time` 与 `versions`，再 HEAD 一下
    `https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz`。
  - 每次发布的令牌流程见下面「发布到 npm」一节（临时 bypass 令牌 → 发 → 立即删除 → 回 npm 吊销）
- 生效方式：改完 `index.js` 或 `client.js` 必须**重启 dsh web**；`vendor/` 下的文件是运行时按需加载，改动无需重启
  - 判断是否已重启：`(Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess` 取 PID，比该进程 `StartTime` 与 `client.js` 的 `LastWriteTime`

## 0.4.0：按需翻译（2026-09-20）— 破坏性变更，务必知道

用户要求：**取消自动全页翻译**，只在「鼠标悬停」或「框选多段」时翻译；同时优化面板视觉与体验，
且**不污染正常使用体验**。落地方式：

- `settings.engine` 恒为 `'hover'`，只表示「触发方式 = 按需」；面板里**不再有** engine 下拉
  （`data-set="engine"` 已删除，有契约测试守着）。
- **「由谁翻」搬到新字段 `settings.hoverEngine`**：`local`（默认）/ `online` / `custom`，
  由面板「常用」组里的下拉决定；`translateText()` 尾部的按需分支按它选后端。
  ⚠️ 改这个分支时注意：旧实现是「固定落回 local」，会让「切到在线引擎」在按需模式下失效。
- **v5 迁移**：`local`/`auto` → `hoverEngine=local`；`online` → `online`；`custom`/`http` → `custom`；
  `engine='off'` → `enabled=false`（**旧的「关闭」绝不能被悄悄打开**）。
- **框选翻译**（新）：`selectionMode` = `popup`（默认，浮层）/ `inline`（就地替换，点击页面或 Esc 还原）/ `off`；
  `selectionMinChars`（默认 8）、`selMaxChars`（默认 1200）。
  - 触发路径只有 `mouseup`（capture）→ `selectionItem()`；**刻意不用 `selectionchange`**，避免任何自动行为。
  - 跳过规则复用 `isSkipped()` + `SKIP_TAGS`：输入框、代码块（除开启 `translateCode`）、
    contenteditable、CodeMirror/Monaco、插件面板自身一律不翻。
  - `inline` 只处理「同一文本节点内」的选区（`range.deleteContents()+insertNode`），跨段落自动退回浮层；
    替换出的 `<span data-dsh-at-sel data-dsh-at-skip>` 会进 `inlineSpans`，随 `revertTranslatedNodes()` 一起回滚。
- **面板重排**：四个 `<details class="grp">`（常用 open / 引擎与模型 / 高级 / 诊断与重置）+ 顶部
  「展开全部 / 折叠全部 / 窄面板」；用原生 `<details>` 因此**不需要任何 JS 状态**。
- **头部模式条** `[data-el="modeText"]`：显示「按需 · 后端 · 框选方式 · 暂停/有错」；状态行改为分段
  `' · '` 拼接（只显示非零段），不再是一整行 ` | `。
- 测试：`node --test "test/*.test.mjs"` → 38 项；旧 E2E（自动翻译/流式稳定期）已按新语义重写，
  新增框选/迁移/面板结构/文案契约测试。⚠️ **`node --test test/` 会报 MODULE_NOT_FOUND，必须用 glob**。

## 找 GUI token：先看 `launcher.log`，不是 `dsh-web-server.log`（2026-09-29）

**症状**：`http://127.0.0.1:3080/?token=<从 dsh-web-server.log 读到的>` → **401**，于是浏览器打不开 GUI。
而且 `dsh-web-server.log` 的 mtime 停在 09-28（旧实例写的），当前实例（`...bin.js web --no-open --port 3080`，
手动/launcher 启动、**命令行里没有 stdout 重定向**）的 token 根本没进那个文件。

**根因与对策**（已实测）：
- token 跟着**谁启动的**走：走 `restart-dsh-web.ps1` 才会重定向到 `dsh-web-server.log`；
  走 **launcher** 则写入 **`~/.dsh/launcher/launcher.log`**。
- 拿 token 的稳妥顺序：① `~/.dsh/launcher/launcher.log` → ② `~/.dsh/dsh-web-server.log`（取**最后**一枚）
  → ③ 兜底：扫最近 4 小时内改动、<1MB 的文件里的 43 字符 `[A-Za-z0-9_-]` 串，**逐个用 HTTP 200 校验**。
- **`dsh-pocket` 的 3081 不是主界面**：`http://127.0.0.1:3081/` 返回 `DSH Pocket · 访问验证`（表单 action=`/pocket-login`），
  它的 8 字符 token 在 `~/.dsh/dsh-pocket/token`（LAN 版 `token-lan`）；用它打 3080 是 **401**。
- 一句话：**开浏览器 GUI 前先校验 token（HTTP 200 且 body > 5KB），别拿日志里的字符串直接拼 URL。**

## GitHub 仓库上线 + 进市场的路（2026-09-28，全是实测踩坑）

**目标**：让插件被 DSH 插件市场收录。市场**自动收录只认 GitHub 仓库 + `dsh-plugin` 话题**，
Gitee-only 永远进不去（市场里那个同名 `dsh-auto-translate` 是 **qwert702** 的另一个实现，不是本插件）。

- **仓库**：https://github.com/gst20060726/dsh-auto-translate （public，账号 `gst20060726`）
  - 本地已加远端 `github`；**推送走 SSH over 443**，不是 HTTPS。三端已同步（local = gitee = github = `642c92e`）。
  - `~/.ssh/config`（纯 ASCII，别写中文注释，否则又踩编码坑）：
    ```
    Host github.com
        HostName ssh.github.com
        Port 443
        User git
        IdentityFile ~/.ssh/id_ed25519_dsh
        IdentitiesOnly yes
    ```
  - 密钥：`~/.ssh/id_ed25519_dsh`（专用、无密码短语）；公钥已加到账号（Settings → SSH keys → `dsh-push`）。
  - 本机 `ssh.github.com:443` **通**（解析到 20.205.243.160）；`github.com:22` 也通。
  - 以后推送只需：`git push github main`（无需代理、无需 GCM）。
- **⚠️ 坑 1：HTTPS 推送在本机这条线上必失败**。系统 DNS 把 `github.com` 只解析到 **20.205.243.166**，而它不可用；
  其它 GitHub IP 正常。浏览器能开是因为它走 Secure DNS。救急：`C:\Users\20549\.dsh\gh-ip-proxy.mjs`
  （本地 CONNECT 代理，多 IP 故障转移，只监听 127.0.0.1:8899）。
  **坑中坑**：`20.233.83.145` 能开网页但 **git 后端不响应**（`…git/info/refs` 20 秒 0 字节）→ 候选顺序要把它排最后；
  实测可用且快的是 `20.27.177.113` / `20.200.245.247` / `140.82.114.3` / `4.208.26.197`。
  **长期解法：挂代理/VPN。**
- **⚠️ 坑 2：GitHub 秘密扫描会拦推送**。`vendor/transformers.esm.v2.js` 第 40 行的 jsdelivr sourcemap 注释
  （`//# sourceMappingURL=/sm/<64 位十六进制>.map`）被判成 **“Mistral AI API Key”** →
  `push declined due to repository rule violations`。处理：打开推送输出里的
  `…/security/secret-scanning/unblock-secret/<id>` → 选 **It's a false positive** → 点
  **Allow me to expose this secret** → 重推即过。
- **⚠️ 坑 3：GCM 在非交互 shell 里走不完**。device flow 弹 GUI 窗口；把码填进去后，最后的 **Authorize 按钮常
  呈 disabled**（需账号本人确认），随后报 `User canceled device code authentication`；而且 GCM 自己也访问
  github.com，同样需要代理（`credential.httpProxy` + `HTTPS_PROXY`）。
  **结论：本机推送用 SSH，不要用 HTTPS + GCM。**
- **⚠️ 坑 4（我犯的，必须记住）**：以为 `/settings/tokens` 只显示元数据，结果 GitHub 把**刚生成的经典令牌展示在
  列表页顶部** → 页面快照把令牌值读进了模型上下文。补救：立刻用它把活干完 → 在列表页 `Delete` →
  再用该令牌调 API 验证 **401 Bad credentials** 确认已失效。
  **以后绝不在令牌刚生成后打开列表页；要验证凭据就查凭据库或直接试推。**
- **话题与主页用 API 设的**（那个自绘对话框的 `Add topics` 输入框不吃回车，会把两段拼成 `dsh-plugindsh`，别跟它较劲）：
  ```
  PUT /repos/{owner}/{repo}/topics  {"names":["dsh-plugin","dsh","deepseek-harness","translation",
      "translate","zero-token","on-device","wasm","transformers-js","privacy","web-ui"]}
  PATCH /repos/{owner}/{repo}       {"homepage":"https://www.npmjs.com/package/dsh-auto-translate"}
  ```
  经典令牌要有 `repo` 作用域（含 public_repo）才够改公开仓库的 topics。
- **收录时机**：参考 qwert702 那条 —— 建仓 `08-19T17:41Z` → 首次入库 `08-20T03:58Z`，**约 10 小时**。
  用 `marketplace_search` 随时复查。
- **市场条目的描述取自仓库 About 的 Description**，所以那句 233 字双语描述就是市场里的第一印象。

## 0.4.2：真机验收打通 + 面板按实测削到不滚动（2026-09-20）

**里程碑：浏览器桥终于通了**，从此能真机验收（之前全是 jsdom + 包体比对）。

- 扩展已加载：Edge `Secure Preferences` 里 `ijgnghnilgecnfmdajmnaejfgdkkidbo`，`location=4`（解压缩），
  `path=C:\Users\20549\.dsh\browser-extension`。**避坑**：装完扩展必须①刷新 DSH 页面（内容脚本否则不注入）
  ②打开扩展侧边栏（连接/审批 UI 在侧边栏），否则 `browser_*` 一直报 `no browser extension is connected` /
  审批超时。桥地址：`ws://127.0.0.1:3080/ext/bridge`（`/ext/bridge-config` 可自证）。
- **桥的工具是纯文本的（没有截图能力）**，所以真像素/真布局要靠 `scripts/verify-browser.mjs`
  （`npm run verify:browser`）：`puppeteer-core`（在 `~/.dsh/profiles/web/node_modules` 里）+ 本机 Edge
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，**独立临时 profile**，不碰用户的浏览器数据。
  - ⚠️ 启动参数必须带 `--disable-extensions-except=`：Edge 已装解压扩展时，全新 profile 的首次启动会被
    扩展/首启 UI 卡住，puppeteer 报 `Timed out … waiting for the WS endpoint URL to appear in stdout`。
  - ⚠️ `puppeteer.launch` 必须写在 `try` 内：否则启动失败时 `finally` 不执行 → 残留临时 profile 且吞掉原因。
  - 它能测 jsdom 测不出的东西：面板是否需要滚动、文字是否被裁、伪元素箭头是否渲染、真实鼠标事件。
- **实测数据（面板）**：改前 `内容 766px / 可视 624px`（一打开就要滚动）→ 改后 **596/596（不滚动）**。
  削法：「常用」8 行→4 行（enabled/hoverEngine/target/selectionMode）；新增分组「触发与框选」
  （hoverDelayMs/selectionMinChars/selMaxChars，默认折叠）；`lang` 挪到「高级」；模式条改短词
  （`按需 · 本机 · 框选翻译:浮层`，47px 折行 → 29px 单行）；底部提示 83px→33px；头部 52px→46px。
- **真机行为已验证**：真实鼠标悬停 → `Hello world, this needs translation.` → `大家好，这需要翻译。`；
  真实 `mouseup` + 选区 → 浮层 src/dst 正确；鼠标移到面板上 → 面板内 `[data-dsh-at]` 标记数为 0（不翻自己）。

## 0.4.1：大量框选 + shadow DOM 穿透（2026-09-20）

用户问的两个能力，落地情况与结论：

1. **框选大量翻译（已支持）**：`translateSelectionItem` 改为 `chunkText(text, selChunkChars=600)`
   分块 → 逐块 `translateText` → `joinPieces()` 按目标语言拼接（zh/ja/ko 不加空格，拉丁加空格）→
   浮层里边翻边更新 `[data-el="dst"]`，`[data-el="info"]` 显示「正在翻译 i/n 段…」/「共 n 段」。
   - `selMaxChars` 默认 1200 → **4000**，面板「常用」组新增 `data-set="selMaxChars"`（0 = 不限），
     另有 `HARD_CAP = 60000` 兜底；超限时 info 提示「已按上限只翻前 N 字符」且译文以 `…` 结尾。
   - 浮层 CSS 放大：`min(620px,52vw)` × `62vh`，`.dst` 可滚动（原来 330px/250px 装不下长译文）。
   - 每块完成后检查 `seq !== selSeq`（新的框选/mousedown 会 `hideSelPop()` → `selSeq++`）来中止，避免旧任务覆盖新结果。
2. **DSH 外壳 / Web Component（已支持）**：实测 **DSH 全部 `dsh-client-ui-*` 客户端都不使用 shadow DOM**
   （扫描了 dsh-app rc.2 下 46 个 client.js：attachShadow 计数全为 0）→ 外壳文字本来就在光 DOM，悬停/框选都能翻。
   唯一用 shadow DOM 的是本插件自己的面板。但事件从 shadow root 冒出来时 `e.target` 会被重定向成宿主，
   旧实现走到宿主时「自身无文本 → 一路向上 → 什么都不翻」→ 现在用 `composedTarget(e)`（`e.composedPath()`）
   取最内层真实元素，Web Component 内部文字也能翻；路径里出现 `ROOT_ID` 或 `[data-dsh-at-skip]` 直接放弃。
   同时 `resetTranslationState()` 的标记清理改为 `allMarkedHosts()`（递归收集 shadow root），
   否则 shadow 内残留 `data-dsh-at` 会让那块「既翻不动也复原不了」。
3. **翻不到的地方（架构限制，不要承诺）**：DSH 页面之外的界面 —— 别的标签页 / 其它网站 / 桌面原生 App。
   客户端插件只注入 DSH 的 Web 界面，`dsh-browser` 那类扩展才是拿别的标签页的路子。

- 测试：**45 项**（新增：大量框选两例、外壳覆盖一例、Web Component 一例、两条契约）。
- ⚠️ 写 `package.json` 别用 `Set-Content -Encoding utf8`（PS 5.1 会写 **BOM + CRLF**，`JSON.parse` 直接报
  `Unexpected token '﻿'`）→ 用 `node -e "...fs.writeFileSync(...,'utf8')"` 并核对首字节不是 239,187,191。

## 关键路径

| 作用 | 路径 |
| --- | --- |
| 宿主半（路由 / 模型代理 / 诊断） | `index.js` |
| 浏览器半（扫描 / 翻译 / 悬停 / 面板） | `client.js` |
| 推理 Worker（WASM） | `vendor/worker.v5.js` |
| 内置库（transformers 浏览器 ESM） | `vendor/transformers.esm.v2.js` |
| ORT 运行时（loader 入库，wasm 走 CDN 兜底） | `vendor/ort/` |
| 宿主模型磁盘缓存 | `$DSH_HOME/dsh-auto-translate/models`（约 860MB） |
| 宿主 ORT 兜底缓存 | `$DSH_HOME/dsh-auto-translate/ort-cache` |
| 诊断落盘 | `$DSH_HOME/dsh-auto-translate/diagnose-*.json`（只留最近 20 份） |
| 重启脚本 | `C:/Users/20549/.dsh/restart-dsh-web.ps1` |
| 保险重启（SHA 比对，幂等） | `C:/Users/20549/.dsh/restart-guard.ps1` |

## dsh 本体：已升到 0.1.5-rc.2（2026-09-17）

- 运行路径（**已搬迁到稳定目录**）：`C:\Users\20549\.dsh\dsh-app\0.1.5-rc.2\node_modules\@deepseek-ai\dsh\lib\bin.js`
  - 搬迁原因：原路径在 npx 缓存里，会被 npx 自动清理、且路径带哈希不可维护。搬迁是**同目录复制**，
    模块解析路径不变（实测启动成功并加载全部插件）。
  - `restart-dsh-web.ps1` 已指向稳定目录（备份 `restart-dsh-web.ps1.bak-before-stable`）。
- 原 rc.1 安装**保持不动**（`_npx\1e7f6d9597241db0`），随时可回滚。
- 升级动机：`Lum1104/dsh-browser` 的桥接插件 pin 了最低 `0.1.5-rc.2`（README 明说 older releases are not supported）。
- rc.1 → rc.2 的差异很小：依赖数同为 72，无增删，仅 65 个 `@deepseek-ai/*` 从 `^0.1.5-rc.1` 抬到 `^0.1.5-rc.2`；bin/engines 结构不变。
- **兼容性实测结论（重要）**：`@nanmicoder/dsh-agent-teams` 在 rc.2 上**官方不支持**——它自带的
  `scripts/doctor.mjs` 直接报 `FAIL: Unsupported host 0.1.5-rc.2; recommended target is 0.1.5-rc.1`
  （`compatibility.json` 的 supportedHosts 只有 0.1.5-rc.1 / 0.1.2-rc.1 / 0.1.2-alpha.5 / 0.1.2-alpha.2）。
  **但工具确实注册且可调用**（`agent_teams_status` 正常响应），所以属于「能跑但不在支持矩阵内」。
  `dsh-vision-router` 的 peer 也只列到 rc.1，但视口工具在本机实测可用。
  出古怪行为时第一嫌疑就是版本不匹配，回滚见下。

### 重启脚本的三个坑（前两个已修，第三个是 2026-09-17 新发现）

1. **必须「子进程优先」杀**：脚本原来按命令行匹配杀进程，会先杀 npx 包装进程；它 spawn 的
   `bin.js web` 子进程会被 Windows 孤立并**继续持有 3080**，造成「重启后端口没释放」的假失败。
   现改为：先按端口反查 owner，再按命令行匹配，**降序 + 最多 3 轮重试**。
2. **别用宽条件批量杀进程**：我曾用「命令行含 dsh」的条件清理残留，**误杀了 dsh 内部的
   `subprocess-local` Job runner**，导致之后所有终端命令报
   `subprocess-local: Windows Job runner exited with exit code 4294967295`（执行器彻底失效）。
   正确做法是**只按端口反查 owner PID** 精确清理。
3. **孤儿进程可能杀不掉 → 重启静默「成功但没切换」**（2026-09-17 实测）：
   服务进程（PID 15516）的父进程早已退出，属**孤儿进程**；脚本日志明明写了
   `round 1 killing PID 15516`，但该进程**依然存活并继续持有 3080**，于是脚本后续
   启动的新实例**自行退出**（未抢占端口），结果是**旧进程继续服务、新配置未加载**，
   而日志里**没有任何失败字样**——只看到 `killing …` 就断了，很容易误判为「重启成功」。
   - **识别方法**：重启后核对「3080 owner 的启动时间」是否**变新**，并确认它的命令行指向**目标 bin**。
     只看到 `killing PID`/`launched PID` 不足以证明切换成功。
   - **正确核对**：
     `Get-NetTCPConnection -LocalPort 3080 -State Listen` 取 owner → 比 `CreationDate` 与该进程的 `CommandLine`。
   - **处理**：改用**管理员权限**的终端结束该 PID（或用任务管理器「结束任务」），再跑重启脚本；
     换言之，非管理员上下文下对孤儿进程的 `Stop-Process` 不保证生效。
   - **好消息**：这种失败是**无害**的——服务不会中断，只是停留在旧配置上。

### 回滚 rc.2 → rc.1

    Copy-Item "$env:USERPROFILE\.dsh\restart-dsh-web.ps1.bak-before-rc2" "$env:USERPROFILE\.dsh\restart-dsh-web.ps1" -Force
    # 再跑重启脚本（或先按端口杀掉 3080 的 owner PID）

### 桌面入口与本地化决策（2026-09-17）

- **不做全局安装**（`npm i -g`）：会改变模块解析根，有让 18 个 link 在 profile 的插件集体找不到依赖的风险。
  改为**把安装搬到稳定目录** `~\.dsh\dsh-app\0.1.5-rc.2`（同目录复制、零解析风险、实测可启动）。
- **桌面快捷方式**：`★ DSH 主界面（双击进入）.lnk` → Edge 打开
  `http://127.0.0.1:3080/?token=<token>`。**必须带 token**（不带返回 401）。
  - token **不写盘**，也不转 Cookie，每次启动打印在 `dsh-web-server.log` 的 `dsh web: http://…?token=` 行。
  - 取新 token：`Get-Content "$env:USERPROFILE\.dsh\dsh-web-server.log" | Select-String 'token=' | Select-Object -Last 1`
  - 改快捷方式：右键 `.lnk` → 属性 → 改目标 URL 的 token 段。
  - **`msedge.exe --app=<url>` 在本机无效**：Edge 已在运行时会把 `--app` 路由到现有实例、当标签页塞进已有窗口
    （进程里查不到独立 `--app` 窗口）。要真独立窗口必须加**专用 `--user-data-dir`**，代价是不共享登录态。

## AgentTeams（协作插件）用法与版本警告

- 触发方式：自然语言（「用 AgentTeams 做 X」）、`/agent-teams <目标>`、或直接调用 `agent_teams_*` 工具。
- 界面入口：团队运行时**活动面板出现在对话里**（分段进度、成员树、任务 DAG），**不在设置页**。
- 状态落盘：`<会话工作区>/.agent-teams/<teamId>/`（`team.json` + 各成员 `inbox/*.jsonl`）。
- 审核流程：`agent_teams_create({approval:"required"})` 只落盘可编辑草案（不建子会话、不领任务）→
  用户在 Web 界面编辑/批准 → 调度器才派发。**Captain 不得在同一轮自行批准。**
- ⚠️ **版本**：该插件官方只支持到 `0.1.5-rc.1`，本机是 rc.2（见上）。doctor 报 FAIL 但工具可用。


## dsh-browser（浏览器桥接 + Chrome/Edge 扩展，2026-09-17 安装）

- 桥接插件：`@yuxianglin/dsh-bridge-browser@0.0.5`，junction 指向 `profiles/web/.dsh-browser-source`，已在 profile bundles 第 18 项。
- 扩展产物：`~/.dsh/browser-extension`（`manifest.json` v0.1.4 + `background.js` + `content.js` + `panel/`）。
- 安装方式：从**已审过的本地 tarball** 跑 `scripts/install.ps1`（**不要**用官方的 `irm … | powershell`，
  且 `raw.githubusercontent.com` 在本机不可达）。脚本退出码 0，4 步全过。
- **扩展权限（必须知情）**：`host_permissions: http://*/* https://*/*` + `scripting` + `tabs` + `webNavigation`
  = 可读写你访问的所有网页；**未声明 `nativeMessaging`**（不能直接调用本机可执行文件，只能走本机回环 HTTP）。
- 加载方式：因为没有 Chrome，脚本未能自动打开。用 Edge：`edge://extensions` → 开发人员模式 →
  加载解压缩的扩展 → 选 `C:\Users\20549\.dsh\browser-extension`。若 Edge 的侧边栏 API 与 Chrome 不兼容，需另议。

## AgentTeams 实战：契约坑清单（2026-09-17 首次真实跑通）

首次用 AgentTeams 做了「status.ps1 增加 npm 版本漂移提示」（提交 `2ef1af5`，团队 `translate-status-drift-2`）。
**流程本身完全跑通**：草案 → Web 界面批准 → 调度派发 → 领取 → 实现 → 独立验证（5/5）→ 审查（verdict=pass）。
但我在**写契约**上踩了三个坑，全部值得记录：

1. **跨工作区文件必须用「工作区相对别名」**。我把 `inScope` 写成绝对路径
   `C:\Users\20549\.dsh\plugins\dsh-auto-translate\scripts\status.ps1`，而它在会话工作区之外 →
   `dsh-agent-teams/lib/quality-gates.js` 的 `normalizeWorkspacePath()` 对绝对路径返回 `undefined`
   → 判 `illegal`；`pathMatchesScope()` 对盘符开头的模式恒 `false` → 任何相对 changedPath 都判 `undeclared`。
   **完成时强制每个 changedPath 属于 in_scope ⇒ 任务结构上不可能 completed**（t1 因此 failed，代码没问题）。
   正确姿势：`inScope: ["scripts/status.ps1"]` + 在 objective 里注明真实物理位置；提交 changedPaths 用同一别名。
   - `amend_task` 对**已 terminal（failed）**的任务会被拒（`terminal contracts are immutable`），
     补救办法是**新建一个契约正确的任务**，再用 `edit_plan update_task` 把下游依赖原子改指过去。
2. **verify 命令必须在本机能字面执行**。我写了 `pwsh -NoProfile -Command …`，但本机**不存在 PowerShell 7**
   （`Get-Command pwsh` 未命中；Program Files / Program Files (x86) / WindowsApps 三个标准位置都没有），
   只有 Windows PowerShell 5.1 Desktop。用 `powershell.exe` 重写即可。
   另注意：`status.ps1` 在子进程 PATH 无 `dsh` 时会在 `& dsh plugin --profile web list` 抛错并**中止整个 Get-Status**
   （既有行为），所以 verify 里要显式前置 dsh 的 `.bin`：`node_modules\.bin`。
3. **`amend_task` 只传部分字段时，其余字段会被默认值覆盖**。我第二次只传 `verify` 去改 t3，结果它的
   审查专用 objective 被替换成通用文案 `Review whether the latest implementation satisfies the user goal`，
   且「必须给出 verdict」这条验收丢失。补救：用**完整 objective + acceptance** 再 amend 一次（t3 现有 2 条修订记录）。
   **教训：amend 要么给全字段，要么别用。**

其他观察：
- 成员 `reasoning_effort` **一旦批准就不能改**（运行中团队只允许改未开始任务的依赖），小任务应预先用 low。
- 小任务用 AgentTeams 是**亏的**：三层串行（实现→独立验证→独立审查）把 30 秒的活拉成十几分钟；
  它的价值在**大任务或高风险改动**上（防止一个 Agent 自说自话）。本次是冒烟测试，所以值得。
- 质量门**不放水**：t1 因契约非法被判 failed 并带结构化 finding，而不是凑合算过——这是可信度来源。

### 已修（低危，验证者发现 → 复现确认 → 修复）

`status.ps1` 的 npm 查询判定：npm 在 E404 / registry 不可达时会把 `{"error":{…}}` 写到 **stdout**，
而判定只用 `$raw -match '\{'` → 误判 `npm.ok = $true`、`version` 为空，
于是失败场景显示成 `differs from npm  (order not comparable)`（双空格）而非
`cannot compare: … (registry query failed)`。**非静默、不影响验收**。

修复：在 `$meta` 解析后补一层判定——`if ($meta -and (-not $meta.version)) { $meta = $null; ... }`，
即「没有 version 就不算查询成功」。实测：模拟 npm 输出 error JSON 时现在正确渲染
`[!] cannot compare: local … vs npm (registry query failed)`；正常场景仍渲染 sync 行；
0 非 ASCII / 无 BOM / 纯 LF / PS 5.1 解析 0 错误 / 27 项测试全绿。


## 随时查看状态（三个入口）

- 桌面快捷方式：**`dsh-translate 状态面板`**（交互式控制台，`-NoExit` 所以不会闪退）与
  **`dsh-translate 仪表盘`**（先刷新快照再用 Edge/Chrome 应用模式打开 `dashboard.html`）。
  快捷方式指向 `scripts/status.ps1` 与 `scripts/open-dashboard.vbs`，重建方式见本节末尾。
  桌面上还直接放了一份 `dsh-translate 仪表盘.html`（双击即开，不依赖快捷方式）。

## 使用量指标（能看什么、看不到什么）

- **能看**：npm 下载量（官方 `api.npmjs.org/downloads`，面板显示周/月，仪表盘另有近 14 天柱状图）；
  Gitee 的 star / fork / watch / open issue（`gitee.com/api/v5/repos/...`）。两者都是公开接口、无需凭据。
- **看不到**：**包页浏览量 / PV**——npm 与 Gitee 都不对外提供该维度的统计（npm 无任何包级浏览接口，
  探测 `/package/<name>/stats` 与 `/downloads` 之外的端点全 404）；Gitee 的访问/克隆统计**只有仓库拥有者
  登录后可见**（`/traffic` 与 API 的 traffic 端点对外均 404），所以只放直达链接由你自己看。
- **新包延迟**：npm 对刚发布的包**当天没有下载数据**（downloads API 返回 404，对照 `jsdom` 正常），
  通常第二天开始计数。面板会显示 `n/a` 并给出 Yellow 提示，不是故障。
- 结构上无法统计「有多少人本地 link/tgz 安装了插件」——没有回传通道。

- 控制台面板：

      powershell -ExecutionPolicy Bypass -File scripts/status.ps1            # 一屏：本地仓库 / Gitee / npm / 指标 / 安装态
      powershell -ExecutionPolicy Bypass -File scripts/status.ps1 -Open      # 同时打开 npm 与 Gitee 页面
      powershell -ExecutionPolicy Bypass -File scripts/status.ps1 -Watch 30  # 每 30 秒自动刷新

- HTML 仪表盘（中文界面、可一键复制安装命令、页面内可实时拉 npm/Gitee）：

      node scripts/dashboard.mjs           # 生成 dashboard.html（已 gitignore）
      node scripts/dashboard.mjs --open    # 生成并打开

> **编码坑（重要）**：`scripts/status.ps1`、`publish.ps1`、`open-dashboard.vbs` 全部**刻意写成纯 ASCII**。
> 原因是 Windows PowerShell 5.1 / wscript 读取**无 BOM 的 UTF-8** 文件时按 GBK 解释，中文字符串字面量的
> 末字节可能撞上 `'`，把整个脚本撕成非法 token 而解析失败（实测过两次）。所以凡是 `.ps1`/`.vbs` 一律 ASCII，
> 需要中文界面就交给 Node 脚本（Node 恒定按 UTF-8 读文件）。
>
> **同一个坑的第二种形态（2026-09-20 又被咬两次）**：**别用 PowerShell 去"读改写"任何 UTF-8 文件**。
> `Get-Content -Raw` 在 5.1 下同样按 GBK 解码无 BOM 的 UTF-8 → 内存里已经是乱码 → 写回就永久损坏。
> 实测受害：`DEV-STATE.md`（我用 `-replace` + `WriteAllText` 改版本号，880 处变乱码）、
> `scripts/fetch-vendor.mjs`（更早的提交里被写坏并多了 BOM）。
> 正确做法：**改文本一律用编辑工具**（edit/write，UTF-8 安全），或 `node -e "fs.writeFileSync(p, s, 'utf8')"`。
> 自检乱码特征：`锛|鈥|鏂|鐨|娴|鏍`；首字节是不是 BOM：`239,187,191`。
> 恢复办法：`git show <最后一个干净版本>:<文件>` 取回文本再重做改动（本次用 `git show 211ef92:DEV-STATE.md`）。

## 常用命令

    cd C:\Users\20549\.dsh\plugins\dsh-auto-translate
    npm test                    # 47 项离线测试：契约 + i18n + jsdom E2E
    npm run verify:browser      # 真浏览器验收：真实布局/是否滚动/裁字 + 真实鼠标悬停与框选（需 Edge + puppeteer-core）
    npm run fetch-vendor        # 重建 vendor/（换机器或要完全离线时）
    powershell -File scripts/publish.ps1 -Target slimzip   # 生成给 Gitee 网页上传的包
    git push gitee main

## 推送到 Gitee（踩过的坑）

- 凭据由 Git Credential Manager 管理，凭据条目名：`LegacyGeneric:target=git:https://gitee.com`。
- **坑**：Windows 凭据里残留过一个 15 字符的 `enc!…` 加密占位串，导致 git 反复重试认证，最后报
  `fatal: the remote end hung up unexpectedly`——表现像网络问题，实质是坏凭据。
  处理：`cmdkey /delete:"LegacyGeneric:target=git:https://gitee.com"`，重新 push 并在弹出的
  GCM 窗口里用**私人令牌**（Gitee → 设置 → 私人令牌，勾 `projects`）登录。
- 判断凭据是否有效：`git push --dry-run https://gitee.com/nysjn/__not-a-repo__.git main`
  返回 `remote: 404 not found!` 说明**认证已通过**（只是仓库不存在）；返回 401 才是凭据无效。
- push 需要 GUI 会话才能弹凭据窗，前台跑会被工具超时掐断；用后台任务 + 日志文件观察。

## 发布到 npm（踩过的坑）

- 账号 `nysjn`（邮箱 3305406477@qq.com，会公开显示在包页上）。包名 `dsh-auto-translate`，2026-09-16 发布 0.2.0。
- **坑 1：`npm login --auth-type=web` 不能放在后台任务里跑**——拿不到 stdin 时会退化成 `Username:` 提示，
  空提交直接 exit 1，`.npmrc` 不生成（`npm whoami` 仍 ENEEDAUTH）。必须让用户在**自己的终端**里跑。
- **坑 2：注册时的「邮箱一次性密码」不等于 npm 登录密码**，别混。
- **坑 3：npm 现在拒绝「没开 2FA 的账号」发布**，报
  `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages`。
  `npm profile get` 里 `tfa: False` 就是根因。加 `--otp=` 也无效（账号没开 2FA 时服务器不校验 OTP）。
- **可行解**：在 https://www.npmjs.com/settings/nysjn/tokens 建 **Granular Access Token**，必须做到三件事——
  ① 勾 `Bypass two-factor authentication (2FA)`；② Permissions 选 `Read and write (publish and stage)`；
  ③ Select packages 选 `All packages`。三项缺一，生成的令牌权限就是空的（Summary 会写 `0 packages`）。
- 发布命令（令牌只临时用一次，发完立刻删）：
  `npm config set //registry.npmjs.org/:_authToken=<令牌>` → `npm publish --access public` → `npm config delete //registry.npmjs.org/:_authToken`
- 两个反直觉点：① `www.npmjs.com` 对脚本请求返回 **403**（Cloudflare），但 `registry.npmjs.com` 正常；
  ② **npm 没有网页上传 tgz 的入口**，`npmjs.com/package/upload` 会被当成「包名 upload」解析，别被误导。
- 发布后 `npm view` 可能仍 404 数十秒（CDN 未刷新），**不代表失败**；以 `npm publish` 输出里的
  `+ dsh-auto-translate@0.2.0` 为准。
- 官方公告：bypass-2fa 令牌 **2027 年 1 月起不能再直接发布**，届时需改用 Trusted Publishing（依赖 GitHub Actions，
  本机 GitHub 不通）或 staged publishing。以后要发新版本，最省事的仍是「临时建一枚 bypass 令牌 → 发 → 吊销」。

## GitHub 不可达（实测）

- `github.com` 的 git smart-http 请求挂到 180 秒超时，网页也打不开（无 VPN），三个 npm/gitee 域名则都通。
- 因此插件市场的**自动收录**（要求 GitHub 仓库 + `dsh-plugin` 话题）与 OIDC 可信发布都走不了；
  分发只靠 Gitee 镜像 + npm + 本地 tgz 三条。
- 插件市场里已有一个**同名**的 `dsh-auto-translate`（作者 qwert702，GitHub 仓库，★2），
  走的是「调用模型翻译」路线，与本插件（浏览器内 WASM、零 token）是两套东西，注意别混淆。

## 重启的正确姿势（踩过的坑）

- 直接用前台 pwsh 或 Start-Process 跑重启脚本，脚本会在杀服务后被杀连带死掉（日志只停在 `script PID`）。
- 可靠做法：用计划任务调用 `restart-guard.ps1` —— 它只在「服务进程启动时间 < 插件文件修改时间」时才重启，天然幂等。

## 现状与已知限制

- 语向：en→zh 用 fp32 干净图（约 425MB）；ja/ko 等→zh 走两跳经 en（约 425MB）而不是 NLLB 5GB，NLLB 仍可选。
- 量化变体（int8 / uint8 / q8 / q4 / bnb4）在本机 ONNX Runtime 上会触发
  `TransposeDQWeightsForMatMulNBits Missing required scale`，因此**刻意只用 fp32**。
- 模型 revision 已锁 sha，见 `vendor/worker.v5.js` 里的 `REVISIONS`。
- 在线引擎 MyMemory 有每日额度（可能 429）；端侧 Translator 需连 Google 组件服务器（本网络不可用）。
- 仓库跟踪 26 个文件、约 1MB；74MB 的 ORT wasm 被 `.gitignore` 排除（`vendor/ort/*.wasm`），
  首次使用时宿主端从 CDN 取回并缓存；要完全离线先 `npm run fetch-vendor`。

## 下一步候选

1. jsdom 纯 E2E：翻译 → 悬停切换 → 观察者不覆盖（目前只到纯函数级）。
2. 面板已中英双语；README 与诊断文本可再细化英文。
3. ~~若要让插件市场自动收录，还需把仓库放到 GitHub 并加 `dsh-plugin` 话题~~ —— **已做完但仍未被收录**，
   卡点已确认不在本仓库，见下节；别再在本仓库里折腾。

## 上架与发现：市场还没收录、README 改成「为发现而写」（2026-09-30，未发版）

### 1. 还没进插件目录 —— 证据链指向市场侧，不是本仓库

- GitHub 侧**逐项合格**：`api.github.com/repos/gst20060726/dsh-auto-translate` 的 `topics` 含 `dsh-plugin`；
  用 GitHub 自己的搜索 `topic:dsh-plugin user:gst20060726` 得 `total_count: 1`。public、未归档、MIT。
- 扫描器**在跑**：`w2112515/dsh-plugin-marketplace` 的 `Publish plugin catalog`
  （`.github/workflows/catalog-pages.yml`，cron `17 3 * * *`）09-29 / 09-30 两次 `success`；
  被拒候选存成 artifact `plugin-marketplace-rejected-v1`（要登录才能下）。
- 收录门槛（读 `scripts/plugin-marketplace-scan.ts` 得到，不是猜）：根 `package.json` 存在且合法 →
  声明 `dsh.bundle.patch` → 补丁路径安全且文件存在 → **补丁是合法 Cordis 文档**
  （`Array.isArray(patch) && 每项含 insert/update/remove`）→ 仓库未归档。本仓库逐条通过。
- 但目录里没有它，且最新条目的 `first indexed` 都停在 `2026-09-14T08:53:37.655Z`
  （`dsh-flow` 与 `dsh-optimize` 时间戳一字不差）；本仓库的 GitHub id（1392711635）比目录里任何条目都新。
- **未提 issue**（用户说不用）。结论：这是市场侧的事，**别在本仓库里改来改去**。

### 2. npm 的 `files` 会让 `.npmignore` 变哑（真踩过，差点泄漏）

只要 `package.json` 有 `files` 字段，npm **忽略 `.npmignore` 的排除规则**。现成证据：`.npmignore` 里写着
`CHANGELOG.md`，可它一直在包里。所以「不打包某文件」只能靠 `files` **逐项点名**：本次给 README 加图时
先写了 `"demo"` 整目录，结果把含真实会话的 `demo/raw/*.png` 也打进了**公开 npm 包**（比 git 泄漏更糟）；
改成点名五个文件后 `npm pack --dry-run` 实测拦住。

### 3. 发现面：README + 演示图

- README 改成「为发现而写」：居中标题 + 一句话定位 + **动态**徽章（原来版本号是硬写的 0.4.2）+ 图组
  + 「30 秒看懂」；顺手修掉 11 处把行内代码写成 `[[...]]` 的地方（GitHub 上会原样显示）。技术内容一字未删。
- 演示图三连 `demo/hover-1|2|3-*.png` 由 `npm run capture:demo`（`scripts/capture-demo.mjs`）产出：
  注入**合成舞台**（白底面版 + 对话块 + 光标标记）→ 真鼠标三个位置 → 按舞台矩形裁 560×150。
  ⚠️ **系统光标 headless 截不到**，箭头是脚本画的标记（位置 = 真鼠标坐标，悬停本身是真事件），README 已注明。
- ⚠️ 逐像素自查脚本第一版有越界 + 变量未重置的 bug（报出假的「484 暗像素」）。正确做法：**图内坐标
  = 屏幕坐标 − 舞台原点**，并留一块同尺寸对照区（实测：光标窗口 暗 85 / 亮 351，对照区 0）。
- 真机验收顺手又跑通一次：`npm run verify:browser` → `passed=true`、`failures=[]`。
- **待办**：npm 页面上的 README 仍是 0.4.2 发布时那份 —— 要让新 README 与五张图出现在 npmjs，
  得发 **0.4.3**（需要 npm token，放在本机 `~/.npmrc`；顺便把 `repository/homepage/bugs` 指向 GitHub）。


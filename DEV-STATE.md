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

- 版本 0.2.2 ｜ 本地 git 仓库（`git log --oneline -1` 看最新提交）
- 已安装为 profile link：`dsh plugin --profile web add link:C:/Users/20549/.dsh/plugins/dsh-auto-translate`
- 已上线镜像：**https://gitee.com/nysjn/dsh-auto-translate.git**（远端名 `gitee`，`main` 跟踪 `gitee/main`）
- 已发布 npm：**dsh-auto-translate@0.2.1**（latest）｜ 0.2.0 也在线上 ｜ **0.2.2 尚未发布**
  - 别人安装：`dsh plugin --profile web add dsh-auto-translate`（拿到的是 latest = 0.2.1，**还没有悬停翻译模式**）
  - ✅ **更正**：0.2.1 当时并非「发布失败」——`npm publish` 打印成功行后，registry 的 packument 与 tarball
    **同步有延迟（实测约 3~5 分钟）**，我当时立刻查询才看到 404。现在 0.2.1 的 tarball 已可正常下载。
    教训：**判定发布成功要轮询几分钟**，别用发布后立刻的第一次查询下结论；也不要只看 publish 的输出。
    排查办法：`npm view <pkg> --json` 看 `time` 与 `versions`，再 HEAD 一下
    `https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz`。
  - 每次发布的令牌流程见下面「发布到 npm」一节（临时 bypass 令牌 → 发 → 立即删除 → 回 npm 吊销）
- 生效方式：改完 `index.js` 或 `client.js` 必须**重启 dsh web**；`vendor/` 下的文件是运行时按需加载，改动无需重启
  - 判断是否已重启：`(Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess` 取 PID，比该进程 `StartTime` 与 `client.js` 的 `LastWriteTime`

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

## 常用命令

    cd C:\Users\20549\.dsh\plugins\dsh-auto-translate
    npm test              # 11 项离线测试：契约 + i18n + jsdom E2E
    npm run fetch-vendor  # 重建 vendor/（换机器或要完全离线时）
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
3. 若要让插件市场**自动收录**，还需把仓库放到 GitHub 并加 `dsh-plugin` 话题（Gitee 不参与收录）。

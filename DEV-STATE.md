# 开发状态（续接笔记）

> dsh web 重启或上下文压缩之后，先读这个文件即可继续工作。

## 当前版本

- 版本 0.2.0 ｜ 本地 git 仓库（`git log --oneline -1` 看最新提交）
- 已安装为 profile link：`dsh plugin --profile web add link:C:/Users/20549/.dsh/plugins/dsh-auto-translate`
- 已上线镜像：**https://gitee.com/nysjn/dsh-auto-translate.git**（远端名 `gitee`，`main` 跟踪 `gitee/main`）
- 生效方式：改完 `index.js` 或 `client.js` 必须**重启 dsh web**；`vendor/` 下的文件是运行时按需加载，改动无需重启

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

## 常用命令

    cd C:\Users\20549\.dsh\plugins\dsh-auto-translate
    npm test              # 9 项离线测试：契约 + i18n + jsdom E2E
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

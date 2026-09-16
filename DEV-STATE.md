# 开发状态（接续笔记）

> 任何一次 dsh web 重启或上下文压缩之后，先读这个文件即可接续工作。

## 当前版本

- 版本 0.2.0 ｜ 本地 git 仓库（`git log --oneline -1` 看最新提交）
- 已安装为 profile link：`dsh plugin --profile web add link:C:/Users/20549/.dsh/plugins/dsh-auto-translate`
- 生效方式：改完 `index.js` 或 `client.js` 必须**重启 dsh web**；`vendor/` 下的文件是运行时按需加载，改动无需重启

## 关键路径

| 作用 | 路径 |
| --- | --- |
| 宿主半（路由 / 模型代理 / 诊断） | `index.js` |
| 浏览器半（扫描 / 翻译 / 悬停 / 面板） | `client.js` |
| 推理 Worker（WASM） | `vendor/worker.v4.js` |
| 内置库（transformers 浏览器 ESM） | `vendor/transformers.esm.v2.js` |
| ORT 运行时（loader 入库，wasm 走 CDN 兜底） | `vendor/ort/` |
| 宿主模型磁盘缓存 | `$DSH_HOME/dsh-auto-translate/models`（约 860MB） |
| 宿主 ORT 兜底缓存 | `$DSH_HOME/dsh-auto-translate/ort-cache` |
| 诊断落盘 | `$DSH_HOME/dsh-auto-translate/diagnose-*.json`（只留最近 20 份） |
| 重启脚本 | `C:/Users/20549/.dsh/restart-dsh-web.ps1` |
| 保险重启（SHA 比对，幂等） | `C:/Users/20549/.dsh/restart-guard.ps1` |

## 常用命令

    cd C:\Users\20549\.dsh\plugins\dsh-auto-translate
    npm test              # 9 项离线测试：契约 + i18n 完整性
    npm run fetch-vendor  # 重建 vendor/（换机器或要完全离线时）
    git log --oneline -5

## 重启的正确姿势（踩过的坑）

- 直接用前台 pwsh 或 Start-Process 跑重启脚本，脚本会在杀掉服务后被连带杀死（日志只停在 `script PID`）。
- 可靠做法：用计划任务调用 `restart-guard.ps1` —— 它只在「服务进程启动时间 < 插件文件修改时间」时才重启，天然幂等。

## 现状与已知限制

- 语向：en↔zh 用 fp32 干净图（约 425MB）；ja/ko 等→zh 走 NLLB 600M（按需 600MB）
- 量化变体（int8 / uint8 / q8 / q4 / bnb4）在本机 ONNX Runtime 上会触发
  `TransposeDQWeightsForMatMulNBits Missing required scale`，因此**刻意只用 fp32**
- 模型 revision 已锁 sha，见 `vendor/worker.v4.js` 里的 `REVISIONS`
- 在线引擎 MyMemory 有每日额度（可能 429）；端侧 Translator 需连 Google 组件服务器（本网络不可用）

## 下一步候选

1. jsdom 级 E2E：翻译 → 悬停切换 → 观察者不覆盖（目前只到纯函数级）
2. 面板已中英双语；README 与诊断文本可再细化英文
3. 发版：建 GitHub 仓库 → 加话题 `dsh-plugin` → 可选 npm publish（见 README）

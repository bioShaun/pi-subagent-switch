# 后续待办（Backlog）

来源：2026-11-07 打磨复盘。以下事项收益/复杂度比一般或受外部条件限制，暂不实施。

## 1. Schema 白名单与 pi-subagents 版本漂移

- 现状：`src/schema.ts` 字段白名单钉死在 pi-subagents 0.85.0（字段来源见文件头注释）。
  上游新增字段后，含新字段的档会被误拒（`未知字段`），这是白名单方案的固有代价。
- 可选方向：升级 pi-subagents 时同步核对 agents.js / model-scope.js 字段表并更新白名单；
  或在未知字段错误文案中注明对齐的版本号，提示用户可能是版本漂移。
- 触发条件：实际遇到上游新字段被误拒时再处理。

## 2. 状态栏在外部改动后过期

- 现状：状态栏只在 `session_start` 与每次 `/subprofile` 命令结束后刷新。外部编辑
  settings.json、或其它会话切档后，当前会话状态栏显示过期，直到下次命令或新会话。
- 可选方向：监听 settings.json mtime（fs.watch 或惰性指纹检查）；或在更多 host 事件上
  挂 refreshStatus。均需引入新机制，复杂度收益比一般。
- 备注：状态栏本身只是提示，切换功能不受影响；`/subprofile list` 随时可获得准确状态。

## 3. GitHub Actions CI（暂缓：Actions 额度有限）

- 事项：加一个跑 `npm run typecheck && npm test` 的 workflow（Node 24，`npm ci`）。
- 现状：验证全靠本地 `npm run typecheck && npm test`（176+ 测试）。
- 触发条件：额度充裕或协作人数增加时再加。
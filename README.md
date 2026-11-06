# pi-subagent-switch

一个独立的 Pi 扩展：预先手写几套 subagent 配置档，用一条命令把 user 级
`~/.pi/agent/settings.json` 的 **`subagents` 整块**换成选中的档，并在状态栏常显当前档名。

- 零运行时依赖；业务全部在 `src/`，`extensions/index.ts` 只做 host 适配。
- 运行与测试统一要求 **Node 24+**（`node --test` 直跑 `.ts`）。
- 档文件由用户**手写、插件只读不写**；随包预置 4 个示例档。

## 用法

| 输入 | 行为 |
| --- | --- |
| `/subprofile` | 打开会话内联、键盘优先的 TUI 选择器：`↑/↓` 或 `j/k` 移动、`Enter` 应用、`Esc` 取消；当前档行尾 `●` 并加粗 |
| `/subprofile kimi` | 直接切换到 `kimi` 档 |
| `/subprofile list` / `ls` | 逐条列出档名 / `defaultModel` / override 数 / 当前档标记，并提示档目录与来源 |
| `/subprofile help` / `-h` / `--help` | 显示用法 |
| `/subprofile <Tab>` | `getArgumentCompletions` 补全档名 |

状态栏用唯一 key `pi-subagent-switch`，显示 `subagents: kimi` / `subagents: custom` /
`subagents: 无档`；在 `session_start` 事件与每次 `/subprofile` 命令结束后刷新（含
`list`、帮助、取消与失败），每次重新加载档目录并读取 user settings。非 TUI 模式
（`rpc` / `json` / `print`）下选择器降级为警告，提示改用 `<name>` 直切。

## 档文件格式

**档文件正文就是 `settings.json` 里 `"subagents"` 的值本身**——没有外层包装、没有
`name` / `description` 元数据，文件名主干即档名（如 `kimi.json` → `/subprofile kimi`）。
这样可以直接从 settings.json 复制粘贴，切回 `gpt` 即恢复当前 `subagents` 的 JSON 值：

```json
{
  "defaultModel": "kimi-coding/k3.1-pro",
  "agentOverrides": {
    "worker": { "model": "kimi-coding/k3.1-pro", "thinking": "medium" }
  }
}
```

档按 **pi-subagents 0.85.0 字段白名单**校验；未知字段、`fallbackModels`、`launcher`
会给出「档名 + 字段路径」的可读错误且**不落盘**。单个档损坏不影响其它档，`list`
会逐条告警，按名直切损坏档返回原始 JSON/schema 错误（不会误报为「档不存在」）。

## 目录优先级（插件只读）

1. 环境变量 `PI_SUBAGENT_PROFILES_DIR`（设置后**不回退**）
2. `~/.pi/agent/subagent-profiles/*.json` — 用户手写主位置
3. 包内 `profiles/*.json` — 随插件发布的 4 个示例档，仅当上面都没有可用档时兜底

只认 `*.json`（大小写不敏感），跳过以 `.` 开头的文件名。实际生效目录在
`/subprofile list` 中显示为 `档目录：<dir> (<source>)`。

## 4 个示例档

| 档 | defaultModel | 说明 |
| --- | --- | --- |
| `gpt` | `tcuni/gpt-6.1-terra` | 当前 settings 的 `subagents` 原文（8 个 override），切回即还原 |
| `kimi` | `kimi-coding/k3.1-pro` | 全 kimi-coding 模型 |
| `claude` | `tcuni-claude/claude-opus-5-5` | 全 tcuni-claude 模型 |
| `local` | `qwen-local/qwen3.8-27b` | 全本机 27B，一律 `thinking: off` 压延迟 |

四档结构一致（8 个 override，`tools` / `mutationTools` / `subagentOnlyExtensions`
原样保留），只换 `defaultModel` / `model` / `thinking`。
示例档里的 `subagentOnlyExtensions` 是**本机绝对路径**，跨机器使用需自行修改。

### 给 LLM / agent 的配置提示词

把下面这句直接发给具备终端与文件工具的 LLM/agent：

```text
请阅读 https://github.com/bioShaun/pi-subagent-switch 的 README 和 ~/.pi/agent/subagent-profiles/gpt.json，先让我从 GPT / Kimi / Claude / 本地 / 自定义中选择模型方案并确认新档名，再沿用 gpt 的 8 角色结构在 ~/.pi/agent/subagent-profiles/ 创建对应的纯 subagents JSON（若档已存在先询问我），确认所需模型均在 enabledModels 中后用 /subprofile list 验证，最后执行 /subprofile <档名> 完成切换，不要直接编辑 settings.json 或执行安装。
```

## 写盘安全与备份

切换 = 找到档 → 校验 → 读 settings → 若当前 `subagents` 已等于目标档则**不写盘、不
备份** → 深拷贝顶层文档、**仅替换 `subagents` 键** → 备份 → 原子写。

- **整块替换，不是合并**：原 `agentOverrides` 里目标档没有的 agent 会消失。
- 其它顶层键（`theme` / `packages` / `compaction` / `enabledModels` / `defaultTools` …）
  的 **JSON 值保持不变**；整个文件以 `JSON.stringify(doc, null, 2)` 重新序列化，
  允许缩进、空白与转义形式变化，**不承诺保留原始字节**。
- 每次实际写入前生成 `settings.json.bak-<YYYYMMDD-HHmmss>`，内容为**切换前的原始
  字节**，权限固定 `0o600`；临时文件同目录、`flag:"wx"`、缺省 `0o600`（已有 settings
  则保留原 mode）→ `renameSync` 覆盖，失败会清理临时文件。
- 写前重读做 sha256 指纹比对，尽力检测并发改动；比对到 rename 之间仍有极小竞争
  窗口，本期不引入跨进程锁。
- 备份只增不减，本期**不自动清理**：`rm ~/.pi/agent/settings.json.bak-*`。

## 生效时机（无需 `/reload`）

`pi-subagents` 用 `size:mtimeMs` 指纹惰性失效重读 settings，因此切换后**无需
`/reload`**，**下一次启动 subagent 时生效**；已在运行的 subagent 不受影响。
本插件也**不调用 `ctx.reload()`**。

状态栏只反映 user 级 settings 的内容比对结果，不代表项目级 `.pi/settings.json`
逐字段覆盖后的最终有效值；`list` / 切换提示不做全局有效性承诺。
「当前档」由内容深比较推导（键序无关），不新建任何状态文件；内容重复的档取
字典序最小者并在 `detail` 注明重复档名。

## 开发与验证

```bash
npm install --no-audit --no-fund
npm run typecheck     # tsc --noEmit，strict + noUncheckedIndexedAccess，0 error
npm test              # node --test "test/*.test.ts"，全 pass、无 skip、# fail 0
```

测试覆盖：schema 全表、档目录优先级与损坏档、settings 备份/权限/并发指纹、当前档
检测、切换编排、状态刷新、按键解析、内联选择器、命令分支、fake Pi/ctx 宿主接线，
以及用 `test/fixtures/settings.sample.json` 在临时目录做的文件层端到端（不碰真实
settings）。`docs/prototype.html` 是零依赖、离线可打开的行为与视觉基准，只使用内存
数据、不读写真实文件。

## 真机安装（由用户自行决定并执行）

本插件不会自动执行 `pi install`（它会改 settings 的 `packages`）。从 GitHub 安装：

```bash
pi install https://github.com/bioShaun/pi-subagent-switch
mkdir -p ~/.pi/agent/subagent-profiles
cp ~/.pi/agent/git/github.com/bioShaun/pi-subagent-switch/profiles/*.json ~/.pi/agent/subagent-profiles/
```

也可以安装本地源码：`pi install /path/to/pi-subagent-switch`。

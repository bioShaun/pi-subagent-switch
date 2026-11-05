# pi-subagent-switch 方案（审核版）

> **状态：待用户确认，实现暂停；技术审核修正已合入。**
> 本文是 `../plans/subagent-switch-plan.md`（完整实现契约：接口签名、行号依据、分步 Todo、自动化与真机验收）的审核摘要，两者设计一致，细节以契约为准。
> 交互原型：[`./prototype.html`](./prototype.html) — 离线打开，可演示命令、Tab 补全、内联选择器、备份与 custom 状态；不读写真实文件。
> 目标目录：`/home/tcuni-claw/pi/pi-subagent-switch`
>
> **审核结论：方案可行。** 已修正 JSON 重写语义、损坏档错误路径、状态刷新接口与时机、宿主集成验收、备份权限和 Node 版本下界；以下正文均为修正后的版本。

---

## 1. 一句话

一个**独立的 Pi 扩展**：预先手写好几套 subagent 配置档（`gpt` / `kimi` / `claude` / `local`），在 Pi 里用一条命令把 `~/.pi/agent/settings.json` 的 **`subagents` 整块**换成选中的档，并在状态栏常显当前档名。

---

## 2. 需求确认（你已拍板的 4 项）

| 项 | 选择 | 含义 |
| --- | --- | --- |
| 一个档覆盖什么 | **整个 `subagents` 块** | 不只换模型，`tools` / `mutationTools` / `subagentOnlyExtensions` 等结构字段也跟着整档走 |
| 怎么切 | **TUI 选择器 + 带参命令 + 状态栏**，三者都要 | 无参开选择器、`<name>` 直切、footer 常显当前档 |
| 档怎么维护 | **纯手写 JSON 文件，插件只读不写档文件** | 随包预置 4 套示例，用户自己改文件 |
| 技术路线 | **独立新插件** | 不依赖、不修改 `pi-subagent-cfg`(`/submodel`)，不用原生 `agentOverridesByProvider` |

---

## 3. 现场环境（已实读核实）

| 事实 | 说明 |
| --- | --- |
| Pi `1.5.0` / pi-subagents `0.85.0` | 扩展宿主与 subagent 实现版本 |
| 当前 `settings.json` 里的 `subagents` **就是一套 gpt 档** | `defaultModel: tcuni/gpt-6.1-terra`，8 个 `agentOverrides`（oracle / evidence-auditor / delegate / reviewer / worker / researcher / scout / planner-validator） |
| `enabledModels` 覆盖本方案所需模型来源 | 包括 `tcuni/gpt-*`、`kimi-coding/*`、`tcuni-claude/*`、`tcuni-agy/*`、`qwen-local/*`；个别现存引用是否启用见 §5 的风险说明 |
| 已有 `pi-subagent-cfg`（`/submodel`）是**逐字段编辑器**，且锁 `pi-subagents 0.64.x`，在当前 0.85.0 上会拒绝打开 | 定位不同，本插件不动它 |
| 原生 `agentOverridesByProvider` 按**父会话 provider** 自动叠加一层覆盖 | 与主模型绑定、且是叠加语义，不是独立选档；本插件不用 |
| 写 `settings.json` 后**无需 `/reload`** | pi-subagents 用 `size:mtimeMs` 指纹惰性失效，下次取 agent 列表时自动重读 |
| `getSettingsPath()` 在 1.5.0 **未**从包入口导出 | 实现需 `join(getAgentDir(), "settings.json")` 兜底 |

---

## 4. 核心设计（重点审核）

### 4.1 档文件长什么样 ← 请确认

**档文件正文就是 `settings.json` 里 `"subagents"` 的值本身**，没有外层包装、没有 `name` / `description` 元数据。文件名主干 = 档名。好处是可以直接从 settings.json 复制粘贴，切回 `gpt` 即恢复当前 `subagents` 的 JSON 值；这不等于恢复整个文件的原始格式字节。

`profiles/gpt.json`（= 当前 `settings.json:23-97` 的 `subagents` 原文）：

```json
{
  "defaultModel": "tcuni/gpt-6.1-terra",
  "agentOverrides": {
    "oracle":            { "model": "tcuni/gpt-6-astra",    "thinking": "high" },
    "evidence-auditor":  { "model": "tcuni/gpt-6.1-sol",    "thinking": "high" },
    "delegate":          { "model": "tcuni/gpt-6.1-terra",  "thinking": "medium" },
    "reviewer": {
      "model": "tcuni/gpt-6-astra", "thinking": "high",
      "subagentOnlyExtensions": ["/home/tcuni-claw/.pi/agent/git/github.com/bioShaun/pi-planner-only/reviewer-git.ts"],
      "tools": ["read", "grep", "find", "ls", "watchdog_diff", "contact_supervisor", "git_review"]
    },
    "worker": {
      "model": "tcuni/gpt-6.1-terra", "thinking": "medium",
      "subagentOnlyExtensions": ["/public/config/pi/shared/pi-apply-patch/src/index.ts"],
      "tools": ["read", "grep", "find", "ls", "bash", "edit", "write", "contact_supervisor", "apply_patch"],
      "mutationTools": ["apply_patch"]
    },
    "researcher":        { "model": "tcuni/gpt-6-luna",     "thinking": "medium" },
    "scout": {
      "model": "tcuni/gpt-6-luna", "thinking": "low",
      "tools": ["read", "grep", "find", "ls", "bash", "write", "contact_supervisor"]
    },
    "planner-validator": { "model": "tcuni/gpt-6.1-terra",  "thinking": "medium" }
  }
}
```

另外 3 个档**结构完全相同**（8 个 override、`tools` / `mutationTools` / `subagentOnlyExtensions` 原样保留），只换 `defaultModel` 与各 `model` / `thinking`，见 §5。

### 4.2 档文件放哪 ← 请确认

按优先级查找（`docs` 之外的运行期路径，插件**只读、绝不写档文件**）：

1. 环境变量 `PI_SUBAGENT_PROFILES_DIR` 指向的目录（设了就不回退）
2. `~/.pi/agent/subagent-profiles/*.json` — 用户手写主位置
3. 包内 `profiles/*.json` — 随插件发布的 4 个示例档，仅当上面都没有可用档时兜底

只认 `*.json`，跳过 `.` 开头的文件；单个档损坏不影响其它档。损坏档进入 errors 列表，在 `list` 和打开选择器前告警；按名字直切损坏档时返回原始 JSON/schema 错误，不能误报为“档不存在”。

### 4.3 「当前档」怎么判定

不建任何状态文件：把 `settings.json` 现有 `subagents` 与每个档做**稳定序列化后的深比较**（键序无关），命中即档名，否则显示 `custom`。用于状态栏与选择器里高亮。两个档内容相同时取字典序最小并注明重复。

### 4.4 切换一次做了什么 ← 请确认（写盘安全）

1. 找到档 → 按 **pi-subagents 0.85.0 字段白名单**校验；未知字段 / `fallbackModels` / `launcher` 直接报「档名 + 字段路径」错误，**不落盘**（0.85.0 已移除 `fallbackModels`，旧 `/submodel` 的校验逻辑不能抄）
2. 读 `settings.json`，解析失败即中止
3. 若当前 `subagents` 已等于目标档 → **不写盘、不备份**（避免反复切同档刷出一堆 `.bak`）
4. 深拷贝顶层文档，**仅替换 `subagents` 键**，其它键（`theme` / `packages` / `compaction` / `enabledModels` / `defaultTools` …）的 JSON 值保留；整个文件会重新序列化，允许缩进、空白与转义形式变化，不承诺原始字节不变
5. 写前生成 `settings.json.bak-<YYYYMMDD-HHmmss>` 备份（内容 = 切换前的原始字节，权限固定 `0o600`）
6. 原子写：同目录临时文件（`flag:"wx"`，缺省 `0o600`、已有 settings 则保留原 mode）→ `renameSync` 覆盖；失败清理临时文件
7. 写前重读做 sha256 指纹比对，尽力检测并发改动；比对到 rename 之间仍有极小竞争窗口，本期不引入跨进程锁
8. **不调用 `ctx.reload()`**；命令结束后刷新状态栏，成功时提示「下一次启动 subagent 生效，已在运行的不受影响」

### 4.5 命令与交互 ← 请确认命令名

| 输入 | 行为 |
| --- | --- |
| `/subprofile` | 打开会话内联、键盘优先的 TUI 选择器：`↑/↓` 或 `j/k` 移动、`Enter` 应用、`Esc` 取消；当前档行尾 `●` 并加粗 |
| `/subprofile kimi` | 直切，成功后 notify（含备份文件名），状态栏变 `subagents: kimi` |
| `/subprofile list` | 逐条列出档名 / defaultModel / override 数 / 当前档标记，并提示档目录与来源 |
| `/subprofile help` | 用法 |
| `/subprofile <Tab>` | `getArgumentCompletions` 补全档名 |

状态栏用唯一 key `pi-subagent-switch`，显示 `subagents: kimi` / `subagents: custom` / `subagents: 无档`；在 `session_start` 与每次 `/subprofile` 命令结束后刷新（含 list、帮助、取消和失败），每次重新加载档目录并读取 user settings。非 TUI 模式（`json`/`print`）的选择器降级为「请用 `<name>` 直切」。

> 命令名暂定 **`/subprofile`**（短、好敲）。若你更想叫 `/subagent-switch` / `/profile`，改一个字符串即可。

---

## 5. 四个预置档 ← 请确认模型分配

结构 = §4.1 的 gpt 档，8 个 override 与所有 `tools` / `subagentOnlyExtensions` 原样保留，只换模型与 thinking。

| 档 | `defaultModel` | 重度角色（oracle / reviewer / evidence-auditor） | 日常（delegate / worker / planner-validator） | 轻量（researcher / scout） |
| --- | --- | --- | --- | --- |
| `gpt` | `tcuni/gpt-6.1-terra` | `gpt-6-astra` (high) / `gpt-6.1-sol` (high) | `gpt-6.1-terra` (medium) | `gpt-6-luna` (medium / low) |
| `kimi` | `kimi-coding/k3.1-pro` | `k3.1-pro` (high) / `k3-256k` (high) | `k3.1-pro` (medium) | `kimi-for-coding` (medium / low) |
| `claude` | `tcuni-claude/claude-opus-5-5` | `claude-opus-5-5` (high) | `claude-sonnet-5-5` (medium) | `claude-sonnet-5-5` (medium / low) |
| `local` | `qwen-local/qwen3.8-27b` | 全部 `qwen-local/qwen3.8-27b` | 同左 | 同左 |

- `local` 档全部 `thinking: "off"`（本机 27B 压延迟；想开思考改档文件即可）。
- `kimi` / `claude` / `local` 三档引用的模型 ID 全部取自真实 `settings.json` 的 `enabledModels`（已逐个校验通过）。
- 示例档里 `subagentOnlyExtensions` 是**本机绝对路径**，跨机器使用需自行改（README 会注明）。

> **审核时发现的一处现状不一致**：`gpt` 档的 `researcher` / `scout` 用的是 `tcuni/gpt-6-luna`，但这个模型**不在** `enabledModels` 列表里 —— 你当前的 `settings.json` 本来就是这样，不是新引入的。`gpt` 档按「逐字段复制当前 subagents 值」原则保留了它，以保证切回后该配置块的 JSON 值不变；是否要顺手把它换成已启用模型（或把 `gpt-6-luna` 补进 `enabledModels`），见 §10 第 8 点。

---

## 6. 文件布局

```
pi-subagent-switch/
├── package.json                  # pi.extensions 指向 ./extensions/index.ts，零运行时依赖，Node 24+
├── tsconfig.json                 # ES2023 / nodenext / allowImportingTsExtensions / strict
├── README.md                     # 用法、档文件格式、目录优先级、生效时机
├── docs/
│   ├── proposal.md               # 本审核摘要
│   └── prototype.html            # 离线交互与视觉原型
├── extensions/index.ts           # 唯一 host 适配层：注册 /subprofile + session_start 刷新状态
├── src/
│   ├── pi-types.d.ts             # 手写 host 类型 shim（对齐 Pi 1.5.0，故不依赖安装 pi）
│   ├── fs.ts / stable-json.ts    # 可注入假 fs、稳定序列化
│   ├── schema.ts                 # 0.85.0 字段白名单校验器
│   ├── profiles.ts               # 档目录解析 / 读档 / 校验 / 摘要
│   ├── settings-store.ts         # settings 读 / 整块替换 / 备份 / 原子写 / 并发指纹
│   ├── current-profile.ts        # 内容深比较 → 当前档名
│   ├── apply-profile.ts          # 切换编排
│   ├── status.ts / keys.ts       # 状态栏文本、终端按键解析（不引入 pi-tui）
│   ├── command.ts                # 命令 seam（全依赖注入，可单测）
│   └── ui/profile-selector.ts    # 内联 TUI 选择器组件
├── profiles/                     # 4 个手写示例档
│   └── gpt.json / kimi.json / claude.json / local.json
├── test/                         # node --test 直跑 .ts，含文件层与 fake Pi 宿主集成测试
└── plans/subagent-switch-plan.md # 完整实现契约
```

零运行时依赖；业务全在 `src/`，`extensions/index.ts` 只做适配。

---

## 7. 验证计划

- **自动化门禁**：Node 24+ 下运行 `npm run typecheck`（`tsc --noEmit`, strict + noUncheckedIndexedAccess，0 error）+ `npm test`（`node --test "test/*.test.ts"`，全 pass、无 skip）。
- **文件层端到端（副本，不碰真实 settings）**：临时目录里放仿真的 `settings.json`，切 `kimi` 再切回 `gpt`，断言：① 备份逐字节等于切换前且权限为 `0o600`；② 其它顶层键的 JSON 值零丢失零改写；③ `subagents` 与目标档 deepEqual（整块替换、多余 agent 消失）；④ 同档二次调用不写盘；⑤ settings mode 保留；⑥ 指纹冲突时中止。
- **宿主集成**：fake Pi/ctx 实际执行注册的 handler、补全、session_start 与 custom factory，验证 `overlay:false`、hasUI 接线和状态文本；不能用文件层测试代替。
- **真机手动（交付前必须，由用户执行）**：备份真实 settings → 建 `~/.pi/agent/subagent-profiles/` 放档 → `pi install <本地路径>` → 会话内验证 list / Tab / 直切 / 内联选择器 / 新 subagent 生效 / 切回 gpt。用 `jq -S` 后 diff 验证 JSON 值；切回 gpt 不要求全文原始字节一致。
- **原型验收**：桌面与窄屏打开 `docs/prototype.html`，验证命令、补全、选择器、内存备份、custom 和完整 settings 预览；不得加载外部资源或写真实文件。

> 未经你明确同意，不会自动执行 `pi install`（它会改你的 `settings.json` 的 `packages`）；真机步骤由你决定何时执行。

---

## 8. 边界与已知风险（精简）

| 风险 | 处理 |
| --- | --- |
| 项目级 `.pi/settings.json` 会逐字段覆盖 user 级 | 本插件只写 user 级，状态栏只反映 user 级；文档说明，不改项目级 |
| 0.85.0 已移除 `fallbackModels` / `launcher` | 校验器按 0.85.0 白名单重写，两个字段给专门错误文案 |
| 并发写 / 用户手改 settings | 写前重读 + sha256 指纹比对，不一致即中止；这是尽力检测，比对到 rename 仍有竞争窗口，不承诺跨进程串行化 |
| 备份文件增长 | 本期不自动清理；同档重复切不产生新备份（内容一致短路），不同档同秒切换可能被备份 `wx` 冲突拦截 |
| settings 含敏感配置 | 备份固定 `0o600`；临时文件缺省 `0o600`，已有 settings 时保留原 mode |
| 非 TUI 模式无自定义组件 | 选择器降级为警告并提示 `<name>` 直切 |
| 切换不立即影响运行中的 subagent | README + 成功提示里写明「下一次启动 subagent 生效，无需 `/reload`」 |
| 示例档绝对路径换机器失效 | 保持与本机现状一致，README 注明跨机需手改 |
| Pi 升级导致 host 类型漂移 | 类型 shim 固定标注「对齐 Pi 1.5.0 + types.d.ts 行号」，升级时逐项复核 |

---

## 9. 明确不做

- ✗ 不改父会话模型 / `defaultProvider` / `defaultThinkingLevel` 等**非** `subagents` 的键
- ✗ 不写项目级配置、不写档文件、不建状态文件、不自动清理备份
- ✗ 不修改或依赖 `pi-subagent-cfg`，不使用 `agentOverridesByProvider`
- ✗ 不调用 `ctx.reload()`，不引入任何运行时 npm 依赖
- ✗ 不承诺保留 settings 全文原始字节，不在原型中访问真实用户文件

---

## 10. 请你拍板

审核时最值得回一句的点：

1. **档文件格式**：是否接受「档文件 = `subagents` 原文，无包装」？还是想要 `{ "name": ..., "description": ..., "subagents": {...} }` 这种带元数据的？
2. **命令名**：`/subprofile` 行不行？
3. **档目录优先级**：用户级 `~/.pi/agent/subagent-profiles/` 优先于包内示例，认可吗？
4. **4 个示例档的模型分配**（尤其 `local` 全量 `thinking: off`）合不合用？要不要加 `gemini` 档？
5. **写盘安全**：每次实际内容变化都留一份带时间戳的备份，是否需要？是否要改为「只在首次备份」或「不备份」？
6. **状态栏文案**：`subagents: kimi` / `custom` / `无档`，还是想要别的格式？
7. **原型效果**：`prototype.html` 里的内联选择器、双栏配置预览、状态栏和命令反馈是否符合预期？
8. **`tcuni/gpt-6-luna` 未启用**：`gpt` 档（= 现状）的 `researcher` / `scout` 引用了不在 `enabledModels` 里的模型。保持原样？还是换模型 / 补进 `enabledModels`？

审核通过后，按 `plans/subagent-switch-plan.md` 契约恢复实现（T1–T17）；typecheck、单测、文件层端到端、fake Pi 宿主集成和原型验收必须全绿，真机验证完成后才交付。

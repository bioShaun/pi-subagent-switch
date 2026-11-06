# pi-subagent-switch — 方案契约（architect）

> 目标目录：`/home/tcuni-claw/pi/pi-subagent-switch`（已包含包清单、TypeScript 配置与 `docs/prototype.html`）。
> 本文档是实现契约。engineer 按 §5 顺序执行，验收以 §6 为准。所有 `file:line` 引用均已由 architect 实读复核。

---

## 1. 目标与边界（Scope & Non-Goals）

### 1.1 目标

一个**独立的新 Pi 扩展** `pi-subagent-switch`，提供「一键切换 subagent 配置档」：

1. **档 = `subagents` 整块替换**：切换即把 user 级 `~/.pi/agent/settings.json` 的顶层 `subagents` 键整体替换为档文件内容；其它顶层键（`theme`、`packages`、`compaction`、`enabledModels` …）的 **JSON 值保持不变**。实现采用解析后重写整个 JSON 文档，允许空白、缩进与转义形式被规范化，不承诺保留原始字节。
2. **两个入口**：`/subprofile <name>` 直切；`/subprofile`（无参）打开键盘优先 TUI 选择器；`/subprofile list` 列出档；`getArgumentCompletions` 提供档名 Tab 补全。
3. **持久显示当前档**：status line 常显 `subagents: <name>`（未命中为 `custom`）；状态只反映 user 级 settings，不代表项目级覆盖后的最终有效值。
4. **档文件纯手写、插件只读不写**：用户在 `~/.pi/agent/subagent-profiles/*.json` 手写；插件仅读。包内 `profiles/` 提供 4 个示例档（gpt / kimi / claude / local）。
5. **零运行时依赖**、`node --test` 直跑 `.ts`、`tsc --noEmit` 严格类型；运行与测试统一要求 Node 24+。
6. **可交互原型**：`docs/prototype.html` 作为零依赖、离线可打开的行为与视觉基准；只使用内存数据，不读写真实文件，覆盖直切、list、Tab 补全、内联选择器、备份记录、custom 状态与响应式布局。

### 1.2 非目标（明确不做）

- ✗ 不修改、不依赖 `pi-subagent-cfg`（`/submodel`）；不 import 它的任何文件。
- ✗ 不使用 pi-subagents 的 `agentOverridesByProvider`（不写、不解析出特殊语义，只按 schema 白名单校验通过）。
- ✗ 不在档文件里加 `description` / 外层包装（`{"name":..., "subagents":...}`）等元数据；档文件正文**就是** `subagents` 对象本身。
- ✗ 不写项目级 `.pi/settings.json`，只写 user 级。
- ✗ 不新建任何状态文件（「当前档」由内容比对推导）。
- ✗ 不调用 `ctx.reload()`（pi-subagents 用 `size:mtimeMs` 指纹惰性失效，见 `pi-subagents/src/agents/agents.js:2338-2368`、`:2498-2517`）。
- ✗ 不自动清理历史 `settings.json.bak-*`（备份只增不减，见 §7 R8）。
- ✗ 不改 `defaultModel` / `defaultProvider` / `defaultThinkingLevel` 等**非** `subagents` 的 settings 键（哪怕档里有 `defaultModel`，它属于 `subagents.defaultModel`）。

### 1.3 已确认的环境事实（只引用，不重复调研）

| 事实 | 出处 |
| --- | --- |
| `registerCommand(name, {description, handler, getArgumentCompletions})` | `pi-coding-agent/dist/core/extensions/types.d.ts:1254` |
| `handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>`，args 是**原始字符串** | `types.d.ts:1194-1200` |
| `getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] \| null \| Promise<...>`；`AutocompleteItem = {value, label, description?}` | `types.d.ts:1198`；`pi-tui/dist/autocomplete.d.ts:1-5` |
| `ExtensionContext`：`ui/mode/hasUI/cwd/sessionManager/modelRegistry/...` | `types.d.ts:232-272` |
| `ExtensionCommandContext` 额外含 `waitForIdle()`、`reload()` | `types.d.ts:305-342` |
| `ctx.ui.setStatus(key, text \| undefined)` | `types.d.ts:95` |
| `ctx.ui.custom<T>(factory, {overlay?})`；factory `(tui, theme, keybindings, done:(r:T)=>void) => Component` | `types.d.ts:132-150` |
| `Component`：必填 `render(width): string[]`、`invalidate()`；可选 `handleInput?(data)` | `pi-tui/dist/tui.d.ts:68-78` |
| `pi.on("session_start", handler)` | `types.d.ts:1212`；事件体 `SessionStartEvent { type; reason: "startup"\|"reload"\|"new"\|"resume"\|"fork" }` `types.d.ts:593-600` |
| `pi.on("session_tree"/"agent_settled"/"session_compact"/...)` 均可用于刷新 | `types.d.ts:1221-1238` |
| `getSettingsPath()` **未**从包入口导出（只有 `CONFIG_DIR_NAME/getAgentDir/...`） | `dist/index.d.ts:2` |
| `Theme.fg(color: ThemeColor, text): string`、`bold(text): string` | `dist/modes/interactive/theme/theme.d.ts:69-72` |
| `subagents` 顶层字段解析 | `pi-subagents/src/agents/agents.js:946+`（`readSubagentSettings`） |
| 单条 override 解析 + 字段白名单 | `agents.js:761-945`；`BUILTIN_OVERRIDE_FIELDS` `agents.js:41-47` |
| 未知字段即抛错 | `agents.js:772-777` |
| `fallbackModels` / `launcher` 出现即抛错 | `agents.js:766-771` |
| `modelScope` 结构（`allow/enforce/strict/agents`，禁止嵌套 `agents.<n>.agents`） | `pi-subagents/src/runs/shared/model-scope.js:142-167` |
| `THINKING_LEVELS = off,minimal,low,medium,high,xhigh,max` | `pi-subagents/src/shared/model-info.js:1` |
| `tools` 允许 `string[] \| "inherit" \| false` | `agents.js:741-748` |
| 原子写蓝本 2 空格缩进 + 尾部换行 + 同目录 `.tmp` + `flag:"wx"` + 保留 mode + rename | `pi-subagent-cfg/src/submodel/settings-file.ts:175-202` |
| `FsLike` 假 fs 注入测试蓝本 | `pi-subagent-cfg/test/settings-file.test.ts:37-60` |
| setStatus 用法蓝本（含 `if (!ctx.hasUI) return`） | `pi-planner-only/index.ts:31`、`:341-345` |
| `pi.on("session_start", …)` 刷新 UI 蓝本 | `pi-planner-only/index.ts:637-651` |
| `ctx.ui.custom` 接线蓝本 | `pi-subagent-cfg/extensions/index.ts:48-57` |
| 声明式 host 类型 shim（无需安装 pi 即可 typecheck） | `pi-subagent-cfg/src/pi-types.d.ts:1-67` |
| 包清单 `"pi": {"extensions": ["./extensions/index.ts"]}` | `pi-subagent-cfg/package.json:18-22` |

---

## 2. 文件树（每个文件一句话职责）

```
/home/tcuni-claw/pi/pi-subagent-switch/
├── package.json                     # name/type:module/pi.extensions/scripts/devDeps，零运行时依赖
├── tsconfig.json                    # ES2023 + nodenext + allowImportingTsExtensions + strict + noUncheckedIndexedAccess
├── README.md                        # 用法 + 档文件格式 + 目录优先级 + 备份 + 生效时机
├── docs/
│   └── prototype.html               # 离线交互原型：视觉、命令、补全、内联选择器与状态反馈基准
├── extensions/
│   └── index.ts                     # 唯一 host 适配层：解析路径、注入 deps、注册 /subprofile、注册 session_start 刷新状态
├── src/
│   ├── pi-types.d.ts                # 手写 host 类型 shim（pin Pi 1.5.0 子集），使 typecheck 不依赖 pi 安装
│   ├── fs.ts                        # FsLike 接口（可注入假 fs）+ 权限/时间戳小工具
│   ├── stable-json.ts               # stableStringify：键排序序列化，用于档内容比较
│   ├── schema.ts                    # subagents schema 校验器（0.85.0 白名单 + 类型），错误带档名与字段路径
│   ├── profiles.ts                  # 档目录解析 + 读档 + 校验 + 摘要 + 按名查找
│   ├── settings-store.ts            # settings.json 读/深拷贝替换/并发指纹校验/备份/原子写
│   ├── current-profile.ts           # 当前档检测（内容深比较 → 档名或 custom），永不抛错
│   ├── apply-profile.ts             # applyProfile 编排：查找→校验→读→替换→备份→写→返回结果
│   ├── status.ts                    # 状态栏 key + 文本 + refreshStatus（纯函数 + 安全包装）
│   ├── keys.ts                      # 原始终端输入 → key id（up/down/enter/escape/ctrl+c/其他）
│   ├── command.ts                   # 命令 seam：参数解析、list/help、切换、打开选择器（全部依赖注入，可单测）
│   └── ui/
│       └── profile-selector.ts      # TUI 选择器组件（render/handleInput/invalidate）
├── profiles/
│   ├── gpt.json                     # = 当前 `~/.pi/agent/settings.json` 的 subagents 值（切回即恢复该值）
│   ├── kimi.json                    # 全 kimi-coding 模型档
│   ├── claude.json                  # 全 tcuni-claude 模型档
│   └── local.json                   # 全 qwen-local/qwen3.8-27b 档
└── test/
    ├── stable-json.test.ts
    ├── schema.test.ts
    ├── profiles.test.ts
    ├── settings-store.test.ts
    ├── current-profile.test.ts
    ├── apply-profile.test.ts
    ├── status.test.ts
    ├── keys.test.ts
    ├── profile-selector.test.ts
    ├── command.test.ts
    ├── extension.test.ts            # fake Pi/ctx：注册、命令、补全、状态刷新与内联选择器接线
    ├── shipped-profiles.test.ts     # 校验 4 个随包档通过校验器；gpt.json 有 8 个 override
    ├── e2e-switch.test.ts           # 真 fs + mkdtemp：整块替换 / 顶层值保留 / 备份存在 / 内容一致
    └── fixtures/
        └── settings.sample.json     # 仿真实 settings 的多顶层键样本（含 theme/packages/compaction/enabledModels）
```

用户级档目录（运行期，插件只读）：`~/.pi/agent/subagent-profiles/*.json`。

---

## 3. 模块接口签名（TypeScript 契约）

> 所有跨模块类型一律 `export`。`strict` + `noUncheckedIndexedAccess` 下必须能编译。

### 3.1 `src/pi-types.d.ts`

参照 `pi-subagent-cfg/src/pi-types.d.ts:1-67` 的做法，`declare module "@earendil-works/pi-coding-agent"`，只声明本插件用到的子集，并**不要**声明 `getSettingsPath`（强制走 §3.12 的 fallback）：

```ts
declare module "@earendil-works/pi-coding-agent" {
  export interface PiTheme { fg(color: string, text: string): string; bold(text: string): string; dim?(text: string): string }
  export interface PiComponentLike { render(width: number): string[]; invalidate(): void; handleInput?(data: string): void; dispose?(): void }
  export interface PiAutocompleteItem { value: string; label: string; description?: string }
  export interface PiUIContext {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
    readonly theme: PiTheme;
    custom<T>(factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (r: T) => void) => PiComponentLike | Promise<PiComponentLike>,
              options?: { overlay?: boolean }): Promise<T | undefined>;
  }
  export type PiMode = "tui" | "rpc" | "json" | "print";
  export interface PiContext { ui: PiUIContext; mode: PiMode; hasUI: boolean; cwd: string }
  export interface PiCommandContext extends PiContext {}
  export interface PiSessionStartEvent { type: "session_start"; reason: "startup" | "reload" | "new" | "resume" | "fork" }
  export interface PiAPI {
    on(event: "session_start", handler: (e: PiSessionStartEvent, ctx: PiContext) => Promise<void> | void): () => void;
    registerCommand(name: string, options: {
      description?: string;
      getArgumentCompletions?: (prefix: string) => PiAutocompleteItem[] | null | Promise<PiAutocompleteItem[] | null>;
      handler: (args: string, ctx: PiCommandContext) => Promise<void>;
    }): void;
  }
  export const CONFIG_DIR_NAME: string;
  export function getAgentDir(): string;
}
```

### 3.2 `src/fs.ts`

```ts
export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string): Buffer;
  writeFileSync(path: string, data: string | Buffer, options?: { flag?: string; mode?: number }): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  statSync(path: string): { mode: number };
  readdirSync(path: string): string[];
}

/** "YYYYMMDD-HHmmss"（本地时区）。 */
export function formatStamp(date: Date): string;
/** sha256 十六进制。 */
export function sha256(data: Buffer | string): string;
```

`node:fs` 模块对象可结构化赋给 `FsLike`（`statSync` 返回的 `Stats.mode` 满足 `{mode: number}`；`readdirSync(path)` 的 `string[]` 重载满足签名）。

### 3.3 `src/stable-json.ts`

```ts
/** 键递归排序后 JSON 序列化；对象中值为 undefined 的键被丢弃；数组顺序保持不变。 */
export function stableStringify(value: unknown): string;
```

### 3.4 `src/schema.ts`

```ts
export const THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

export type ProfileErrorKind = "invalid-json" | "unreadable" | "invalid-schema" | "not-found" | "no-profiles";

export class ProfileError extends Error {
  readonly kind: ProfileErrorKind;
  readonly profile: string | undefined;   // 档名（不含 .json）
  readonly field: string | undefined;     // JSON 字段路径，如 "agentOverrides.worker.fallbackModels"
  constructor(kind: ProfileErrorKind, message: string, extra?: { profile?: string; field?: string });
}

export interface SubagentsSummary {
  defaultModel: string | undefined;   // 仅当 subagents.defaultModel 是字符串
  defaultProvider: string | undefined;
  overrideCount: number;              // agentOverrides 键数量
}

/**
 * 校验一个 `subagents` 值（不修改入参、不做 trim 归一化，保证写回内容与手写档逐字一致）。
 * 通过 → 返回摘要；失败 → 抛 ProfileError("invalid-schema")，message 形如
 *   `档 "kimi" 字段 agentOverrides.worker.fallbackModels: 该字段在 pi-subagents 0.85.0 已移除，请改用 agentOverrides.worker.model。`
 */
export function validateSubagents(value: unknown, profileName: string): SubagentsSummary;
```

**校验表（必须逐字实现，来源 `agents.js:41-47` / `:946+` / `:761-945`）**

顶层 `subagents` 允许键：

| 键 | 规则 |
| --- | --- |
| `defaultModel` / `defaultProvider` / `defaultThinking` | 非空字符串（trim 后非空） |
| `maxThinking` | `THINKING_LEVELS` 之一 |
| `defaultExtensions` / `defaultSubagentOnlyExtensions` / `agentScanDirs` / `agentExcludeDirs` | `string[]`，每项 trim 后非空 |
| `disableBuiltins` / `disableThinking` | `boolean` |
| `modelScope` | 普通对象：`allow?: string[]`（非空字符串）、`enforce?: boolean`、`strict?: boolean`、`agents?: Record<string, {allow?,enforce?,strict?}>`；`agents.<n>` 内出现 `agents` 键即报错（`model-scope.js:155-157`） |
| `agentOverrides` | 普通对象，值按下面「单条 override」校验 |
| `agentOverridesByProvider` | 普通对象 → `Record<provider, Record<agent, override>>`，逐层按「单条 override」校验 |

单条 override 允许键：

| 键 | 规则 |
| --- | --- |
| `description` | 非空字符串 |
| `advertise` / `fast` / `inheritProjectContext` / `inheritGlobalContext` / `inheritSkills` / `disabled` / `allowNestedSubagents` | `boolean` |
| `machine` | `false` 或 非空字符串且长度 ≤ 128 且无控制字符（`/[\u0000-\u001f\u007f]/`，见 `agents.js:749-759`） |
| `output` | 非空字符串 或 `false` |
| `outputMode` | `"inline" \| "file-only"` |
| `model` | 任意字符串（含 `"inherit"`）或 `false` |
| `defaultProvider` | 非空字符串 或 `false` |
| `thinking` | `THINKING_LEVELS` 之一 或 `false` |
| `systemPromptMode` | `"append" \| "replace"` |
| `defaultContext` | `"fresh" \| "fork" \| false` |
| `acceptanceRole` | `"read-only" \| "writer" \| false` |
| `toolBudget` | 普通对象 或 `false` |
| `systemPrompt` | 任意字符串（可为空） |
| `defaultReads` / `skills` / `excludeTools` / `allowedAgents` / `extensions` / `subagentOnlyExtensions` / `mutationTools` | `string[]`（每项非空）或 `false` |
| `tools` | `string[]`（每项非空）或 `"inherit"` 或 `false` |

**必须显式拦下的键**（即使它们在白名单外也要给出可读错误，不要只靠「未知字段」兜底）：

- `fallbackModels` → `该字段在 pi-subagents 0.85.0 已移除（agents.js:766-768），请只配置一个 model`
- `launcher` → `该字段不能出现在 settings override 中（agents.js:769-771），请在用户级 agent 文件中设置`

其它未知键 → `未知字段 "xxx"`，可选附 `是否想写 "yyy"`（编辑距离 ≤ 2 的最近字段名；**此项可选，未实现不扣分**）。

顶层未知键同样报错（比 pi-subagents 严格；后者静默忽略，见 `agents.js:946+` 只读已知键）。计划接受这一更严格的行为，用于抓拼写错误。

### 3.5 `src/profiles.ts`

```ts
export interface SubagentsValue { [key: string]: unknown }

export interface Profile {
  readonly name: string;             // 文件名主干，如 "kimi"
  readonly path: string;             // 档文件绝对路径
  readonly value: SubagentsValue;    // 已通过校验的原始值（不归一化）
  readonly summary: SubagentsSummary;
  readonly source: "user" | "package";
}

export interface ProfileRoot { readonly dir: string; readonly source: "user" | "package" }

export interface ProfileSet {
  readonly profiles: Profile[];        // 按 name 升序
  readonly errors: ProfileError[];      // 解析/校验失败的档（不影响其它档可用）
  readonly dirs: readonly ProfileRoot[]; // 参与查找的候选目录（按优先级）
  readonly usedDir: ProfileRoot | undefined; // 实际生效的目录
}

export interface LoadDeps { fs: FsLike; roots: readonly ProfileRoot[] }

/**
 * 候选目录，按优先级返回：
 *  1) env.PI_SUBAGENT_PROFILES_DIR（trim 非空）→ 仅该目录，**不回退**；
 *  2) 否则 [user: join(agentDir,"subagent-profiles"), package: join(packageRoot,"profiles")]。
 */
export function resolveProfileDirs(opts: {
  agentDir: string;
  packageRoot: string;
  env: Record<string, string | undefined>;
}): ProfileRoot[];

/**
 * 依次尝试 roots，取**第一个**含至少一个成功加载的 *.json 的目录作为 usedDir（该目录内所有 *.json 都加载，
 * 失败的进 errors）；全部失败 → profiles=[], usedDir=undefined（不抛错）。
 */
export function loadProfiles(deps: LoadDeps): ProfileSet;

/**
 * 名字大小写敏感；允许省略 ".json"。先查有效档；若同名档在 set.errors 中，抛出原始
 * invalid-json / invalid-schema / unreadable 错误；完全不存在才抛 ProfileError("not-found")，
 * message 列出可用档名。不得把“存在但损坏”的档误报成 not-found。
 */
export function findProfile(set: ProfileSet, name: string): Profile;
```

规则细节：

- 只认 `*.json`（大小写不敏感匹配 `.json`），跳过以 `.` 开头的文件名（如 `.settings.json.tmp`）。
- 目录不存在 / `readdirSync` 抛错 → 该 root 视为「无档」，继续下一个候选。
- 单档：`readFileSync` 失败 → `ProfileError("unreadable", '档 "x": 无法读取 <path>: <err>')`；`JSON.parse` 失败 → `ProfileError("invalid-json", '档 "x": <path> 不是合法 JSON: <err>')`；`validateSubagents` 抛错 → 原样进 `errors`。
- **插件绝不写档文件**：`profiles.ts` 内不得出现任何 `writeFileSync` / `renameSync` / `unlinkSync` 调用。

### 3.6 `src/settings-store.ts`

```ts
export const ABSENT_FINGERPRINT = "absent";

export class SettingsStoreError extends Error {}

export interface SettingsSnapshot {
  readonly doc: Record<string, unknown>;  // 完整顶层文档（缺文件时为 {}）
  readonly existed: boolean;
  readonly fingerprint: string;           // sha256(raw) 或 ABSENT_FINGERPRINT
  readonly raw: Buffer | undefined;       // 原始字节，用于生成逐字节一致的备份
  readonly mode: number | undefined;      // 原有权限位（& 0o777）
}

/** 读取并解析；非法 JSON / 非对象根 → 抛 SettingsStoreError。缺文件 → existed:false, doc:{}。 */
export function readSettings(fs: FsLike, path: string): SettingsSnapshot;

/** structuredClone(doc) 后仅替换顶层 subagents 键（整块替换，不是合并）；不修改入参。 */
export function withSubagents(doc: Record<string, unknown>, subagents: SubagentsValue): Record<string, unknown>;

export interface WriteResult { readonly fingerprint: string; readonly backupPath: string | undefined }

/**
 * 备份 + 原子写。顺序固定：
 *  1) 重新读取磁盘（write 时刻的真相）；snapshot.existed 但文件消失 → 抛错；
 *  2) 指纹与 snapshot.fingerprint 不同 → 抛 SettingsStoreError（尽力检测并发修改；比对与 rename 之间仍有竞争窗口，不承诺跨进程串行化）；
 *  3) 若 existed：写 `<path>.bak-<stamp>`（flag:"wx"，mode 固定 0o600，内容 = 步骤 1 的原始字节）；
 *     目标已存在 → 抛错（同一秒内重复切换）；
 *  4) 写同目录临时文件（`.<basename>.<pid>.<rand>.tmp`，flag:"wx"，mode 保留原 mode 默认 0o600）→ renameSync 覆盖；
 *     失败清理临时文件后重抛；
 *  5) 返回新内容指纹与备份路径。
 */
export function writeSettings(
  fs: FsLike,
  path: string,
  doc: Record<string, unknown>,
  opts: { snapshot: SettingsSnapshot; stamp: string },
): WriteResult;

/** `${path}.bak-${stamp}` */
export function backupPathFor(path: string, stamp: string): string;
```

序列化格式：`JSON.stringify(doc, null, 2) + "\n"`（与 `settings-file.ts:181` 一致）。

### 3.7 `src/current-profile.ts`

```ts
export interface CurrentProfile {
  readonly name: string;            // 命中的档名，或 "custom"
  readonly matched: boolean;
  readonly detail: string | undefined; // 命中：档文件路径；未命中：settings 的 defaultModel 或错误摘要
}

/**
 * 用 stableStringify(settings.subagents) 与每个档的 stableStringify(profile.value) 比较。
 * 命中多个（内容重复的档）→ 取 name 字典序最小者，detail 里注明重复档名。
 * settings 缺失/不可读/无 subagents 键 → { name: "custom", matched: false }。
 * **本函数永不抛错**（内部 catch，错误文本进 detail）。
 */
export function detectCurrentProfile(opts: { fs: FsLike; settingsPath: string; set: ProfileSet }): CurrentProfile;
```

### 3.8 `src/apply-profile.ts`

```ts
export interface ApplyDeps { fs: FsLike; settingsPath: string; set: ProfileSet; now?: () => Date }

export interface ApplyResult {
  readonly name: string;
  readonly changed: boolean;          // false = settings 已是该档内容，未写盘、未备份
  readonly overrideCount: number;
  readonly defaultModel: string | undefined;
  readonly backupPath: string | undefined;
}

/** 抛 ProfileError（找不到档 / 校验失败）或 SettingsStoreError（读写失败、并发冲突）。 */
export function applyProfile(deps: ApplyDeps, name: string): ApplyResult;
```

算法见 §4.2。

### 3.9 `src/status.ts`

```ts
export const STATUS_KEY = "pi-subagent-switch";

export interface StatusUI { readonly hasUI: boolean; setStatus(key: string, text: string | undefined): void }

/** 纯函数：`subagents: kimi` / `subagents: custom` / `subagents: 无档`（set.profiles 为空时）。 */
export function statusLabel(current: CurrentProfile, set: ProfileSet): string;

/**
 * 每次从 roots 重新加载档，再检测当前档并写状态栏，避免手改档文件后使用过期 ProfileSet。
 * hasUI=false 时直接返回（不调 setStatus，参考 pi-planner-only/index.ts:342）。
 * 检测异常 → 尝试写 `subagents: ?`；setStatus 自身异常也只吞掉并返回 undefined，绝不抛出。
 */
export function refreshStatus(
  deps: { fs: FsLike; settingsPath: string; roots: readonly ProfileRoot[] },
  ui: StatusUI,
): CurrentProfile | undefined;
```

### 3.10 `src/keys.ts`

```ts
export type KeyId =
  | "up" | "down" | "enter" | "escape" | "ctrl+c" | "home" | "end" | "pageup" | "pagedown"
  | { char: string };

/** 使用 Pi 宿主的 pi-tui parseKey，归一化为本选择器 KeyId；支持 legacy、Kitty 与 CSI-u。 */
export function parseKey(data: string): KeyId | undefined;
```

> 真机验收发现手写解析无法覆盖 Pi 1.5 的 Kitty/CSI-u 输入，导致方向键与取消失效。因此复用 `pi-subagent-cfg/src/submodel/keys.ts:15` 的宿主解析路线：`@earendil-works/pi-tui` 是可选 peer（与 Pi 同大版本），开发环境固定 1.5.0 用于真实解析回归；运行时 `dependencies` 仍为空。

### 3.11 `src/ui/profile-selector.ts`

```ts
export interface SelectorTheme { fg(color: string, text: string): string; bold(text: string): string }

export interface ProfileSelectorDeps {
  readonly profiles: readonly Profile[];
  readonly current: CurrentProfile;
  readonly theme: SelectorTheme;
  readonly onDone: (result: string | undefined) => void;  // 选中档名；取消 undefined
}

export interface ProfileSelectorComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  readonly cursor: number;   // 供测试断言
}

export function createProfileSelector(deps: ProfileSelectorDeps): ProfileSelectorComponent;
```

行为契约：

- 初始 `cursor` = 当前档在列表中的索引（`current.matched` 时），否则 0。
- `up`/`k`：cursor-1（到顶回绕到底部）；`down`/`j`：cursor+1（到底回绕到顶部）。
- `enter`：`onDone(profiles[cursor].name)`。
- `escape` / `ctrl+c`：`onDone(undefined)`。
- 其它键忽略。`invalidate()` 为空实现（无缓存）。
- `render(width)`：
  - 每档一行，**先拼纯文本 → 按 `width` 截断 → 再套 ANSI**（避免截断破坏颜色码）：
    `▶ kimi        kimi-coding/k3.1-pro   8 overrides  ●`（前三列对齐：名字 padEnd(12)、`defaultModel ?? "—"` padEnd(22)、`<n> overrides`）
  - 当前档行尾 `●`，且整行用 `theme.bold` 包裹；非当前行不套色（可选 `theme.fg("dim", …)`）。
  - 末行为提示：`↑/↓ 选择 · Enter 应用 · Esc 取消`（用 `theme.fg("dim", …)`）。
  - `profiles` 为空时渲染 `未找到档文件：请创建 ~/.pi/agent/subagent-profiles/*.json`。

### 3.12 `src/command.ts`

```ts
export type NotifyLevel = "info" | "warning" | "error";

export interface CommandDeps {
  readonly fs: FsLike;
  readonly settingsPath: string;
  readonly roots: readonly ProfileRoot[];
  /** 打开内联 TUI 选择器；返回选中档名或 undefined（取消）。非 TUI 模式由 adapter 直接返回 undefined。 */
  readonly openSelector: (state: SelectorState) => Promise<string | undefined>;
  readonly notify: (message: string, level: NotifyLevel) => void;
  /** 每次命令结束后回调（adapter 里接 refreshStatus），包括 list、帮助、取消与失败。 */
  readonly onAfterCommand: () => void;
}

export interface SelectorState {
  readonly profiles: readonly Profile[];
  readonly current: CurrentProfile;
  readonly errors: readonly ProfileError[];
}

export const USAGE = "用法：/subprofile [name|list]\n  /subprofile          → 打开选择器\n  /subprofile kimi     → 直接切换到 kimi 档\n  /subprofile list     → 列出所有档与当前档";

export async function runSubprofile(args: string, deps: CommandDeps): Promise<void>;

/** 供 getArgumentCompletions：返回 {value,label,description} 列表（按 prefix 过滤，list 放最后）。 */
export function completeProfiles(prefix: string, deps: { fs: FsLike; roots: readonly ProfileRoot[] }):
  { value: string; label: string; description?: string }[];
```

分支契约：

| 输入（先 `trim`） | 行为 |
| --- | --- |
| `""` | `set = loadProfiles`；`set.profiles` 为空 → `notify(USAGE + 目录提示, "warning")`；否则先逐条 warning 展示 `errors`，再 `current = detectCurrentProfile` → `openSelector({profiles, current, errors})` → 返回名字则走切换，`undefined` 则静默 return |
| `"list"` / `"ls"` | 逐条 `notify`：先 `notify(\`档目录：${usedDir?.dir ?? "（未找到）"} (${usedDir?.source})\`, "info")`，再每档一行 `● kimi — kimi-coding/k3.1-pro (8 overrides)`（当前档前缀 `●`，其它前缀两个空格）；`errors` 每条 `notify(err.message, "warning")` |
| `"help"` / `"-h"` / `"--help"` | `notify(USAGE, "info")` |
| `"<name>"`（无空格） | `applyProfile` → `changed===false` 时提示 `已是当前档；内容一致，未写入、未备份`；否则提示 `已切换到档 "${name}"（备份 ${basename(backup)}）；下一次启动 subagent 生效，无需 /reload` |
| `<name> <extra...>` | `notify(\`参数过多：${USAGE}\`, "warning")` |
| 抛 `ProfileError` / `SettingsStoreError` | `notify(error.message, "error")`，不重抛 |
| 其它未知异常 | `notify(\`/subprofile 失败：${msg}\`, "error")` |

`runSubprofile` **永不抛出**（全部 catch），并在 `finally` 中调用一次 `deps.onAfterCommand()`；回调自身异常也吞掉。host 侧再包一层 try/catch 只是双保险。

### 3.13 `extensions/index.ts`

```ts
import type { PiAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: PiAPI): void;
```

职责（只有适配，无业务逻辑）：

1. `resolveSettingsPath()`：`typeof (mod as any).getSettingsPath === "function" ? getSettingsPath() : join(getAgentDir(), "settings.json")`（蓝本 `pi-subagent-cfg/extensions/index.ts:21-24`，因 `dist/index.d.ts:2` 未导出）。
2. `packageRoot = fileURLToPath(new URL("..", import.meta.url))`（`extensions/index.ts` 深一层）。
3. `roots = resolveProfileDirs({ agentDir: getAgentDir(), packageRoot, env: process.env })`；`statusDeps = {fs: nodeFs, settingsPath, roots}`。
4. `pi.registerCommand("subprofile", { description: "Switch the whole pi-subagents `subagents` block from a profile file", getArgumentCompletions: (prefix) => completeProfiles(prefix, {fs: nodeFs, roots}), handler: async (args, ctx) => runSubprofile(args, makeDeps(ctx)) })`。
5. `makeDeps(ctx)`：
   - `notify: (m, l) => ctx.ui.notify(m, l)`
   - `openSelector: async (state) => { if (ctx.mode !== "tui") { ctx.ui.notify("/subprofile 选择器需要交互式 TUI；请用 /subprofile <name> 直切。", "warning"); return undefined; } const picked = await ctx.ui.custom<string | undefined>((_tui, theme, _kb, done) => { const comp = createProfileSelector({ profiles: state.profiles, current: state.current, theme: themeAdapter(theme), onDone: done }); return comp; }, { overlay: false }); return picked ?? undefined; }`（蓝本 `pi-subagent-cfg/extensions/index.ts:48-55`；原型也用会话内联面板而非浮层）
   - `onAfterCommand: () => refreshStatus(statusDeps, { hasUI: ctx.hasUI, setStatus: (key, text) => ctx.ui.setStatus(key, text) })`
6. 状态刷新注册：

```ts
pi.on("session_start", async (_event, ctx) => {
  refreshStatus(statusDeps, { hasUI: ctx.hasUI, setStatus: (key, text) => ctx.ui.setStatus(key, text) });
});
```

`SessionStartEvent.reason` 覆盖 `startup|reload|new|resume|fork`（`types.d.ts:593-600`），足以覆盖启动、切换会话、fork、`/reload` 四类时机；再叠加「每次 `/subprofile` 命令结束后刷新」。**结论：无需 `turn_start` 之类高频事件**；外部手改 settings 或档文件会在下一次 session 事件或任意 `/subprofile` 命令后纠正。

7. 顶层 `try/catch`：一旦 deps 构造失败（如 `getAgentDir()` 抛错），`ctx` 尚不可用 → 直接 `return`，不注册命令（不要让扩展加载崩溃）。

---

## 4. 关键数据流与算法

### 4.1 档解析（`loadProfiles`）

```
roots = resolveProfileDirs(...)              // env 覆盖 → 单候选；否则 [user, package]
for root in roots:
    if !fs.existsSync(root.dir) → continue
    names = fs.readdirSync(root.dir).filter(f => /\.json$/i.test(f) && !f.startsWith("."))
    if names.length === 0 → continue
    loaded = []
    for f in names:
        try  raw = fs.readFileSync(join(root.dir, f))
             val = JSON.parse(raw)
             sum = validateSubagents(val, stem(f))
             loaded.push({ name: stem(f), path, value: val, summary: sum, source: root.source })
        catch e → errors.push(asProfileError(e, stem(f), path))
    if loaded.length > 0 → return { profiles: sortByName(loaded), errors, dirs: roots, usedDir: root }
return { profiles: [], errors, dirs: roots, usedDir: undefined }
```

`stem(f)` = 去掉末尾 `.json` 的文件名主干（**档名以文件名为主**，不接受档文件里的自定义 name 字段——见 §1.2）。

### 4.2 切换（`applyProfile`）

```
profile = findProfile(set, name)                  // 找不到 → ProfileError("not-found")
summary = validateSubagents(profile.value, name)  // 双保险：档可能在 load 后被手改（同一进程内一般不会）
snapshot = readSettings(fs, settingsPath)         // 非法 JSON → SettingsStoreError
currentSub = snapshot.doc["subagents"]
if currentSub !== undefined && stableStringify(currentSub) === stableStringify(profile.value)
    → return { name, changed: false, overrideCount: summary.overrideCount, defaultModel: summary.defaultModel, backupPath: undefined }
next = withSubagents(snapshot.doc, profile.value) // structuredClone + 顶层 subagents 整块赋新值
{ fingerprint, backupPath } = writeSettings(fs, settingsPath, next, { snapshot, stamp: formatStamp(now()) })
return { name, changed: true, overrideCount, defaultModel, backupPath }
```

关键不变量：

- `next` 与 `snapshot.doc` 的**其它顶层键必须逐值相等**（深比较，`test/apply-profile.test.ts` 断言）。
- 写盘是「先备份、后原子替换」；任一步失败，磁盘上的 settings.json 必须保持原样（临时文件清理，备份可能残留——可接受）。
- **`changed === false` 时不写盘、不备份**：避免连续切同一档刷出大量 `.bak`。

### 4.3 当前档检测

`stableStringify(settings.subagents)` 与每个档 `stableStringify(profile.value)` 比对（键序无关、数组有序、忽略 `undefined` 键）。语义：

- 命中唯一档 → `{ name: "kimi", matched: true, detail: "<档文件路径>" }`
- 命中多个（两个档文件内容相同）→ 取字典序最小，`detail` 注明重复档名
- 无 `subagents` 键 / settings 不可读 / 无命中 → `{ name: "custom", matched: false, detail: <settings.subagents.defaultModel 或错误摘要> }`

### 4.4 状态刷新

`refreshStatus` → `loadProfiles(roots)` → `detectCurrentProfile` → `statusLabel` → `ctx.ui.setStatus("pi-subagent-switch", "subagents: kimi")`。触发点：`session_start` 事件、每次 `/subprofile` 命令结束后（含 list、帮助、取消与失败）。`hasUI=false`（`json`/`print` 模式）直接返回。

### 4.5 错误分支总表

| 场景 | 抛出点 | 用户可见 |
| --- | --- | --- |
| 档目录都不存在 | `loadProfiles` 返回空集 | `/subprofile`：`notify(USAGE + "未找到档目录 …", "warning")`；状态栏 `subagents: 无档` |
| 档 JSON 语法错 | `ProfileError("invalid-json")` | `list` 中 `notify(msg,"warning")`；选中该档时 `notify(msg,"error")`，**不写盘** |
| 档 schema 非法（未知字段 / fallbackModels / 类型错） | `ProfileError("invalid-schema")` | 同上；message 含 `档名 + 字段路径` |
| 名字不存在 | `ProfileError("not-found")` | `notify('未找到档 "xxx"；可用：gpt, kimi, …', "error")` |
| settings.json JSON 损坏 | `SettingsStoreError` | `notify('settings.json 解析失败：… 已中止，未做任何写入', "error")` |
| 读后被外部修改（指纹不符） | `SettingsStoreError` | `notify('settings.json 在操作期间被修改，已中止；请重试', "error")` |
| 备份文件已存在（同秒重复） | `SettingsStoreError` | `notify('备份 … 已存在，请稍后重试', "error")` |
| rename/写临时文件失败 | 原样重抛 | `notify('/subprofile 失败：<err>', "error")`；settings.json 未被破坏 |
| 非 TUI 模式开选择器 | adapter | `notify('选择器需要 TUI；请用 /subprofile <name>', "warning")` |
| 状态刷新异常 | 内部 catch | 状态栏 `subagents: ?`，会话继续 |

### 4.6 生效时机（写进 README）

切换只改 settings 文件；pi-subagents 靠指纹惰性失效重读（`agents.js:2338-2368`、`:2498-2517`），因此**无需 `/reload`**，**下一次启动 subagent 时生效**；已在运行的 subagent 不受影响。

---

## 5. 分步实施清单（Step-by-Step Todo）

> 每步完成即跑该步的验证命令。`T14` 之前 `npm run typecheck` 应始终通过。

| # | 文件 | 内容要点 | 局部验证 |
| --- | --- | --- | --- |
| T1 | `package.json`、`tsconfig.json`、`src/pi-types.d.ts` | 清单见下；tsconfig 照 `pi-subagent-cfg/tsconfig.json:2-15`（`include: ["src/**/*.ts","extensions/**/*.ts","test/**/*.ts"]`） | `npm install --no-audit --no-fund && npx tsc --noEmit` |
| T2 | `src/fs.ts` | `FsLike`、`formatStamp`、`sha256` | `npx tsc --noEmit` |
| T3 | `src/stable-json.ts` + `test/stable-json.test.ts` | 键排序、数组保序、嵌套、`undefined` 键丢弃、不可序列化值（抛 TypeError 亦可） | `node --test test/stable-json.test.ts` |
| T4 | `src/schema.ts` + `test/schema.test.ts` | §3.4 全表；错误 message 含档名与字段路径；`fallbackModels`/`launcher` 专项用例；`tools:"inherit"`、`thinking:false`、`machine` 128 字符与控制字符、`modelScope.agents.<n>.agents` 拒绝 | `node --test test/schema.test.ts` |
| T5 | `src/profiles.ts` + `test/profiles.test.ts` | 候选目录优先级（env 覆盖不回退 / user 空目录回退 package / 两者都有时只用 user）、跳过 `.` 前缀、非法 JSON 与非法 schema 进 `errors` 且其它档仍可用、`findProfile` 允许省略 `.json`、同名损坏档抛原始错误而非 not-found、目录缺失不抛错 | `node --test test/profiles.test.ts` |
| T6 | `src/settings-store.ts` + `test/settings-store.test.ts` | 假 `FsLike`（照 `test/settings-file.test.ts:37-60`）：2 空格+尾换行、`flag:"wx"`、settings mode 保留、备份固定 0o600、rename 失败清理临时文件、指纹不一致中止、备份字节与原文件一致、备份 `wx` 冲突报错、缺文件时 `existed:false` 且不生成备份 | `node --test test/settings-store.test.ts` |
| T7 | `src/current-profile.ts` + `test/current-profile.test.ts` | 命中/未命中/无 `subagents` 键/损坏 JSON 不抛错/重复内容取字典序最小 | `node --test test/current-profile.test.ts` |
| T8 | `src/apply-profile.ts` + `test/apply-profile.test.ts` | §4.2；断言「其它顶层键深相等」「`subagents` 整块等于档内容」「同档二次调用 `changed:false` 且无新写入」「非法档不写盘」 | `node --test test/apply-profile.test.ts` |
| T9 | `src/status.ts` + `test/status.test.ts` | label 三分支、每次刷新重新 loadProfiles、`hasUI:false` 不调 `setStatus`、检测异常降级为 `subagents: ?`、setStatus 自身异常也不外抛 | `node --test test/status.test.ts` |
| T10 | `src/keys.ts` + `test/keys.test.ts` | 5 个键 + 回绕 + 无法识别 → `undefined` | `node --test test/keys.test.ts` |
| T11 | `src/ui/profile-selector.ts` + `test/profile-selector.test.ts` | 初始 cursor 落在当前档；`\x1b[B`/`j`/`\x1b[A`/回绕；Enter/Esc/Ctrl+C 的 `onDone` 值；`render(40)` 每行 `≤ 40` 可见字符；空档列表提示 | `node --test test/profile-selector.test.ts` |
| T12 | `src/command.ts` + `test/command.test.ts` | §3.12 全分支（用注入的 `fs/notify/openSelector/onAfterCommand` 捕获）：空参走选择器并报告 errors、`list` 输出含当前档标记、成功/失败/list/取消均恰好刷新一次、已知错误只 notify 不抛、多余参数警告 | `node --test test/command.test.ts` |
| T13 | `extensions/index.ts` + `test/extension.test.ts` | §3.13 六点；fake Pi/ctx 捕获注册命令与 session_start，执行真实 handler、补全和 custom factory，断言 `overlay:false`、hasUI 接线及状态文本 | `node --test test/extension.test.ts && npx tsc --noEmit` |
| T14 | `profiles/{gpt,kimi,claude,local}.json` + `test/shipped-profiles.test.ts` | 逐文件 `JSON.parse` + `validateSubagents` 通过；`gpt.json` 有 8 个 override 且 `defaultModel === "tcuni/gpt-6.1-terra"`；`local.json` 所有 model 均为 `qwen-local/qwen3.8-27b`；四个档 `SUBAGENT_ONLY_EXT`/`tools` 结构一致（用 `stableStringify` 比对除 model/thinking 外的字段） | `node --test test/shipped-profiles.test.ts` |
| T15 | `test/fixtures/settings.sample.json` + `test/e2e-switch.test.ts` | 真 `node:fs` + `mkdtempSync`：把 fixture 复制到临时目录，跑 `applyProfile` 两次（kimi 再 gpt），断言备份文件存在且等于切换前字节、顶层键（`theme/packages/compaction/enabledModels/defaultTools`）深相等、`subagents` 与档文件深相等 | `node --test test/e2e-switch.test.ts` |
| T16 | `README.md` | 用法、档文件格式（= `subagents` 原文）、目录优先级与 env、备份与生效时机（§4.6）、JSON 重写语义、4 个示例档说明 | 人工审阅 |
| T17 | `docs/prototype.html` | 与命令契约同步；覆盖完整 settings 预览、值保留、内存备份、Tab 补全、内联选择器、custom 状态、移动端布局；零外部资源、无真实文件写入 | 浏览器人工检查 + 脚本语法检查 |

**T1 的 `package.json` 契约**

```json
{
  "name": "pi-subagent-switch",
  "version": "0.1.0",
  "description": "Pi extension: switch the whole pi-subagents `subagents` block from hand-written profile files",
  "type": "module",
  "license": "MIT",
  "keywords": ["pi-package", "pi-subagents", "subagents", "profile", "tui"],
  "pi": { "extensions": ["./extensions/index.ts"] },
  "files": ["src", "extensions", "profiles", "README.md"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=1.5.0 <2",
    "@earendil-works/pi-tui": ">=1.5.0 <2"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true }
  },
  "scripts": { "test": "node --test \"test/*.test.ts\"", "typecheck": "tsc --noEmit" },
  "devDependencies": { "@earendil-works/pi-tui": "1.5.0", "@types/node": "^24.0.0", "typescript": "^5.9.0" },
  "engines": { "node": ">=24" }
}
```

零 `dependencies`；`pi-tui` 作为宿主可选 peer，并固定在 devDependencies 1.5.0 用于测试（§3.10）。

---

## 6. 验证标准

### 6.1 自动化门禁（必须全绿）

```bash
cd /home/tcuni-claw/pi/pi-subagent-switch
npm install --no-audit --no-fund
npm run typecheck          # tsc --noEmit，strict + noUncheckedIndexedAccess 下 0 error
npm test                   # node --test "test/*.test.ts"，全部 pass，无 skip
```

判定：`typecheck` 退出码 0 且无 `error TS`；`npm test` 输出 `# fail 0`（Node 24 的 TAP 汇总）。任何一条红都不得交付。

### 6.2 文件层端到端（副本，不碰真实 settings）——由 `test/e2e-switch.test.ts` 自动覆盖

断言清单（engineer 必须逐条实现）：

1. 临时目录 `tmp/settings.json` 由 `test/fixtures/settings.sample.json` 复制而来（含 `theme`、`packages`、`compaction`、`enabledModels`、`defaultTools`、`subagents`）。
2. 执行 `applyProfile({fs: nodeFs, settingsPath: tmp/settings.json, set}, "kimi")` → `changed: true`、`backupPath` 指向 `tmp/settings.json.bak-*`。
3. `fs.readFileSync(backupPath)` **逐字节等于**切换前的 settings 内容。
4. 新 settings 的 `subagents` 与 `profiles/kimi.json` `deepStrictEqual`（**整块替换**，不是合并：原 `agentOverrides` 里 kimi 没有的 agent 必须消失）。
5. 用 `delete doc.subagents` 后与切换前同样处理比较：`deepStrictEqual`（**其它顶层键的 JSON 值零丢失、零改写**；不要求全文原始字节不变）。
6. 再 `applyProfile(..., "gpt")` → settings 的 `subagents` 与 `profiles/gpt.json` `deepStrictEqual`；若 fixture 的 `subagents` 就是 gpt.json，则第二次调用的 `changed` 应为 `false` 且不新增备份（用 `readdirSync` 计数验证）。
7. `mode` 保留：写前 `chmod 0o600`，写后 `statSync().mode & 0o777 === 0o600`；备份 mode 同样为 0o600。
8. 并发修改检测：读快照后手工改文件内容，再 `writeSettings` → 抛 `SettingsStoreError` 且文件内容仍为手工改后的版本。

宿主接线由 `test/extension.test.ts` 自动覆盖，不得用文件层测试替代：fake Pi/ctx 必须实际执行已注册 handler、补全回调、session_start 回调和 custom factory，验证内联选择器与状态栏适配。

### 6.3 真机手动验证（交付前必须；由了解真实配置变更风险的用户执行）

```bash
# 0) 先备份真实 settings（本插件也会备份，但先存一份更保险）
cp /home/tcuni-claw/.pi/agent/settings.json /tmp/settings.pre.json

# 1) 建用户级档目录并放档（用户级优先于包内示例）
mkdir -p ~/.pi/agent/subagent-profiles
cp /home/tcuni-claw/pi/pi-subagent-switch/profiles/*.json ~/.pi/agent/subagent-profiles/

# 2) 装本地插件
pi install /home/tcuni-claw/pi/pi-subagent-switch
```

在 pi 会话内：

1. `/subprofile list` → 看见 4 个档，`gpt` 前有 `●`，额外一行显示档目录与来源 `(user)`。
2. 状态栏应显示 `subagents: gpt`。
3. `/subprofile kim` + Tab → 补全成 `kimi`；`/subprofile kimi` → notify 成功；状态栏变成 `subagents: kimi`。
4. `/subprofile`（无参）→ 出现会话内联选择器，↑/↓ 移动、Enter 应用、Esc 取消（取消不改文件：`md5sum` 前后一致）。
5. 启动一个新的 subagent，确认使用新档模型；已在运行的 subagent 不受影响。
6. 校验写回结果：

```bash
ls -la ~/.pi/agent/settings.json.bak-*                                   # 至少一个备份
jq -S 'del(.subagents)' /tmp/settings.pre.json > /tmp/a.json
jq -S 'del(.subagents)' ~/.pi/agent/settings.json > /tmp/b.json
diff /tmp/a.json /tmp/b.json && echo "其它顶层键的值未变 OK"              # 必须无输出
jq -S .subagents ~/.pi/agent/settings.json > /tmp/sub.json
jq -S . ~/.pi/agent/subagent-profiles/kimi.json > /tmp/kimi.json
diff /tmp/sub.json /tmp/kimi.json && echo "整块替换 OK"                   # 必须无输出
latest=$(ls -1t ~/.pi/agent/settings.json.bak-* | head -n 1)
diff /tmp/settings.pre.json "$latest" && echo "备份==切换前 OK"
```

7. `/subprofile gpt` 后，用 `jq -S .` 规范化新旧文件再 `diff` → **JSON 值完全一致**；允许缩进、空白和转义形式与原始文件不同。

### 6.4 HTML 原型验收

直接用浏览器打开 `docs/prototype.html`，不启动服务、不加载外部资源。逐项验证：四个档直切、重复切换不新增内存备份、list/help/错误参数、唯一候选 Tab 补全、内联选择器键盘与鼠标操作、Esc 取消、custom 状态、完整 settings 与档文件预览、窄屏无横向溢出。原型中的备份和 settings 均为内存演示，不得请求或写入真实用户文件。

---

## 7. 风险与规避

| # | 风险 | 规避 |
| --- | --- | --- |
| R1 | `getSettingsPath()` 未从包入口导出（`dist/index.d.ts:2`） | 动态探测 + fallback `join(getAgentDir(), "settings.json")`（§3.13.1）；类型 shim 里**故意不声明**它，迫使实现走探测分支 |
| R2 | pi-subagents 版本差异：0.85.0 已移除 `fallbackModels`/`launcher`，而 `pi-subagent-cfg` 的校验器仍允许 | 校验器按 0.85.0 白名单重写，**禁止**复用/照抄 `pi-subagent-cfg/src/submodel/settings-file.ts:79-84`；两个移除字段单列错误文案；校验器顶部注释标注「对齐 pi-subagents 0.85.0，字段来源 agents.js:41-47」 |
| R3 | 项目级 `.pi/settings.json` 会逐字段覆盖 user 级（`agents.js:1350-1390`），状态栏显示的档可能被项目级部分改写 | 文档明确「本插件只写 user 级、状态栏只反映 user 级」；`list`/切换 notify 中不做全局有效性承诺。非目标，不改项目级 |
| R4 | 并发写 settings.json（同一 Pi 进程多命令，或用户手改） | `writeSettings` 写前重读 + sha256 指纹比对（§3.6 步骤 1-2）；不一致即中止并提示重试。该机制是尽力检测，不覆盖比对后到 rename 前的极小竞争窗口；本期不引入跨进程锁 |
| R5 | 档目录缺失 / 档文件非法 JSON / 非法 schema | 目录缺失 → 回退包内示例；单档损坏 → 进 `errors`，不阻塞其它档；切换损坏档在写盘前失败，settings 不变 |
| R6 | 原子写的 `renameSync` 跨文件系统失败 | 临时文件与目标同目录（`settings-file.ts:187`），不跨 fs |
| R7 | 权限泄漏（settings 含 API 相关配置） | 临时文件 `0o600` + 保留原文件 mode + 备份同样 `0o600` |
| R8 | 备份文件无限增长 | 本期不自动清理（§1.2 非目标）；README 写一句 `rm ~/.pi/agent/settings.json.bak-*`；同秒重复切同档会被 `changed:false` 与 `wx` 挡住 |
| R9 | 两个档文件内容完全相同 → 当前档归属歧义 | 检测取字典序最小，`detail` 注明重复档名；`list` 显示实际命中 |
| R10 | 非 TUI 模式（`rpc`/`json`/`print`）无自定义组件 | 选择器分支降级为警告并提示用 `<name>` 直切；`setStatus` 前判 `hasUI`（`pi-planner-only/index.ts:342`） |
| R11 | `setStatus` key 冲突 / 被别的扩展覆盖 | 用唯一 key `pi-subagent-switch`；刷新失败只降级不抛 |
| R12 | 档名与文件名不一致（用户以为改了内部 name 字段） | 档文件**没有** name 字段（§1.2）；档名 = 文件名主干，`list` 直接展示文件名 |
| R13 | 用户误以为切换会立即影响运行中的 subagent | README + 成功 notify 文案注明「下一次启动 subagent 生效，无需 /reload」 |
| R14 | 示例档里的绝对路径（`subagentOnlyExtensions` 指向本机 `pi-planner-only/reviewer-git.ts`、`/public/config/pi/shared/pi-apply-patch/src/index.ts`）换机器即失效 | 保持与 gpt 现状一致（本期只为本机服务）；README 注明「示例档按本机路径编写，跨机使用请自行改 `subagentOnlyExtensions`」 |
| R15 | 类型 shim 与真实 host 漂移（Pi 升级） | shim 顶部注释固定「对齐 Pi 1.5.0 + `types.d.ts` 行号」；升级时按 §1.3 表逐项复核 |

---

## 附录 A：`profiles/gpt.json`（逐字复制自 `/home/tcuni-claw/.pi/agent/settings.json:23-97` 的 `subagents` 值）

```json
{
  "defaultModel": "tcuni/gpt-6.1-terra",
  "agentOverrides": {
    "oracle": { "model": "tcuni/gpt-6-astra", "thinking": "high" },
    "evidence-auditor": { "model": "tcuni/gpt-6.1-sol", "thinking": "high" },
    "delegate": { "model": "tcuni/gpt-6.1-terra", "thinking": "medium" },
    "reviewer": {
      "model": "tcuni/gpt-6-astra",
      "thinking": "high",
      "subagentOnlyExtensions": [
        "/home/tcuni-claw/.pi/agent/git/github.com/bioShaun/pi-planner-only/reviewer-git.ts"
      ],
      "tools": ["read", "grep", "find", "ls", "watchdog_diff", "contact_supervisor", "git_review"]
    },
    "worker": {
      "model": "tcuni/gpt-6.1-terra",
      "thinking": "medium",
      "subagentOnlyExtensions": ["/public/config/pi/shared/pi-apply-patch/src/index.ts"],
      "tools": ["read", "grep", "find", "ls", "bash", "edit", "write", "contact_supervisor", "apply_patch"],
      "mutationTools": ["apply_patch"]
    },
    "researcher": { "model": "tcuni/gpt-6-luna", "thinking": "medium" },
    "scout": {
      "model": "tcuni/gpt-6-luna",
      "thinking": "low",
      "tools": ["read", "grep", "find", "ls", "bash", "write", "contact_supervisor"]
    },
    "planner-validator": { "model": "tcuni/gpt-6.1-terra", "thinking": "medium" }
  }
}
```

> 格式允许自由换行（档文件是手写的），但**语义必须与本附录一致**；`gpt.json` 尤其必须与上表逐字段相等，才能保证「切回即还原现状」（§6.3 步骤 6）。

## 附录 B：另外三个档的模型映射（结构 = 附录 A，只换 `defaultModel` / `model` / `thinking`）

保持不变的字段：`tools`、`mutationTools`、`subagentOnlyExtensions`、`description`（若有）、agent 集合与顺序（8 个 override）。

**`kimi.json`**

| 位置 | model | thinking |
| --- | --- | --- |
| `defaultModel` | `kimi-coding/k3.1-pro` | — |
| `oracle` | `kimi-coding/k3.1-pro` | `high` |
| `evidence-auditor` | `kimi-coding/k3-256k` | `high` |
| `delegate` | `kimi-coding/k3.1-pro` | `medium` |
| `reviewer` | `kimi-coding/k3.1-pro` | `high` |
| `worker` | `kimi-coding/k3.1-pro` | `medium` |
| `researcher` | `kimi-coding/kimi-for-coding` | `medium` |
| `scout` | `kimi-coding/kimi-for-coding` | `low` |
| `planner-validator` | `kimi-coding/k3.1-pro` | `medium` |

**`claude.json`**

| 位置 | model | thinking |
| --- | --- | --- |
| `defaultModel` | `tcuni-claude/claude-opus-5-5` | — |
| `oracle` | `tcuni-claude/claude-opus-5-5` | `high` |
| `evidence-auditor` | `tcuni-claude/claude-opus-5-5` | `high` |
| `delegate` | `tcuni-claude/claude-sonnet-5-5` | `medium` |
| `reviewer` | `tcuni-claude/claude-opus-5-5` | `high` |
| `worker` | `tcuni-claude/claude-sonnet-5-5` | `medium` |
| `researcher` | `tcuni-claude/claude-sonnet-5-5` | `medium` |
| `scout` | `tcuni-claude/claude-sonnet-5-5` | `low` |
| `planner-validator` | `tcuni-claude/claude-sonnet-5-5` | `medium` |

**`local.json`**（全部 `qwen-local/qwen3.8-27b`，`thinking: "off"`——本机 27B 一律关思考以压延迟；如需开思考，改档文件即可）

| 位置 | model | thinking |
| --- | --- | --- |
| `defaultModel` | `qwen-local/qwen3.8-27b` | — |
| 全部 8 个 override | `qwen-local/qwen3.8-27b` | `off` |

> 所有模型 ID 均取自 `/home/tcuni-claw/.pi/agent/settings.json:98-111` 的 `enabledModels`；新增档若引用未启用模型，pi-subagents 侧会报模型不可用——本插件不校验模型可用性（无 registry 依赖，保持纯文件操作）。

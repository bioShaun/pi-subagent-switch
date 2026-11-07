# pi-subagent-switch

一个独立的 Pi 扩展：预先手写几套 subagent 配置档，用一条命令把 user 级
`~/.pi/agent/settings.json` 的 **`subagents` 整块**换成选中的档，并在状态栏常显当前档名。

- 零运行时依赖；业务全部在 `src/`，`extensions/index.ts` 只做 host 适配。
- 运行与测试统一要求 **Node 24+**（`node --test` 直跑 `.ts`）。
- 档文件可手写，也可用内置**配置向导**（`/subprofile new|edit`）全程键盘创建/修改；
  向导只写用户档目录，随包预置的 4 个示例档保持只读。

## 用法

| 输入 | 行为 |
| --- | --- |
| `/subprofile` | 打开会话内联主面板：档列表（`↑/↓` 或 `j/k` 移动、`Enter` 切换、`Esc` 取消；当前档行尾 `●` 并加粗）+ `＋ 新建档` / `✎ 修改档` 动作行（快捷键 `n` 新建、`e` 修改、`d` 删除选中用户档） |
| `/subprofile kimi` | 直接切换到 `kimi` 档 |
| `/subprofile new` | 新建档向导：档名 → 模板 → 角色配置 → 创建并切换 / 仅创建 / 取消 |
| `/subprofile edit` | 修改档向导：选档 → 角色配置 → 保存并切换 / 仅保存 / 取消 |
| `/subprofile delete <name>` / `rm` | 删除指定用户档（删除前自动备份，若曾覆盖内置同名档则自动恢复内置档）；CLI 全模式可用，显式命令即确认，主面板 `d` 删除需 TUI 二次确认 |
| `/subprofile list` / `ls` | 逐条列出档名 / `defaultModel` / override 数 / 当前档标记，内置档行尾带 `（内置）`，并逐行列出所有存在的档目录与来源 |
| `/subprofile help` / `-h` / `--help` | 显示用法 |
| `/subprofile <Tab>` | `getArgumentCompletions` 补全档名与 `new` / `edit` / `delete` / `rm` / `list` |

### 配置向导（新建 / 修改）

全程键盘操作；档名使用文本输入，模型列表支持直接输入关键字过滤：

1. **新建**：`ctx.ui.input` 输档名（自动小写、非法字符折叠成 `-`、空名报错重试、
   重名自动 `-2`/`-3`）→ `ctx.ui.select` 选模板（沿用其角色结构）→ 角色配置面板
   → `创建并切换` / `仅创建` / `取消`。
2. **修改**：`ctx.ui.select` 选档 → 角色配置面板 → `保存并切换` / `仅保存` / `取消`。
   修改包内示例档时先复制到用户档目录，**包内文件逐字节不动**。
3. **角色配置面板**（`ctx.ui.custom` 内联组件）：`defaultModel` + 模板全部角色逐行
   列出，每行独立 `model` / `thinking` 单元格。model 打开可搜索列表，直接输入过滤，
   `Backspace` 删除，默认选中当前模型；长列表分页滚动并显示匹配数。thinking 使用宿主
   原生 select。从任一选择列表按 Esc 返回后，光标仍停留在原单元格。顶部「批量应用
   同一模型到全部行」是可选快捷，批量后仍可逐行覆盖，选择列表末位的 `↩ 恢复原值`
   可撤销。model 选项来自 `ctx.modelRegistry.getAvailable()`，无可用模型时该项降级为
   警告、thinking 仍可选。
4. **提交语义**：只有本次改过的字段进入写入（`tools` 等未触碰字段原样保留）；
   任一步 `Esc` / 取消都**零写入**。写入前做 schema 校验，用户档目录缺失自动创建；
   修改已有档先备份原始字节（`0o600`）。写完重新加载档目录，选了「切换」才走与
   `/subprofile <name>` 相同的 `applyProfile` 路径——向导不直接写 `settings.json`。
   非 TUI 模式下降级为警告，不调用交互接口。

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

## 目录优先级（按名合并，向导只写用户目录）

1. 环境变量 `PI_SUBAGENT_PROFILES_DIR`（设置后**不回退**；此时它就是向导的写入目录）
2. 未设置环境变量时，按名合并（Per-profile Shadowing）：
   - `~/.pi/agent/subagent-profiles/*.json` — 用户档主位置；手写或向导写入（`0o600`）
   - 包内 `profiles/*.json` — 随插件发布的 4 个示例档，永不写
   - 同名档以用户档为准（用户同名损坏档屏蔽包内同名档）；未重名的包内预置档保留可见。

只认 `*.json`（大小写不敏感），跳过以 `.` 开头的文件名。所有存在的档目录在
`/subprofile list` 中逐行显示为 `档目录：<dir> (<source>)`；仅来自包内的档行尾带
`（内置）` 标记，被用户同名档覆盖的内置档不显示。

## 4 个示例档

| 档 | defaultModel | 说明 |
| --- | --- | --- |
| `gpt` | `tcuni/gpt-6.1-terra` | 当前 settings 的 `subagents` 原文（8 个 override），切回即还原 |
| `kimi` | `kimi-coding/k3.1-pro` | 全 kimi-coding 模型 |
| `claude` | `tcuni-claude/claude-opus-5-5` | 全 tcuni-claude 模型 |
| `local` | `qwen-local/qwen3.8-27b` | 全本机 27B，一律 `thinking: off` 压延迟 |

四档结构一致（8 个 override，`tools` / `mutationTools`
原样保留），只换 `defaultModel` / `model` / `thinking`。

### 给 LLM / agent 的配置提示词

把下面这句直接发给具备终端与文件工具的 LLM/agent：

```text
请阅读 https://github.com/bioShaun/pi-subagent-switch 的 README 和 ~/.pi/agent/settings.json，先以当前 subagents 为结构模板，按 enabledModels 的 provider 分组列出实际可用的模型方案（保留自定义输入）让我选择并确认新档名，再沿用当前角色结构在 ~/.pi/agent/subagent-profiles/ 创建对应的纯 subagents JSON（若档已存在先询问我），用 /subprofile list 验证后执行 /subprofile <档名> 完成切换，不要直接编辑 settings.json 或执行安装。
```

## 写盘安全与备份

切换 = 找到档 → 校验 → 读 settings → 若当前 `subagents` 已等于目标档则**不写盘、不
备份** → 深拷贝顶层文档、**仅替换 `subagents` 键** → 备份 → 原子写。

- **整块替换，不是合并**：原 `agentOverrides` 里目标档没有的 agent 会消失。
- 其它顶层键（`theme` / `packages` / `compaction` / `enabledModels` / `defaultTools` …）
  的 **JSON 值保持不变**；整个文件以 `JSON.stringify(doc, null, 2)` 重新序列化，
  允许缩进、空白与转义形式变化，**不承诺保留原始字节**。
- 每次实际写入前生成 `settings.json.bak-<YYYYMMDD-HHmmss>`，内容为**切换前的原始
  字节**，权限固定 `0o600`；同秒多次写入自动追加 `-1`、`-2` 等防冲突序号；
  临时文件同目录、`flag:"wx"`、缺省 `0o600`（已有 settings
  则保留原 mode）→ `renameSync` 覆盖，失败会清理临时文件。
- 写前重读做 sha256 指纹比对，尽力检测并发改动；比对到 rename 之间仍有极小竞争
  窗口，本期不引入跨进程锁。
- 备份写入成功后自动保留同前缀历史备份最近 5 份（`DEFAULT_MAX_BACKUPS = 5`），清理最早备份。

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
档安全写入（校验/原子写/`0o600`/备份）、角色面板与配置向导端到端（fake Pi 真实
执行 `input`/`select`/`custom`，不碰真实 settings 与档目录）。
`docs/prototype.html` 与 `docs/wizard-prototype.html` 是零依赖、离线可打开的行为与
视觉基准，只使用内存数据、不读写真实文件。

## 真机安装（由用户自行决定并执行）

本插件不会自动执行 `pi install`（它会改 settings 的 `packages`）。从 GitHub 安装：

```bash
pi install https://github.com/bioShaun/pi-subagent-switch
```

包内 4 个示例档安装后自动可见，**无需复制**。手写档放入
`~/.pi/agent/subagent-profiles/`（不存在则自行创建）；用向导新建/修改档时该目录会自动创建。
把示例档复制成用户档反而会让它屏蔽包内原版，收不到未来的示例更新——只有想基于示例
长期定制时才需要这么做（向导修改内置档时会自动完成复制）。

也可以安装本地源码：`pi install /path/to/pi-subagent-switch`。

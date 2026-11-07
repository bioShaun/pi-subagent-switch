# `pi-subagent-switch` 全面打磨技术方案与实施契约

> **文档性质**：Document-as-Contract（供 `engineer` 直接按约编码与沙盒自测）  
> **覆盖范围**：核心档机制完善、TUI 交互体验与边界排版打磨、Schema 校验严谨度与顶层配置支持、I/O 健壮性与工程化清理

---

## 1. 背景与边界（Scope & Non-Goals）

### 1.1 改动范围（In-Scope）
1. **核心档机制完善**：
   - **按名合并（Per-profile Shadowing）**：未设置 `PI_SUBAGENT_PROFILES_DIR` 时，`user` 目录与 `package` 目录按档名合并（`user` > `package`），同名档以 `user` 为准（含损坏档屏蔽低优先级同名档），未重名的 `package` 预置档保留可见；设置 `PI_SUBAGENT_PROFILES_DIR` 时保持仅用该目录不回退。
   - **切换前重读磁盘并校验**：`applyProfile` 切换前若 `fs.existsSync(profile.path)` 为真，从磁盘重读 `profile.path`、解析 JSON 并执行 `validateSubagents` 校验，以最新磁盘内容与 `settings.json` 比对及写入。
   - **支持删除用户档**：新增 `deleteUserProfile`、CLI `/subprofile delete|rm <name>`（含自动补全）及主面板 `d` 快捷键（含 `ui.select` 二次确认）；仅允许删除用户档，删除前生成 `.bak-<stamp>` 备份，若同名内置档曾被覆盖则删除后自动恢复内置档。
   - **备份文件自动清理**：备份写入成功后自动清理同前缀历史 `.bak-*` 文件，默认保留最近 5 份（`DEFAULT_MAX_BACKUPS = 5`），清理异常不中断主流程。
2. **TUI 交互体验与边界排版打磨**：
   - **2D 角色表格方向键导航**：`src/keys.ts` 支持 `"left" | "right" | "tab"`；`src/ui/role-editor.ts` 支持 `↑/↓`（或 `k/j`）保持当前列垂直切行、`←/→/Tab`（或 `h/l`）水平切列，并与顶部操作行、底部完成行自然衔接。
   - **超长文本省略截断**：`src/ui/frame.ts` 新增 `truncateVisible(s, maxWidth)`，在 `role-editor.ts` 和 `profile-selector.ts` 中对超长角色名、模型名、档名先截断（以 `…` 结尾）再 `padVisible`，防止撑破表格列对齐。
   - **视口滚动（Viewport Scrolling）**：`profile-selector.ts` 与 `role-editor.ts` 在条目数超过可视上限（`MAX_VISIBLE_PROFILES = 10` / `MAX_VISIBLE_ROLE_ROWS = 10`）时按焦点滚动窗口，并显示 `↑ 还有 N 项` / `↓ 还有 N 项`。
   - **Searchable Select 自定义模型名提交**：过滤无匹配但 `query.trim()` 非空时，按 `Enter` 直接采纳 `query.trim()` 作为自定义模型名；当 `models` 初始为空时向导仍允许打开选择器输入自定义模型名。
3. **Schema 校验严谨度与顶层配置支持**：
   - **Schema 校验补齐**：顶层 `defaultThinking` 强制校验 `THINKING_SET.has(v)`；`override.model` 强制校验 `v === false || isNonEmptyString(v)`。
   - **向导支持顶层默认项编辑**：`role-editor.ts` 支持查看与修改顶层 `defaultModel`、`defaultThinking`、`maxThinking`，未触碰（untouched）时严格保持原档结构不变。
4. **I/O 健壮性与工程化清理**：
   - **防同秒备份 `EEXIST` 碰撞与父目录自动创建**：备份冲突时自动追加 `-1`, `-2` 递增后缀；`writeSettings` 在父目录不存在时自动递归创建。
   - **Symlink 软链接友好写入**：`FsLike` 新增可选 `realpathSync?(path: string): string`；`writeSettings` 在目标已存在时解析真实路径并在真实路径同目录写临时文件后 `renameSync` 到真实路径，保留原软链接。
   - **内置预置档与测试临时目录清理**：移除 `profiles/*.json` 中的本机硬编码 `subagentOnlyExtensions` 路径；所有 `test/*.test.ts` 使用独立 `.tmp/<suite>` 子目录并在 `after` 钩子中自动清理，同时清理工作区现有 `.tmp/` 残留。

### 1.2 非目标与禁止项（Non-Goals）
- 不引入任何第三方运行时依赖。
- 严禁修改包内 `profiles/*.json` 的只读语义（向导与删除操作永不写 `package` 目录）。
- 保持 `tsc --noEmit`（`strict` + `noUncheckedIndexedAccess`）0 errors。

---

## 2. 架构与接口契约（Interface & Data Contracts）

### 2.1 `src/fs.ts` 接口与备份工具契约
```ts
export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string): Buffer;
  writeFileSync(
    path: string,
    data: string | Buffer,
    options?: { flag?: string; mode?: number },
  ): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  statSync(path: string): { mode: number };
  readdirSync(path: string): string[];
  mkdirSync?(path: string, options?: { recursive?: boolean; mode?: number }): void;
  /** 可选：解析符号链接真实路径，使 writeSettings 保留软链接。 */
  realpathSync?(path: string): string;
}

export const DEFAULT_MAX_BACKUPS = 5;

/**
 * 写入备份文件（防同秒 EEXIST 碰撞，冲突时追加 -1, -2...），
 * 并在写入成功后清理同目录同前缀历史 `.bak-*` 文件（保留最新 maxBackups 份）。
 * 清理异常静默忽略，绝不中断主流程。
 */
export function writeBackupFile(
  fs: FsLike,
  targetPath: string,
  raw: Buffer,
  stamp: string,
  maxBackups?: number,
): string;
```

### 2.2 `src/profiles.ts` 按名合并契约
- `resolveProfileDirs` 签名与行为保持不变：
  - 设置了非空 `PI_SUBAGENT_PROFILES_DIR` → 返回 `[{ dir: envDir, source: "user" }]`（不回退）。
  - 未设置 → 返回 `[{ dir: join(agentDir, "subagent-profiles"), source: "user" }, { dir: join(packageRoot, "profiles"), source: "package" }]`。
- `loadProfiles(deps: LoadDeps): ProfileSet` 行为演进：
  - 按 `roots` 顺序（高优先级在前）遍历所有存在的目录，维护 `seenNames = new Set<string>()`。
  - 若某档名 `name` 已在 `seenNames` 中（即更高优先级目录已存在同名有效档或同名损坏档），跳过低优先级目录中的同名文件。
  - 若不在 `seenNames` 中，将 `name` 加入 `seenNames`，读取并校验：成功则推入 `loaded`（带当前 `root.source`），失败则推入 `errors`。
  - `usedDir` 为第一个成功加载了至少 1 个有效档的 `ProfileRoot`（若无任何有效档则为 `undefined`）。
  - 最终 `loaded` 按 `name` 字典序升序排序返回。

### 2.3 `src/profile-store.ts` 删除用户档契约
```ts
export interface DeleteProfileResult {
  readonly name: string;
  readonly path: string;
  readonly backupPath: string;
  /** 若 packageDirs 中存在同名预置档，删除用户档后自动恢复为该内置档，此处为 true。 */
  readonly restoredPackageProfile: boolean;
}

export function deleteUserProfile(
  deps: {
    fs: FsLike;
    dir: string;
    packageDirs?: readonly string[];
    now?: () => Date;
    maxBackups?: number;
  },
  name: string,
): DeleteProfileResult;
```
- 异常语义：
  - 先剥离可选 `.json` 后缀：`const clean = name.trim().replace(/\.json$/i, "");`，再调 `assertProfileName(clean)`（非法档名抛 `ProfileStoreError`）。
  - 若 `join(deps.dir, `${clean}.json`)` 不存在：
    - 若 `(deps.packageDirs ?? []).some((d) => deps.fs.existsSync(join(d, `${clean}.json`)))` 为真 → 抛 `new ProfileStoreError(\`档 "${clean}" 是内置只读档，不能删除\`)`。
    - 否则 → 抛 `new ProfileError("not-found", \`未找到用户档 "${clean}"\`, { profile: clean })`。
  - 若存在：先调 `writeBackupFile` 备份原字节（`0o600`），再调 `deps.fs.unlinkSync(target)`，返回 `DeleteProfileResult`。

### 2.4 `src/keys.ts` 与 `src/ui/*` 接口契约
- `src/keys.ts`：
  ```ts
  export type KeyId =
    | "up"
    | "down"
    | "left"
    | "right"
    | "tab"
    | "enter"
    | "escape"
    | "ctrl+c"
    | "backspace"
    | "home"
    | "end"
    | "pageup"
    | "pagedown"
    | { char: string };
  ```
- `src/ui/frame.ts`：
  ```ts
  export function truncateVisible(s: string, maxWidth: number): string;
  ```
- `src/ui/profile-selector.ts`：
  ```ts
  export const MAX_VISIBLE_PROFILES = 10;

  export type SelectorResult =
    | { kind: "switch"; name: string }
    | { kind: "new" }
    | { kind: "edit" }
    | { kind: "delete"; name: string };
  ```
- `src/ui/role-editor.ts`：
  ```ts
  export const MAX_VISIBLE_ROLE_ROWS = 10;

  export interface RoleRow {
    key: string;
    model: string | null;
    thinking: string | null;
  }
  ```
  - `initRoleRows(value: SubagentsValue)` 生成顺序：
    1. Row 0: `{ key: "defaultModel", model: defModel, thinking: defThinking }`（其中 `defModel` 为顶层 `defaultModel` 文字列或 `""`；`defThinking` 为顶层 `defaultThinking` 字符串或 `""`）。
    2. Row 1: `{ key: "maxThinking", model: null, thinking: maxThinking }`（其中 `model` 恒为 `null`，仅 `thinking` 单元格可聚焦，值为顶层 `maxThinking` 字符串或 `""`）。
    3. Row 2+: `agentOverrides` 的各角色行，`model` 默认回落 `defModel`，`thinking` 默认回落 `defThinking || "medium"`。

---

## 3. 分步实施清单（Step-by-Step Todo List）

### Step 1: 升级 `src/fs.ts`（`realpathSync` 接口与 `writeBackupFile` 备份防碰撞 + 自动清理）
- **目标文件**：[fs.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/fs.ts#L1-L37)
- **实现要点**：
  1. 从 `"node:path"` 导入 `dirname, basename, join`。
  2. 在 `FsLike` 接口（`#L4-L18`）中新增可选方法：
     ```ts
     realpathSync?(path: string): string;
     ```
  3. 导出 `export const DEFAULT_MAX_BACKUPS = 5;`。
  4. 实现并导出 `writeBackupFile(fs, targetPath, raw, stamp, maxBackups = DEFAULT_MAX_BACKUPS): string`：
     - 基础路径 `const base = `${targetPath}.bak-${stamp}`;`。
     - 循环 `for (let i = 0; ; i++)`：
       - `const candidate = i === 0 ? base : `${base}-${i}`;`
       - 若 `fs.existsSync(candidate)` 为 `true`，`continue`；
       - `try { fs.writeFileSync(candidate, raw, { flag: "wx", mode: 0o600 }); writtenPath = candidate; break; } catch (e) { if ((e as NodeJS.ErrnoException)?.code === "EEXIST") continue; throw e; }`
     - 备份成功后执行清理（包裹在 `try { ... } catch {}` 中）：
       - 若 `maxBackups > 0 && typeof fs.readdirSync === "function" && typeof fs.unlinkSync === "function"`：
         - 读取 `const dir = dirname(targetPath); const prefix = `${basename(targetPath)}.bak-`;`
         - 过滤出 `fs.readdirSync(dir).filter((f) => f.startsWith(prefix))`
         - 按 `(stamp, seq)` 升序排序（解析后缀：若形如 `<stamp>-<数字>` 且 `<stamp>` 含 `-` 或本身非空，区分基礎 stamp 与递增序号 `seq`，使 `-2` 排在 `-10` 前面，无序号视为 `seq = 0`）。
         - 若数量 `> maxBackups`，对前 ` backups.length - maxBackups` 个文件逐个调用 `try { fs.unlinkSync(join(dir, f)); } catch {}`。

### Step 2: 升级 `src/settings-store.ts`（防碰撞备份清理、父目录自动创建、Symlink 友好写）
- **目标文件**：[settings-store.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/settings-store.ts#L84-L139)
- **实现要点**：
  1. 导入 `writeBackupFile` 自 `./fs.ts`。
  2. `writeSettings` 函数签名支持可选 `maxBackups?: number`：
     `opts: { snapshot: SettingsSnapshot; stamp: string; maxBackups?: number }`。
  3. 备份步骤（`#L107-L115`）：
     ```ts
     let backupPath: string | undefined;
     if (snapshot.existed) {
       backupPath = writeBackupFile(
         fs,
         path,
         currentRaw ?? snapshot.raw ?? Buffer.alloc(0),
         stamp,
         opts.maxBackups,
       );
     }
     ```
  4. Symlink 解析与父目录创建（`#L117-L125`）：
     ```ts
     let targetPath = path;
     if (exists && typeof fs.realpathSync === "function") {
       try {
         targetPath = fs.realpathSync(path);
       } catch {
         targetPath = path;
       }
     }
     const targetDir = dirname(targetPath);
     if (!fs.existsSync(targetDir)) {
       if (typeof fs.mkdirSync !== "function") {
         throw new SettingsStoreError(`配置目录不存在且当前环境无法创建：${targetDir}`);
       }
       try {
         fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
       } catch (e) {
         throw new SettingsStoreError(`无法创建配置目录 ${targetDir}：${errMsg(e)}`);
       }
     }
     const tmp = join(
       targetDir,
       `.${basename(targetPath)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
     );
     const data = JSON.stringify(doc, null, 2) + "\n";
     try {
       fs.writeFileSync(tmp, data, { flag: "wx", mode: snapshot.mode ?? 0o600 });
       fs.renameSync(tmp, targetPath);
     } catch (e) { ... }
     ```

### Step 3: 升级 `src/schema.ts`（补齐 `defaultThinking` 枚举校验与 `override.model` 非空校验）
- **目标文件**：[schema.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/schema.ts#L106-L108) 及 [#L201-L210](file:///home/tcuni-claw/pi/pi-subagent-switch/src/schema.ts#L201-L210)
- **实现要点**：
  1. 在 `validateOverride` 的 `case "model":`（`#L106-L108`）：
     将 `if (!(typeof v === "string" || v === false)) fail("必须是字符串或 false", profile, p);`
     修改为：
     ```ts
     case "model":
       if (!(v === false || isNonEmptyString(v))) fail("必须是非空字符串或 false", profile, p);
       break;
     ```
  2. 在 `validateSubagents` 的 `switch (key)`（`#L201-L210`）：
     将 `case "defaultThinking":` 从 `isNonEmptyString` 分支移到 `maxThinking` 分支：
     ```ts
     case "defaultModel":
     case "defaultProvider":
       if (!isNonEmptyString(v)) fail("必须是非空字符串", profileName, key);
       break;
     case "defaultThinking":
     case "maxThinking":
       if (typeof v !== "string" || !THINKING_SET.has(v)) {
         fail("必须是 THINKING_LEVELS 之一", profileName, key);
       }
       break;
     ```

### Step 4: 升级 `src/profiles.ts`（用户档与内置档按名合并 Per-profile Shadowing）
- **目标文件**：[profiles.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/profiles.ts#L57-L115)
- **实现要点**：
  - 在 `loadProfiles(deps: LoadDeps)` 中：
    ```ts
    export function loadProfiles(deps: LoadDeps): ProfileSet {
      const { fs, roots } = deps;
      const errors: ProfileError[] = [];
      const loaded: Profile[] = [];
      const seenNames = new Set<string>();
      let usedDir: ProfileRoot | undefined;

      for (const root of roots) {
        if (!fs.existsSync(root.dir)) continue;
        let names: string[];
        try {
          names = fs.readdirSync(root.dir).filter(
            (f) => /\.json$/i.test(f) && !f.startsWith("."),
          );
        } catch {
          continue;
        }
        let rootContributed = false;
        for (const f of names) {
          const name = stem(f);
          if (seenNames.has(name)) continue;
          seenNames.add(name);
          const path = join(root.dir, f);
          try {
            let raw: Buffer;
            try {
              raw = fs.readFileSync(path);
            } catch (e) {
              throw new ProfileError(
                "unreadable",
                `档 "${name}": 无法读取 ${path}: ${errMsg(e)}`,
                { profile: name },
              );
            }
            let value: unknown;
            try {
              value = JSON.parse(raw.toString("utf8"));
            } catch (e) {
              throw new ProfileError(
                "invalid-json",
                `档 "${name}": ${path} 不是合法 JSON: ${errMsg(e)}`,
                { profile: name },
              );
            }
            const summary = validateSubagents(value, name);
            loaded.push({
              name,
              path,
              value: value as SubagentsValue,
              summary,
              source: root.source,
            });
            rootContributed = true;
          } catch (e) {
            errors.push(asProfileError(e, name));
          }
        }
        if (rootContributed && usedDir === undefined) {
          usedDir = root;
        }
      }
      loaded.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { profiles: loaded, errors, dirs: roots, usedDir };
    }
    ```

### Step 5: 升级 `src/apply-profile.ts`（切换前从磁盘重读档文件并校验）
- **目标文件**：[apply-profile.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/apply-profile.ts#L24-L55)
- **实现要点**：
  1. 导入 `ProfileError` 自 `./schema.ts`，导入 `SubagentsValue` 自 `./profiles.ts`。
  2. 在 `applyProfile` 中：
     ```ts
     const profile = findProfile(set, name);
     let profileValue: SubagentsValue = profile.value;
     if (fs.existsSync(profile.path)) {
       let raw: Buffer;
       try {
         raw = fs.readFileSync(profile.path);
       } catch (e) {
         throw new ProfileError(
           "unreadable",
           `档 "${profile.name}": 无法读取 ${profile.path}: ${errMsg(e)}`,
           { profile: profile.name },
         );
       }
       try {
         profileValue = JSON.parse(raw.toString("utf8")) as SubagentsValue;
       } catch (e) {
         throw new ProfileError(
           "invalid-json",
           `档 "${profile.name}": ${profile.path} 不是合法 JSON: ${errMsg(e)}`,
           { profile: profile.name },
         );
       }
     }
     const summary = validateSubagents(profileValue, profile.name);
     ```
  3. 后续比对 `stableStringify(currentSub) === stableStringify(profileValue)` 与 `withSubagents(snapshot.doc, profileValue)` 均使用 `profileValue`。

### Step 6: 升级 `src/profile-store.ts`（接入 `writeBackupFile` 并新增 `deleteUserProfile`）
- **目标文件**：[profile-store.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/profile-store.ts#L84-L141)
- **实现要点**：
  1. 导入 `writeBackupFile` 自 `./fs.ts`，导入 `ProfileError` 自 `./schema.ts`。
  2. `saveUserProfile` 参数 `deps` 支持可选 `maxBackups?: number`，在第 117-121 行使用 `writeBackupFile(fs, target, raw ?? Buffer.alloc(0), stamp, deps.maxBackups)` 替代原来的直接 `fs.writeFileSync`。
  3. 新增并导出 `DeleteProfileResult` 接口与 `deleteUserProfile` 函数（见 2.3 节契约）。

### Step 7: 升级 `src/keys.ts` 与 `src/ui/frame.ts`（方向键/Tab 解析与可见宽度截断）
- **目标文件 1**：[keys.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/keys.ts#L1-L44)
  - `KeyId` 联合类型加入 `"left" | "right" | "tab"`。
  - `parseKey(data: string)` 中：
    - 在 `switch (key)` 中加入 `case "left": case "right": case "tab": return key;`。
    - 在 `switch` 之后增加兜底判断：
      ```ts
      if (data === "\t" || data === "\x1b[9u") return "tab";
      if (data === "\x1b[D" || data === "\x1bOD" || data === "\x1b[57417u") return "left";
      if (data === "\x1b[C" || data === "\x1bOC" || data === "\x1b[57418u") return "right";
      ```
- **目标文件 2**：[frame.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/ui/frame.ts#L20-L30)
  - 新增并导出 `truncateVisible(s: string, maxWidth: number): string`：
    ```ts
    export function truncateVisible(s: string, maxWidth: number): string {
      const max = Math.max(0, Math.floor(maxWidth));
      if (max === 0) return "";
      if (visibleWidth(s) <= max) return s;
      if (max === 1) return "…";
      if (s.includes("\x1b")) return truncateToWidth(s, max);
      let acc = "";
      let w = 0;
      for (const ch of s) {
        const cw = visibleWidth(ch);
        if (w + cw > max - 1) break;
        acc += ch;
        w += cw;
      }
      return `${acc}…`;
    }
    ```

### Step 8: 升级 `src/ui/profile-selector.ts`（`d` 快捷键删除、超长截断、视口滚动）
- **目标文件**：[profile-selector.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/ui/profile-selector.ts#L47-L206)
- **实现要点**：
  1. 从 `./frame.ts` 导入 `framedPanel, padVisible, truncateVisible`。
  2. 导出 `export const MAX_VISIBLE_PROFILES = 10;`。
  3. `SelectorResult` 增加 `| { kind: "delete"; name: string }`。
  4. 在 `handleInput` 的 `if (typeof key === "object")` 分支（`#L128-L145`）新增：
     ```ts
     if (key.char === "d") {
       const p = profiles[cursor];
       if (p) {
         onDone({ kind: "delete", name: p.name });
         return;
       }
       continue;
     }
     ```
  5. 在 `render`（`#L168-L203`）中：
     - 计算滚动窗口：当 `profiles.length > MAX_VISIBLE_PROFILES` 时，以 `activeIdx = cursor < profiles.length ? cursor : profiles.length - 1` 计算 `start` 和 `end`；否则 `start = 0, end = profiles.length`。
     - 若 `start > 0`，推入 `theme.fg("muted", `  ↑ 还有 ${start} 项`)`。
     - 对 `i = start .. end - 1` 的每行：
       ```ts
       const nameCol = padVisible(truncateVisible(p.name, 11), 12);
       const modelCol = padVisible(truncateVisible(p.summary.defaultModel ?? "—", 21), 22);
       const main = truncateToWidth(
         `${prefix}${nameCol}${modelCol}`,
         Math.max(0, inner - countText.length - markerText.length),
       );
       ```
     - 若 `end < profiles.length`，推入 `theme.fg("muted", `  ↓ 还有 ${profiles.length - end} 项`)`。
     - 底栏提示更新为：`theme.fg("muted", "↑/↓ 选择 · Enter 确认 · Esc 取消 · n 新建 · e 修改 · d 删除")`。

### Step 9: 升级 `src/ui/role-editor.ts`（顶层默认项支持、2D 方向键导航、超长截断、视口滚动）
- **目标文件**：[role-editor.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/ui/role-editor.ts#L1-L319)
- **实现要点**：
  1. 从 `./frame.ts` 导入 `framedPanel, padVisible, truncateVisible`；导出 `export const MAX_VISIBLE_ROLE_ROWS = 10;`。
  2. 将 `RoleRow` 定义为 `{ key: string; model: string | null; thinking: string | null }`。
  3. 更新 `initRoleRows(value: SubagentsValue): RoleRow[]`：
     - 第 0 行：`{ key: "defaultModel", model: def, thinking: defThinking }`（`def` 与 `defThinking` 在未设置时为 `""`）。
     - 第 1 行：`{ key: "maxThinking", model: null, thinking: maxThinking }`（`maxThinking` 在未设置时为 `""`）。
     - 后续行：`agentOverrides` 各角色行（`model` 回落 `def`，`thinking` 回落 `defThinking || "medium"`）。
  4. 更新 `buildValue`：
     - `row.key === "defaultModel"`：`field === "model" && row.model` → `v.defaultModel = row.model`；`field === "thinking" && row.thinking` → `v.defaultThinking = row.thinking`。
     - `row.key === "maxThinking"`：`field === "thinking" && row.thinking` → `v.maxThinking = row.thinking`。
     - 其余角色行：写 `v.agentOverrides[row.key][field] = row[field]`。
  5. 更新 `applyBatchModel` 与 `revertAllModels`：
     - 仅处理 `row.model !== null` 的行（跳过 `maxThinking` 行）。
  6. 在 `createRoleEditor` 中构建 `items`：
     ```ts
     const items: FlatItem[] = [{ kind: "batch" }];
     rows.forEach((row, ri) => {
       if (row.model !== null) items.push({ kind: "cell", row: ri, field: "model" });
       if (row.thinking !== null) items.push({ kind: "cell", row: ri, field: "thinking" });
     });
     items.push({ kind: "next" });
     ```
  7. 实现 2D 导航函数：
     - 维护 `let preferredField: RoleField = "model";`（若初始 `items[cursor]` 为 `cell`，初始化为该 `cell.field`）。
     - 辅助函数 `findRowCell(ri: number, pref: RoleField): number | undefined`：优先返回 `cellIdx.get(touchedKey(ri, pref))`，若无则返回另一列的下标。
     - **垂直移动 `moveVertical(delta: 1 | -1)`**：
       - 当前为 `batch`：`delta === 1` 时跳至 `findRowCell(0, preferredField) ?? items.length - 1`；`delta === -1` 时回绕至 `items.length - 1`（`next`）。
       - 当前为 `next`：`delta === 1` 时回绕至 `0`（`batch`）；`delta === -1` 时跳至 `findRowCell(rows.length - 1, preferredField) ?? 0`。
       - 当前为 `cell(ri, field)`：
         - `nextRow = ri + delta`
         - 若 `nextRow < 0` → 跳至 `0`（`batch`）
         - 若 `nextRow >= rows.length` → 跳至 `items.length - 1`（`next`）
         - 否则跳至 `findRowCell(nextRow, preferredField)`（注意：若目标行具有 `preferredField` 列，则聚焦该列；若目标行仅有另一列，聚焦另一列但不覆盖 `preferredField`，保留 sticky column 体验）。
     - **水平移动 `moveHorizontal(key: "left" | "right" | "tab")`**（`h` 映射 `"left"`，`l` 映射 `"right"`）：
       - 若当前为 `cell(ri, field)`：
         - `otherField: RoleField = field === "model" ? "thinking" : "model"`
         - `otherIdx = cellIdx.get(touchedKey(ri, otherField))`
         - 若 `otherIdx !== undefined`：更新 `cursor = otherIdx; preferredField = otherField; deps.onCursorChange?.(cursor);`
         - 若该行无另一列且 `key === "tab"`：线性移动 `cursor = (cursor + 1) % items.length; deps.onCursorChange?.(cursor);`
       - 若当前为 `batch` 或 `next` 且 `key === "tab"`：
         - 线性移动 `cursor = (cursor + 1) % items.length; deps.onCursorChange?.(cursor);`
  8. 在 `render` 中：
     - 角色名截断补齐：`const keyCol = padVisible(truncateVisible(row.key, KEY_W - 1), KEY_W);`
     - 单元格截断补齐：计算 `maxValW = Math.max(1, colWidth - 2 - (isTouched ? 1 : 0) - 1)`，对 `value || "—"` 调用 `truncateVisible(value || "—", maxValW)` 后再加前缀、着色、加 `*`、最后 `padVisible(marked, colWidth)`。
     - 当 `row.model === null` 时，`mSeg = padVisible(theme.fg("text", "  —"), MODEL_W)`；当 `row.thinking === null` 时，`tSeg = theme.fg("text", "  —")`。
     - 当 `rows.length > MAX_VISIBLE_ROLE_ROWS` 时，按活跃行索引计算 `[start, end)` 窗口，并在上下方渲染 `↑ 还有 ${start} 项` / `↓ 还有 ${rows.length - end} 项`。
     - 底栏提示更新为：`theme.fg("muted", "↑/↓ 切行 · ←/→/Tab 切列 · Enter 选择/继续 · Esc 取消（零改动）")`。

### Step 10: 升级 `src/ui/searchable-select.ts` 与 `src/configure-profile.ts`（支持自定义模型输入）
- **目标文件 1**：[searchable-select.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/ui/searchable-select.ts#L81-L115)
  - 在 `handleInput` 的 `if (key === "enter")` 分支（`#L81-L85`）：
    ```ts
    if (key === "enter") {
      const selected = matches[cursor];
      if (selected !== undefined) {
        onDone(selected);
        return;
      }
      const custom = query.trim();
      if (custom.length > 0) {
        onDone(custom);
      }
      return;
    }
    ```
  - 在 `render` 的 `if (matches.length === 0)` 分支（`#L109-L111`）：
    ```ts
    if (matches.length === 0) {
      const custom = query.trim();
      if (custom.length > 0) {
        lines.push(
          theme.fg("warning", `  没有匹配项（按 Enter 使用自定义模型: "${custom}"）`),
        );
      } else {
        lines.push(theme.fg("warning", "  没有匹配项，请直接输入自定义模型名称"));
      }
    }
    ```
- **目标文件 2**：[configure-profile.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/configure-profile.ts#L150-L181)
  - 当 `action.type === "batch"` 且 `models.length === 0` 时：
    `ui.notify("modelRegistry.getAvailable() 无可用模型，可直接输入自定义模型名", "warning");`（不再 `continue` 跳过，继续调用 `selectModel`）。
  - 当 `action.field === "model"` 且 `models.length === 0` 时：
    `ui.notify("modelRegistry.getAvailable() 无可用模型，可直接输入自定义模型名", "warning");`（不再 `continue` 跳过，继续调用 `selectModel`）。
  - 在第 179 行赋值时：`if (action.field === "model") row.model = sel; else row.thinking = sel;`。

### Step 11: 升级 `src/command.ts`、`extensions/index.ts` 与 `README.md`（接线 `delete|rm` 命令与主面板删除确认）
- **目标文件 1**：[command.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/src/command.ts#L17-L176)
  1. 从 `./profile-store.ts` 导入 `ProfileStoreError, deleteUserProfile`。
  2. `CommandDeps` 新增可选属性：
     `readonly confirmDelete?: (name: string) => Promise<boolean>;`
  3. 更新 `USAGE` 包含 `/subprofile delete <name>` 说明。
  4. 新增内部辅助函数 `deleteProfileCmd(rawName: string, deps: CommandDeps)`：
     - 查找 `userRoot = deps.roots.find((r) => r.source === "user")` 及 `packageDirs = deps.roots.filter((r) => r.source === "package").map((r) => r.dir)`。
     - 若 `!userRoot`，`deps.notify("未找到可写的用户档目录（roots 无 user 根）", "error"); return;`
     - 调用 `const res = deleteUserProfile({ fs: deps.fs, dir: userRoot.dir, packageDirs }, rawName);`
     - 通知成功消息（含备份文件名，若 `res.restoredPackageProfile` 为真则附带 `，已恢复为同名内置档`）。
  5. 在 `runSubprofile` 中：
     - 处理 `parts[0] === "delete" || parts[0] === "rm"`：
       - `parts.length === 1` → `deps.notify(\`请指定要删除的档名：/subprofile delete <name>\\n${USAGE}\`, "warning"); return;`
       - `parts.length > 2` → `deps.notify(\`参数过多：${USAGE}\`, "warning"); return;`
       - `parts.length === 2` → 调用 `deleteProfileCmd(parts[1]!, deps)` 并 `return;`
     - 处理主面板返回 `picked.kind === "delete"`：
       - 检查 `const target = set.profiles.find((p) => p.name === picked.name);`
       - 若 `target && target.source === "package"`：`deps.notify(\`档 "${picked.name}" 是内置只读档，不能删除\`, "warning"); return;`
       - 若提供了 `deps.confirmDelete`：
         `const ok = await deps.confirmDelete(picked.name); if (!ok) { deps.notify("已取消删除", "info"); return; }`
       - 调用 `deleteProfileCmd(picked.name, deps)`。
  6. 在 `completeProfiles(prefix, deps)` 中：
     - 若 `/^(delete|rm)\s+/i.test(prefix)`：
       - 提取命令头 `cmd` 与档名前缀 `argPrefix`，仅对 `set.profiles.filter((p) => p.source === "user" && p.name.startsWith(argPrefix))` 返回 `{ value: \`${cmd} ${p.name}\`, label: p.name, description: p.summary.defaultModel }`。
     - 否则：在 `"edit"` 之后增加 `"delete"` 子命令补全项 `{ value: "delete", label: "delete", description: "删除用户档" }`（当 `"delete".startsWith(prefix) || prefix === ""` 时），若 `"rm".startsWith(prefix) && prefix !== ""` 则补全 `"rm"`。
- **目标文件 2**：[extensions/index.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/extensions/index.ts#L72-L127)
  - 在 `makeDeps` 中实现 `confirmDelete`：
    ```ts
    confirmDelete: async (name) => {
      if (ctx.mode !== "tui") return false;
      const choice = await ctx.ui.select(
        `确认删除用户档 "${name}"？（删除前会自动备份）`,
        ["确认删除", "取消"],
      );
      return choice === "确认删除";
    },
    ```
- **目标文件 3**：[README.md](file:///home/tcuni-claw/pi/pi-subagent-switch/README.md)
  - 同步更新命令表格（新增 `/subprofile delete <name>` / `rm`、主面板 `d` 快捷键）、目录按名合并优先级说明、备份自动保留最近 5 份说明，并移除关于示例档硬编码路径的过时说明。

### Step 12: 清理 `profiles/*.json` 硬编码路径与 `test/*.test.ts` 临时目录及测试升级
- **目标文件 1**：
  - [profiles/kimi.json](file:///home/tcuni-claw/pi/pi-subagent-switch/profiles/kimi.json#L10-L18)
  - [profiles/local.json](file:///home/tcuni-claw/pi/pi-subagent-switch/profiles/local.json#L10-L18)
  - [profiles/claude.json](file:///home/tcuni-claw/pi/pi-subagent-switch/profiles/claude.json#L10-L18)
  - [profiles/gpt.json](file:///home/tcuni-claw/pi/pi-subagent-switch/profiles/gpt.json#L10-L18)
  - 移除这 4 个预置档中 `reviewer` 和 `worker` 下的 `"subagentOnlyExtensions"` 字段。
- **目标文件 2（测试临时目录自动清理）**：
  - 在以下 9 个测试文件中引入 `after`（来自 `"node:test"`），将各自的 `TMP` 设为独立子目录 `join(ROOT, ".tmp", "<test-file-name>")`，并在文件末尾注册：
    ```ts
    after(() => {
      nodeFs.rmSync(TMP, { recursive: true, force: true });
      try {
        nodeFs.rmdirSync(join(ROOT, ".tmp"));
      } catch {
        // 其它并发测试文件尚未结束时忽略
      }
    });
    ```
    涉及文件清单：
    1. [test/profiles.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/profiles.test.ts#L1-L18)
    2. [test/apply-profile.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/apply-profile.test.ts#L1-L18)
    3. [test/command.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/command.test.ts#L1-L18)
    4. [test/configure-profile.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/configure-profile.test.ts#L1-L20)
    5. [test/current-profile.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/current-profile.test.ts#L1-L18)
    6. [test/extension.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/extension.test.ts#L1-L15)
    7. [test/profile-store.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/profile-store.test.ts#L1-L23)
    8. [test/settings-store.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/settings-store.test.ts#L1-L24)
    9. [test/status.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/status.test.ts#L1-L18)
- **目标文件 3（现有测试适配与新增单元测试用例清单）**：
  1. [test/profiles.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/profiles.test.ts#L60-L72)：
     - 更新 `"user 有档 → 只用 user，package 被忽略"` 为验证按名合并（Per-profile Shadowing）：`user` 与 `package` 非重名档并存、同名档以 `user` 覆盖 `package`（含 `source` 属性验证）、`user` 同名损坏档进 `errors` 且屏蔽 `package` 同名档。
  2. [test/apply-profile.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/apply-profile.test.ts)：
     - 新增测试：`loadProfiles` 后磁盘上的档文件被手改（合法修改 → 切换写入新内容；手改为非法 JSON 或非法 schema → `applyProfile` 抛 `ProfileError` 拒绝写入）。
  3. [test/profile-store.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/profile-store.test.ts)：
     - 新增测试：`deleteUserProfile` 正常删除用户档并产生备份、删除覆盖了内置档的用户档返回 `restoredPackageProfile: true`、尝试删除内置只读档抛 `ProfileStoreError`、删除不存在档抛 `ProfileError(not-found)`、同秒多次保存/删除自动递增备份后缀 `-1`/`-2`、超过 5 份备份自动清理最早备份。
  4. [test/settings-store.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/settings-store.test.ts#L124-L134)：
     - 将 `"writeSettings: 同 stamp 备份 wx 冲突报错"` 更新为验证同 `stamp` 自动生成 `.bak-same-1` 不报错。
     - 新增测试：超过 5 份历史备份自动清理、父目录缺失时自动 `mkdirSync` 创建、目标 `settings.json` 为软链接（提供 `realpathSync`）时写入真实路径并保留软链接。
  5. [test/keys.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/keys.test.ts#L40-L46)：
     - 新增 `"left" / "right" / "tab"` 键解析测试（含 `\x1b[D`, `\x1bOD`, `\x1b[C`, `\x1bOC`, `\t`），更新 `#L41` 的未知键断言。
  6. [test/role-editor.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/role-editor.test.ts)：
     - 适配 `initRoleRows` 新增的 `defaultThinking` 与 `maxThinking` 行。
     - 更新并新增 2D 方向键导航测试：`↑/↓`（`k/j`）垂直切行保持当前列、`←/→/Tab`（`h/l`）水平切列、`defaultThinking` 与 `maxThinking` 修改写回与未触碰零污染、超长模型名 `truncateVisible` 截断对齐、超过 10 行角色时的视口滚动（`↑ 还有 N 项` / `↓ 还有 N 项`）。
  7. [test/profile-selector.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/profile-selector.test.ts)：
     - 新增测试：按 `d` 键返回 `{ kind: "delete", name }`、超长档名与模型名截断不破坏列对齐、超过 10 个档时的视口滚动指示。
  8. [test/searchable-select.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/searchable-select.test.ts#L58-L67)：
     - 更新无匹配测试：输入非空关键字无匹配项时按 `Enter` 直接提交 `query.trim()` 作为自定义模型名，空关键字无匹配项时按 `Enter` 不提交。
  9. [test/schema.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/schema.test.ts)：
     - 新增测试：顶层 `defaultThinking` 非法枚举值报错、`agentOverrides.<role>.model` 为空串 `""` 或空白 `"   "` 报错。
  10. [test/configure-profile.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/configure-profile.test.ts) 与 [test/extension.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/extension.test.ts) 与 [test/command.test.ts](file:///home/tcuni-claw/pi/pi-subagent-switch/test/command.test.ts)：
      - 适配 2D 角色编辑器按键序列（在 `role-editor` 中按 `↓` 切行、按 `→`/`Tab` 切 `thinking` 列）。
      - 在 `test/command.test.ts` 中适配 `completeProfiles` 的 `"delete"` 补全项，并新增 `/subprofile delete <name>`、`/subprofile rm <name>`、主面板 `d` 删除（二次确认通过/取消/内置档拒绝）及 `"delete "` 参数补全测试。

---

## 4. 自验证闭环标准（Verification Criteria）

`engineer` 完成全部代码与测试修改后，必须在沙盒内依次执行以下验证命令并全部通过：

1. **清理历史遗留 `.tmp` 目录**：
   ```bash
   rm -rf /home/tcuni-claw/pi/pi-subagent-switch/.tmp
   ```
2. **TypeScript 严格类型检查**：
   ```bash
   npm run typecheck
   ```
   - **判定标准**：退出码为 `0`，无任何诊断错误。
3. **全量单元测试**：
   ```bash
   npm test
   ```
   - **判定标准**：退出码为 `0`，全部测试套件 pass，`# fail 0`，`# skipped 0`。
4. **验证测试后无 `.tmp` 残留且预置档无硬编码路径**：
   ```bash
   test ! -e .tmp && ! grep -rn "/home/tcuni-claw\|/public/config" profiles/
   ```
   - **判定标准**：退出码为 `0`（`.tmp` 目录已被自动清除，`profiles/` 下无本机硬编码路径）。

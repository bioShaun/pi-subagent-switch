import { basename } from "node:path";
import type { FsLike } from "./fs.ts";
import type { Profile, ProfileRoot, ProfileSet } from "./profiles.ts";
import { loadProfiles } from "./profiles.ts";
import { ProfileError } from "./schema.ts";
import { SettingsStoreError } from "./settings-store.ts";
import { detectCurrentProfile } from "./current-profile.ts";
import type { CurrentProfile } from "./current-profile.ts";
import { applyProfile } from "./apply-profile.ts";
import { ProfileStoreError, deleteUserProfile } from "./profile-store.ts";
import type { SelectorResult } from "./ui/profile-selector.ts";

export type { SelectorResult } from "./ui/profile-selector.ts";

export type NotifyLevel = "info" | "warning" | "error";

export interface CommandDeps {
  readonly fs: FsLike;
  readonly settingsPath: string;
  readonly roots: readonly ProfileRoot[];
  /** 打开内联 TUI 主面板；返回切档 / 进向导结果或 undefined（取消）。 */
  readonly openSelector: (state: SelectorState) => Promise<SelectorResult | undefined>;
  /** 新建/修改档配置向导（adapter 接 ctx.ui + modelRegistry；非 TUI 降级警告）。 */
  readonly openConfigWizard: (kind: "new" | "edit") => Promise<void>;
  /** 删除前二次确认（非 TUI 降级返回 false）。 */
  readonly confirmDelete?: (name: string) => Promise<boolean>;
  readonly notify: (message: string, level: NotifyLevel) => void;
  /** 每次命令结束后回调（adapter 接 refreshStatus），含 list、帮助、取消与失败。 */
  readonly onAfterCommand: () => void;
}
export interface SelectorState {
  readonly profiles: readonly Profile[];
  readonly current: CurrentProfile;
  readonly errors: readonly ProfileError[];
}

export const USAGE =
  "用法：/subprofile [name|new|edit|delete|rm|list]\n" +
  "  /subprofile          → 打开主面板（切换 / 新建 / 修改 / 删除）\n" +
  "  /subprofile kimi     → 直接切换到 kimi 档\n" +
  "  /subprofile new      → 新建档向导\n" +
  "  /subprofile edit     → 修改档向导\n" +
  "  /subprofile delete <name> → 删除用户档（可简写 rm）\n" +
  "  /subprofile list     → 列出所有档与当前档";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function deleteProfileCmd(rawName: string, deps: CommandDeps): void {
  const userRoot = deps.roots.find((r) => r.source === "user");
  const packageDirs = deps.roots.filter((r) => r.source === "package").map((r) => r.dir);
  if (!userRoot) {
    deps.notify("未找到可写的用户档目录（roots 无 user 根）", "error");
    return;
  }
  const res = deleteUserProfile(
    { fs: deps.fs, dir: userRoot.dir, packageDirs },
    rawName,
  );
  const backup = basename(res.backupPath);
  const restored = res.restoredPackageProfile ? "，已恢复为同名内置档" : "";
  deps.notify(`已删除用户档 "${res.name}"（备份 ${backup}）${restored}`, "info");
}

async function switchTo(name: string, set: ProfileSet, deps: CommandDeps): Promise<void> {
  const result = applyProfile(
    { fs: deps.fs, settingsPath: deps.settingsPath, set },
    name,
  );
  if (!result.changed) {
    deps.notify("已是当前档；内容一致，未写入、未备份", "info");
  } else {
    const backup = result.backupPath ? basename(result.backupPath) : "无";
    deps.notify(
      `已切换到档 "${name}"（备份 ${backup}）；下一次启动 subagent 生效，无需 /reload`,
      "info",
    );
  }
}

/** runSubprofile 永不抛出（全部 catch），并在 finally 中恰好调用一次 onAfterCommand。 */
export async function runSubprofile(args: string, deps: CommandDeps): Promise<void> {
  try {
    const trimmed = args.trim();
    if (trimmed === "help" || trimmed === "-h" || trimmed === "--help") {
      deps.notify(USAGE, "info");
      return;
    }
    const parts = trimmed === "" ? [] : trimmed.split(/\s+/);

    if (parts[0] === "delete" || parts[0] === "rm") {
      if (parts.length === 1) {
        deps.notify(`请指定要删除的档名：/subprofile delete <name>\n${USAGE}`, "warning");
        return;
      }
      if (parts.length > 2) {
        deps.notify(`参数过多：${USAGE}`, "warning");
        return;
      }
      deleteProfileCmd(parts[1]!, deps);
      return;
    }

    if (parts.length > 1) {
      deps.notify(`参数过多：${USAGE}`, "warning");
      return;
    }

    const set = loadProfiles({ fs: deps.fs, roots: deps.roots });

    if (trimmed === "list" || trimmed === "ls") {
      const dir = set.usedDir?.dir ?? "（未找到）";
      const source = set.usedDir?.source ?? "—";
      deps.notify(`档目录：${dir} (${source})`, "info");
      const current = detectCurrentProfile({
        fs: deps.fs,
        settingsPath: deps.settingsPath,
        set,
      });
      for (const p of set.profiles) {
        const mark = current.matched && current.name === p.name ? "●" : "  ";
        deps.notify(
          `${mark} ${p.name} — ${p.summary.defaultModel ?? "—"} (${p.summary.overrideCount} overrides)`,
          "info",
        );
      }
      for (const e of set.errors) deps.notify(e.message, "warning");
      return;
    }

    if (trimmed === "new" || trimmed === "edit") {
      await deps.openConfigWizard(trimmed);
      return;
    }

    if (trimmed === "") {
      if (set.profiles.length === 0) {
        deps.notify(
          `${USAGE}\n未找到档目录：请创建 ~/.pi/agent/subagent-profiles/*.json 或使用包内 profiles/。`,
          "warning",
        );
        for (const e of set.errors) deps.notify(e.message, "warning");
        return;
      }
      for (const e of set.errors) deps.notify(e.message, "warning");
      const current = detectCurrentProfile({
        fs: deps.fs,
        settingsPath: deps.settingsPath,
        set,
      });
      const picked = await deps.openSelector({
        profiles: set.profiles,
        current,
        errors: set.errors,
      });
      if (picked === undefined) return;
      if (picked.kind === "switch") {
        await switchTo(picked.name, set, deps);
        return;
      }
      if (picked.kind === "delete") {
        const target = set.profiles.find((p) => p.name === picked.name);
        if (target && target.source === "package") {
          deps.notify(`档 "${picked.name}" 是内置只读档，不能删除`, "warning");
          return;
        }
        if (deps.confirmDelete) {
          const ok = await deps.confirmDelete(picked.name);
          if (!ok) {
            deps.notify("已取消删除", "info");
            return;
          }
        }
        deleteProfileCmd(picked.name, deps);
        return;
      }
      await deps.openConfigWizard(picked.kind);
      return;
    }

    await switchTo(trimmed, set, deps);
  } catch (e) {
    if (
      e instanceof ProfileError ||
      e instanceof SettingsStoreError ||
      e instanceof ProfileStoreError
    ) {
      deps.notify(e.message, "error");
    } else {
      deps.notify(`/subprofile 失败：${errMsg(e)}`, "error");
    }
  } finally {
    try {
      deps.onAfterCommand();
    } catch {
      // 回调自身异常也吞掉
    }
  }
}

/** 供 getArgumentCompletions：按 prefix 过滤档名，new/edit/delete/list 子命令放最后。 */
export function completeProfiles(
  prefix: string,
  deps: { fs: FsLike; roots: readonly ProfileRoot[] },
): Array<{ value: string; label: string; description?: string }> {
  const set = loadProfiles({ fs: deps.fs, roots: deps.roots });
  const deleteMatch = prefix.match(/^(delete|rm)\s+(.*)$/i);
  if (deleteMatch) {
    const cmd = deleteMatch[1]!;
    const argPrefix = deleteMatch[2]!;
    return set.profiles
      .filter((p) => p.source === "user" && p.name.startsWith(argPrefix))
      .map((p) => ({
        value: `${cmd} ${p.name}`,
        label: p.name,
        description: p.summary.defaultModel,
      }));
  }

  const items = set.profiles
    .filter((p) => p.name.startsWith(prefix))
    .map((p) => ({
      value: p.name,
      label: p.name,
      description: p.summary.defaultModel,
    }));
  if ("new".startsWith(prefix) || prefix === "") {
    items.push({ value: "new", label: "new", description: "新建档向导" });
  }
  if ("edit".startsWith(prefix) || prefix === "") {
    items.push({ value: "edit", label: "edit", description: "修改档向导" });
  }
  if ("delete".startsWith(prefix) || prefix === "") {
    items.push({ value: "delete", label: "delete", description: "删除用户档" });
  }
  if ("rm".startsWith(prefix) && prefix !== "") {
    items.push({ value: "rm", label: "rm", description: "删除用户档" });
  }
  if ("list".startsWith(prefix) || prefix === "") {
    items.push({ value: "list", label: "list", description: "列出所有档与当前档" });
  }
  return items;
}

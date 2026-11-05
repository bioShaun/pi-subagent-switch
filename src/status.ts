import type { FsLike } from "./fs.ts";
import type { ProfileRoot, ProfileSet } from "./profiles.ts";
import { loadProfiles } from "./profiles.ts";
import { detectCurrentProfile } from "./current-profile.ts";
import type { CurrentProfile } from "./current-profile.ts";

export const STATUS_KEY = "pi-subagent-switch";

export interface StatusUI {
  readonly hasUI: boolean;
  setStatus(key: string, text: string | undefined): void;
}

/** 纯函数：subagents: <name> / subagents: custom / subagents: 无档。 */
export function statusLabel(current: CurrentProfile, set: ProfileSet): string {
  if (set.profiles.length === 0) return "subagents: 无档";
  return `subagents: ${current.name}`;
}

/**
 * 每次从 roots 重新加载档，再检测当前档并写状态栏，避免手改档文件后使用过期 ProfileSet。
 * hasUI=false 时直接返回；检测异常降级 subagents: ?；setStatus 自身异常也吞掉，绝不抛出。
 */
export function refreshStatus(
  deps: { fs: FsLike; settingsPath: string; roots: readonly ProfileRoot[] },
  ui: StatusUI,
): CurrentProfile | undefined {
  if (!ui.hasUI) return undefined;
  let current: CurrentProfile | undefined;
  let label: string;
  try {
    const set = loadProfiles({ fs: deps.fs, roots: deps.roots });
    current = detectCurrentProfile({
      fs: deps.fs,
      settingsPath: deps.settingsPath,
      set,
    });
    label = statusLabel(current, set);
  } catch {
    label = "subagents: ?";
  }
  try {
    ui.setStatus(STATUS_KEY, label);
  } catch {
    return undefined;
  }
  return current;
}

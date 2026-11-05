import type { FsLike } from "./fs.ts";
import { formatStamp } from "./fs.ts";
import type { ProfileSet } from "./profiles.ts";
import { findProfile } from "./profiles.ts";
import { validateSubagents } from "./schema.ts";
import { stableStringify } from "./stable-json.ts";
import { readSettings, withSubagents, writeSettings } from "./settings-store.ts";

export interface ApplyDeps {
  fs: FsLike;
  settingsPath: string;
  set: ProfileSet;
  now?: () => Date;
}
export interface ApplyResult {
  readonly name: string;
  readonly changed: boolean;
  readonly overrideCount: number;
  readonly defaultModel: string | undefined;
  readonly backupPath: string | undefined;
}

/** 抛 ProfileError（找不到档 / 校验失败）或 SettingsStoreError（读写失败、并发冲突）。 */
export function applyProfile(deps: ApplyDeps, name: string): ApplyResult {
  const { fs, settingsPath, set } = deps;
  const profile = findProfile(set, name);
  // 双保险：档可能在 load 后被手改
  const summary = validateSubagents(profile.value, name);
  const snapshot = readSettings(fs, settingsPath);

  const currentSub = snapshot.doc["subagents"];
  if (
    currentSub !== undefined &&
    stableStringify(currentSub) === stableStringify(profile.value)
  ) {
    return {
      name,
      changed: false,
      overrideCount: summary.overrideCount,
      defaultModel: summary.defaultModel,
      backupPath: undefined,
    };
  }

  const next = withSubagents(snapshot.doc, profile.value);
  const stamp = formatStamp((deps.now ?? (() => new Date()))());
  const { backupPath } = writeSettings(fs, settingsPath, next, { snapshot, stamp });
  return {
    name,
    changed: true,
    overrideCount: summary.overrideCount,
    defaultModel: summary.defaultModel,
    backupPath,
  };
}

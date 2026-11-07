import type { FsLike } from "./fs.ts";
import { formatStamp } from "./fs.ts";
import type { ProfileSet, SubagentsValue } from "./profiles.ts";
import { findProfile } from "./profiles.ts";
import { ProfileError, validateSubagents } from "./schema.ts";
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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 抛 ProfileError（找不到档 / 校验失败）或 SettingsStoreError（读写失败、并发冲突）。 */
export function applyProfile(deps: ApplyDeps, name: string): ApplyResult {
  const { fs, settingsPath, set } = deps;
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
  // 双保险：档可能在 load 后被手改
  const summary = validateSubagents(profileValue, profile.name);
  const snapshot = readSettings(fs, settingsPath);

  const currentSub = snapshot.doc["subagents"];
  if (
    currentSub !== undefined &&
    stableStringify(currentSub) === stableStringify(profileValue)
  ) {
    return {
      name,
      changed: false,
      overrideCount: summary.overrideCount,
      defaultModel: summary.defaultModel,
      backupPath: undefined,
    };
  }

  const next = withSubagents(snapshot.doc, profileValue);
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

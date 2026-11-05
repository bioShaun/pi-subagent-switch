import type { FsLike } from "./fs.ts";
import type { ProfileSet } from "./profiles.ts";
import { stableStringify } from "./stable-json.ts";
import { readSettings } from "./settings-store.ts";

export interface CurrentProfile {
  readonly name: string;
  readonly matched: boolean;
  readonly detail: string | undefined;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 用稳定序列化后的内容深比较推导当前档；本函数永不抛错（错误文本进 detail）。 */
export function detectCurrentProfile(opts: {
  fs: FsLike;
  settingsPath: string;
  set: ProfileSet;
}): CurrentProfile {
  const { fs, settingsPath, set } = opts;
  try {
    const snap = readSettings(fs, settingsPath);
    const current = snap.doc["subagents"];
    if (current === undefined) {
      return { name: "custom", matched: false, detail: undefined };
    }
    const key = stableStringify(current);
    const matches = set.profiles.filter((p) => stableStringify(p.value) === key);
    if (matches.length === 0) {
      const sub = current as Record<string, unknown>;
      const dm = sub["defaultModel"];
      return {
        name: "custom",
        matched: false,
        detail: typeof dm === "string" ? dm : undefined,
      };
    }
    const sorted = [...matches].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    const winner = sorted[0]!;
    const dupNames = sorted.slice(1).map((p) => p.name);
    const detail = dupNames.length > 0
      ? `${winner.path}（重复档：${dupNames.join(", ")}）`
      : winner.path;
    return { name: winner.name, matched: true, detail };
  } catch (e) {
    return { name: "custom", matched: false, detail: `检测失败：${errMsg(e)}` };
  }
}

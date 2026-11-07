import { join } from "node:path";
import type { FsLike } from "./fs.ts";
import { validateSubagents, ProfileError } from "./schema.ts";
import type { SubagentsSummary } from "./schema.ts";

export interface SubagentsValue {
  [key: string]: unknown;
}
export interface Profile {
  readonly name: string;
  readonly path: string;
  readonly value: SubagentsValue;
  readonly summary: SubagentsSummary;
  readonly source: "user" | "package";
}
export interface ProfileRoot {
  readonly dir: string;
  readonly source: "user" | "package";
}
export interface ProfileSet {
  readonly profiles: Profile[];
  readonly errors: ProfileError[];
  readonly dirs: readonly ProfileRoot[];
}
export interface LoadDeps {
  fs: FsLike;
  roots: readonly ProfileRoot[];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function stem(file: string): string {
  return file.replace(/\.json$/i, "");
}
function asProfileError(e: unknown, name: string): ProfileError {
  if (e instanceof ProfileError) return e;
  return new ProfileError("unreadable", `档 "${name}": ${errMsg(e)}`, { profile: name });
}

/** 候选目录，按优先级返回：env 覆盖（trim 非空）→ 仅该目录、不回退；否则 [user, package]。 */
export function resolveProfileDirs(opts: {
  agentDir: string;
  packageRoot: string;
  env: Record<string, string | undefined>;
}): ProfileRoot[] {
  const envDir = opts.env.PI_SUBAGENT_PROFILES_DIR?.trim();
  if (envDir) return [{ dir: envDir, source: "user" }];
  return [
    { dir: join(opts.agentDir, "subagent-profiles"), source: "user" },
    { dir: join(opts.packageRoot, "profiles"), source: "package" },
  ];
}

/** 插件只读档目录：本文件内不得出现任何 write/rename/unlink 调用。 */
export function loadProfiles(deps: LoadDeps): ProfileSet {
  const { fs, roots } = deps;
  const errors: ProfileError[] = [];
  const loaded: Profile[] = [];
  const seenNames = new Set<string>();

  for (const root of roots) {
    // existsSync 抛错属异常，向上冒泡（refreshStatus 借此降级为 "subagents: ?"）；
    // 目录不存在（false）或 readdirSync 抛错则视为「无档」，继续下一个候选。
    if (!fs.existsSync(root.dir)) continue;
    let names: string[];
    try {
      names = fs.readdirSync(root.dir).filter(
        (f) => /\.json$/i.test(f) && !f.startsWith("."),
      );
    } catch {
      continue;
    }
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
      } catch (e) {
        errors.push(asProfileError(e, name));
      }
    }
  }
  loaded.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { profiles: loaded, errors, dirs: roots };
}

/** 名字大小写敏感；允许省略 ".json"；同名损坏档抛原始错误，完全不存在才 not-found。 */
export function findProfile(set: ProfileSet, name: string): Profile {
  const wanted = stem(name);
  const found = set.profiles.find((p) => p.name === wanted);
  if (found) return found;
  const broken = set.errors.find((e) => e.profile === wanted);
  if (broken) throw broken;
  const available = set.profiles.map((p) => p.name).join(", ");
  throw new ProfileError(
    "not-found",
    `未找到档 "${wanted}"；可用：${available || "（无）"}`,
    { profile: wanted },
  );
}

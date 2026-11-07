import { join } from "node:path";
import type { FsLike } from "./fs.ts";
import { formatStamp, writeBackupFile } from "./fs.ts";
import type { SubagentsValue } from "./profiles.ts";
import { ProfileError, validateSubagents } from "./schema.ts";

/** 用户档写入失败（目录缺失且无法创建、档名非法等）。 */
export class ProfileStoreError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "ProfileStoreError";
  }
}

export const PROFILE_NAME_MAX = 64;

/** 合法档名：a-z 0-9 . _ -，且至少含一个字母或数字（排除 "." / ".." / "---"）。 */
const NAME_RE = /^(?=.*[a-z0-9])[a-z0-9._-]+$/;

export interface NameResult {
  readonly ok: boolean;
  readonly name?: string;
  readonly msg?: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 档名规范化（对齐已验收原型）：trim → 小写 → 非法字符折叠成 "-" → 去重 "-" →
 * 去首尾 -/.；空结果或超过 PROFILE_NAME_MAX → ok:false。
 */
export function normalizeProfileName(raw: string): NameResult {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!s) return { ok: false, msg: "档名不能为空或全是非法字符" };
  if (s.length > PROFILE_NAME_MAX) {
    return { ok: false, msg: `档名过长（>${PROFILE_NAME_MAX}）` };
  }
  return { ok: true, name: s };
}

/** 校验最终档名；非法抛 ProfileStoreError。 */
export function assertProfileName(name: string): void {
  if (typeof name !== "string" || !NAME_RE.test(name) || name.length > PROFILE_NAME_MAX) {
    throw new ProfileStoreError(
      `非法档名 "${name}"：仅允许 a-z 0-9 . _ -，长度 ≤ ${PROFILE_NAME_MAX}`,
    );
  }
}

/** 重名处理：base、base-2、base-3…；返回最终名与是否加了后缀。 */
export function dedupeProfileName(
  base: string,
  taken: ReadonlySet<string>,
): { name: string; changed: boolean } {
  if (!taken.has(base)) return { name: base, changed: false };
  for (let i = 2; ; i++) {
    const name = `${base}-${i}`;
    if (!taken.has(name)) return { name, changed: true };
  }
}

export interface SaveProfileResult {
  readonly path: string;
  /** 备份文件绝对路径（仅当目标文件已存在）；内容 = 写入前原始字节，mode 0o600。 */
  readonly backupPath: string | undefined;
  readonly bytes: number;
}

/**
 * 安全写入用户档（仅此模块写档文件；包内档永不写）：
 * 档名校验 → schema 校验 → 目录缺失则递归 mkdir（无 mkdirSync → ProfileStoreError）→
 * 目标已存在则先备份原始字节（`<path>.bak-<stamp>`，flag:"wx"，0o600）→
 * 同目录临时文件（flag:"wx"；新档 0o600，覆盖旧档保留原 mode）→ renameSync 覆盖，
 * 失败清理临时文件后重抛。序列化格式 JSON.stringify(value, null, 2) + "\n"。
 * 不做并发指纹比对：与 settings-store 相同的尽力原子写，不扩大并发承诺。
 */
export function saveUserProfile(
  deps: { fs: FsLike; dir: string; now?: () => Date; maxBackups?: number },
  name: string,
  value: SubagentsValue,
): SaveProfileResult {
  const { fs, dir } = deps;
  assertProfileName(name);
  validateSubagents(value, name); // ProfileError 原样上抛，此时零写入

  if (!fs.existsSync(dir)) {
    if (typeof fs.mkdirSync !== "function") {
      throw new ProfileStoreError(`档目录不存在且当前环境无法创建：${dir}`);
    }
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      throw new ProfileStoreError(`无法创建档目录 ${dir}：${errMsg(e)}`);
    }
  }

  const target = join(dir, `${name}.json`);
  const existed = fs.existsSync(target);
  const raw = existed ? fs.readFileSync(target) : undefined;
  let mode = 0o600;
  if (existed) {
    try {
      mode = fs.statSync(target).mode & 0o777;
    } catch {
      mode = 0o600;
    }
  }

  let backupPath: string | undefined;
  if (existed) {
    const stamp = formatStamp((deps.now ?? (() => new Date()))());
    backupPath = writeBackupFile(
      fs,
      target,
      raw ?? Buffer.alloc(0),
      stamp,
      deps.maxBackups,
    );
  }

  const data = JSON.stringify(value, null, 2) + "\n";
  const tmp = join(
    dir,
    `.${name}.json.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, data, { flag: "wx", mode });
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 清理失败不覆盖原错误
    }
    throw e;
  }

  return { path: target, backupPath, bytes: Buffer.byteLength(data) };
}

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
): DeleteProfileResult {
  const clean = name.trim().replace(/\.json$/i, "");
  assertProfileName(clean);

  const target = join(deps.dir, `${clean}.json`);
  const exists = deps.fs.existsSync(target);
  if (!exists) {
    const isPackageProfile = (deps.packageDirs ?? []).some((d) =>
      deps.fs.existsSync(join(d, `${clean}.json`)),
    );
    if (isPackageProfile) {
      throw new ProfileStoreError(`档 "${clean}" 是内置只读档，不能删除`);
    }
    throw new ProfileError("not-found", `未找到用户档 "${clean}"`, { profile: clean });
  }

  const raw = deps.fs.readFileSync(target);
  const stamp = formatStamp((deps.now ?? (() => new Date()))());
  const backupPath = writeBackupFile(
    deps.fs,
    target,
    raw,
    stamp,
    deps.maxBackups,
  );
  deps.fs.unlinkSync(target);

  const restoredPackageProfile = (deps.packageDirs ?? []).some((d) =>
    deps.fs.existsSync(join(d, `${clean}.json`)),
  );

  return {
    name: clean,
    path: target,
    backupPath,
    restoredPackageProfile,
  };
}

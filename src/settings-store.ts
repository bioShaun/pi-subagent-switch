import { dirname, basename, join } from "node:path";
import { sha256 } from "./fs.ts";
import type { FsLike } from "./fs.ts";
import type { SubagentsValue } from "./profiles.ts";

export const ABSENT_FINGERPRINT = "absent";

export class SettingsStoreError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "SettingsStoreError";
  }
}

export interface SettingsSnapshot {
  readonly doc: Record<string, unknown>;
  readonly existed: boolean;
  readonly fingerprint: string;
  readonly raw: Buffer | undefined;
  readonly mode: number | undefined;
}
export interface WriteResult {
  readonly fingerprint: string;
  readonly backupPath: string | undefined;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 读取并解析；非法 JSON / 非对象根 → 抛 SettingsStoreError。缺文件 → existed:false, doc:{}。 */
export function readSettings(fs: FsLike, path: string): SettingsSnapshot {
  if (!fs.existsSync(path)) {
    return {
      doc: {},
      existed: false,
      fingerprint: ABSENT_FINGERPRINT,
      raw: undefined,
      mode: undefined,
    };
  }
  const raw = fs.readFileSync(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    throw new SettingsStoreError(
      `settings.json 解析失败：${errMsg(e)}；已中止，未做任何写入`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsStoreError("settings.json 顶层必须是对象；已中止，未做任何写入");
  }
  let mode: number | undefined;
  try {
    mode = fs.statSync(path).mode & 0o777;
  } catch {
    mode = undefined;
  }
  return {
    doc: parsed as Record<string, unknown>,
    existed: true,
    fingerprint: sha256(raw),
    raw,
    mode,
  };
}

/** structuredClone(doc) 后仅替换顶层 subagents 键（整块替换，不是合并）；不修改入参。 */
export function withSubagents(
  doc: Record<string, unknown>,
  subagents: SubagentsValue,
): Record<string, unknown> {
  const next = structuredClone(doc) as Record<string, unknown>;
  next.subagents = structuredClone(subagents);
  return next;
}

export function backupPathFor(path: string, stamp: string): string {
  return `${path}.bak-${stamp}`;
}

/** 备份 + 原子写；序列化格式 JSON.stringify(doc, null, 2) + "\n"。 */
export function writeSettings(
  fs: FsLike,
  path: string,
  doc: Record<string, unknown>,
  opts: { snapshot: SettingsSnapshot; stamp: string },
): WriteResult {
  const { snapshot, stamp } = opts;

  // 1) 重新读取磁盘（write 时刻的真相）
  const exists = fs.existsSync(path);
  if (snapshot.existed && !exists) {
    throw new SettingsStoreError("settings.json 在操作期间消失，已中止；请重试");
  }
  const currentRaw = exists ? fs.readFileSync(path) : undefined;
  const currentFingerprint = currentRaw === undefined
    ? ABSENT_FINGERPRINT
    : sha256(currentRaw);

  // 2) 指纹比对（尽力并发检测；比对与 rename 之间仍有极小竞争窗口）
  if (currentFingerprint !== snapshot.fingerprint) {
    throw new SettingsStoreError("settings.json 在操作期间被修改，已中止；请重试");
  }

  // 3) 备份：内容 = 步骤 1 的原始字节，mode 固定 0o600，flag wx（同秒冲突即报错）
  const backupPath = backupPathFor(path, stamp);
  if (snapshot.existed) {
    fs.writeFileSync(
      backupPath,
      currentRaw ?? snapshot.raw ?? Buffer.alloc(0),
      { flag: "wx", mode: 0o600 },
    );
  }

  // 4) 同目录临时文件（flag wx，mode 保留原 mode 默认 0o600）→ rename 覆盖
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  const data = JSON.stringify(doc, null, 2) + "\n";
  try {
    fs.writeFileSync(tmp, data, { flag: "wx", mode: snapshot.mode ?? 0o600 });
    fs.renameSync(tmp, path);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 清理失败不覆盖原错误
    }
    throw e;
  }

  return {
    fingerprint: sha256(data),
    backupPath: snapshot.existed ? backupPath : undefined,
  };
}

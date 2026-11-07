import { createHash } from "node:crypto";
import { dirname, basename, join } from "node:path";

/** 可注入的假 fs（照 pi-subagent-cfg/test/settings-file.test.ts:37-60 的做法）。 */
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
  /** 可选：仅配置向导在「用户档目录缺失」时用到；无此方法且目录缺失 → 写档报错。 */
  mkdirSync?(path: string, options?: { recursive?: boolean; mode?: number }): void;
  /** 可选：解析符号链接真实路径，使 writeSettings 保留软链接。 */
  realpathSync?(path: string): string;
}

export const DEFAULT_MAX_BACKUPS = 5;

function parseBackupSuffix(rest: string): { stamp: string; seq: number } {
  const m1 = rest.match(/^(\d{8}-\d{6})(?:-(\d+))?$/);
  if (m1) {
    return { stamp: m1[1]!, seq: m1[2] !== undefined ? parseInt(m1[2]!, 10) : 0 };
  }
  const m2 = rest.match(/^(.*)-(\d+)$/);
  if (m2) {
    return { stamp: m2[1]!, seq: parseInt(m2[2]!, 10) };
  }
  return { stamp: rest, seq: 0 };
}

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
  maxBackups: number = DEFAULT_MAX_BACKUPS,
): string {
  const base = `${targetPath}.bak-${stamp}`;
  let writtenPath = "";
  for (let i = 0; ; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    if (fs.existsSync(candidate)) continue;
    try {
      fs.writeFileSync(candidate, raw, { flag: "wx", mode: 0o600 });
      writtenPath = candidate;
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "EEXIST") continue;
      throw e;
    }
  }

  try {
    if (
      maxBackups > 0 &&
      typeof fs.readdirSync === "function" &&
      typeof fs.unlinkSync === "function"
    ) {
      const dir = dirname(targetPath);
      const prefix = `${basename(targetPath)}.bak-`;
      const backups = fs.readdirSync(dir).filter((f) => f.startsWith(prefix));
      backups.sort((a, b) => {
        const pa = parseBackupSuffix(a.slice(prefix.length));
        const pb = parseBackupSuffix(b.slice(prefix.length));
        if (pa.stamp !== pb.stamp) {
          return pa.stamp < pb.stamp ? -1 : 1;
        }
        return pa.seq - pb.seq;
      });
      if (backups.length > maxBackups) {
        const toRemove = backups.slice(0, backups.length - maxBackups);
        for (const f of toRemove) {
          try {
            fs.unlinkSync(join(dir, f));
          } catch {}
        }
      }
    }
  } catch {}

  return writtenPath;
}

/** "YYYYMMDD-HHmmss"（本地时区）。 */
export function formatStamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "-" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/** sha256 十六进制。 */
export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

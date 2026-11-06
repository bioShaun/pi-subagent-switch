import { createHash } from "node:crypto";

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

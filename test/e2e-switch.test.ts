import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import { applyProfile } from "../src/apply-profile.ts";
import { loadProfiles } from "../src/profiles.ts";
import { readSettings, writeSettings, SettingsStoreError } from "../src/settings-store.ts";

const fs = nodeFs as unknown as FsLike;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "20261106-0009-subagent-switch-implementation");
const FIXTURE = join(ROOT, "test", "fixtures", "settings.sample.json");
const PROFILES = join(ROOT, "profiles");

function tmp(label: string): string {
  nodeFs.mkdirSync(TMP, { recursive: true });
  return nodeFs.mkdtempSync(join(TMP, `${label}-`));
}
const set = loadProfiles({ fs, roots: [{ dir: PROFILES, source: "package" }] });

test("文件层端到端：整块替换 / 顶层值保留 / 备份 / mode / 同档不写盘", () => {
  const dir = tmp("e2e");
  const settingsPath = join(dir, "settings.json");
  nodeFs.copyFileSync(FIXTURE, settingsPath);
  nodeFs.chmodSync(settingsPath, 0o600);
  const beforeRaw = nodeFs.readFileSync(settingsPath).toString("utf8");
  const beforeDoc = JSON.parse(beforeRaw) as Record<string, unknown>;
  let t = 0;
  const now = (): Date => new Date(2026, 10, 6, 3, 0, t++);

  // 1) fixture 的 subagents 已是 gpt → changed:false，不写盘、不备份
  const r0 = applyProfile({ fs, settingsPath, set, now }, "gpt");
  assert.equal(r0.changed, false);
  assert.equal(nodeFs.readdirSync(dir).length, 1);

  // 2) kimi → changed:true，备份存在
  const r1 = applyProfile({ fs, settingsPath, set, now }, "kimi");
  assert.equal(r1.changed, true);
  assert.ok(r1.backupPath);
  // 3) 备份逐字节等于切换前
  assert.equal(nodeFs.readFileSync(r1.backupPath!, "utf8"), beforeRaw);
  // 7) 备份 0o600
  assert.equal(nodeFs.statSync(r1.backupPath!).mode & 0o777, 0o600);

  const kimi = JSON.parse(nodeFs.readFileSync(join(PROFILES, "kimi.json"), "utf8"));
  const gpt = JSON.parse(nodeFs.readFileSync(join(PROFILES, "gpt.json"), "utf8"));
  const after1 = JSON.parse(nodeFs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  // 4) 整块替换：与 kimi 档 deepStrictEqual，原 gpt 独有的 agent 消失
  assert.deepStrictEqual(after1.subagents, kimi);
  // 5) 其它顶层键的 JSON 值零丢失、零改写
  const a = { ...after1 };
  delete a.subagents;
  const b = { ...beforeDoc };
  delete b.subagents;
  assert.deepStrictEqual(a, b);
  // 7) settings mode 保留
  assert.equal(nodeFs.statSync(settingsPath).mode & 0o777, 0o600);

  // 6) 同档二次调用 changed:false，不新增备份
  const backups1 = nodeFs.readdirSync(dir).filter((n) => n.includes(".bak-")).length;
  const r2 = applyProfile({ fs, settingsPath, set, now }, "kimi");
  assert.equal(r2.changed, false);
  assert.equal(r2.backupPath, undefined);
  assert.equal(nodeFs.readdirSync(dir).filter((n) => n.includes(".bak-")).length, backups1);

  // 6) 再切 gpt → 与 gpt 档 deepStrictEqual
  const r3 = applyProfile({ fs, settingsPath, set, now }, "gpt");
  assert.equal(r3.changed, true);
  const after3 = JSON.parse(nodeFs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  assert.deepStrictEqual(after3.subagents, gpt);
});

test("并发修改检测：读快照后手改文件 → writeSettings 抛 SettingsStoreError 且内容保留", () => {
  const dir = tmp("e2econflict");
  const p = join(dir, "settings.json");
  nodeFs.copyFileSync(FIXTURE, p);
  const snapshot = readSettings(fs, p);
  const tampered = '{"subagents":{"a":2},"theme":"hacked"}';
  nodeFs.writeFileSync(p, tampered);
  assert.throws(
    () => writeSettings(fs, p, { subagents: { b: 3 } }, { snapshot, stamp: "stamp" }),
    SettingsStoreError,
  );
  assert.equal(nodeFs.readFileSync(p, "utf8"), tampered);
});

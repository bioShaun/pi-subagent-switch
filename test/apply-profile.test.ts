import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import { applyProfile } from "../src/apply-profile.ts";
import { loadProfiles } from "../src/profiles.ts";
import { ProfileError } from "../src/schema.ts";

const fs = nodeFs as unknown as FsLike;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "20261106-0009-subagent-switch-implementation");

function tmp(label: string): string {
  nodeFs.mkdirSync(TMP, { recursive: true });
  return nodeFs.mkdtempSync(join(TMP, `${label}-`));
}
function put(dir: string, name: string, content: string): void {
  nodeFs.mkdirSync(dir, { recursive: true });
  nodeFs.writeFileSync(join(dir, name), content);
}
const KIMI = {
  defaultModel: "kimi-coding/k3.1-pro",
  agentOverrides: { worker: { model: "kimi-coding/k3.1-pro" } },
};
let clock = 0;
const now = (): Date => new Date(2026, 10, 6, 1, 2, 3 + clock++);

test("整块替换 + 其它顶层键深相等 + 备份存在且逐字节等于切换前", () => {
  const d = tmp("apply");
  put(d, "kimi.json", JSON.stringify(KIMI));
  const settingsPath = join(d, "settings.json");
  const before = {
    theme: "dark",
    packages: ["a"],
    compaction: { enabled: true },
    enabledModels: ["m"],
    defaultTools: ["read"],
    subagents: { defaultModel: "old", agentOverrides: { ghost: { model: "x" } } },
  };
  const raw = JSON.stringify(before);
  nodeFs.writeFileSync(settingsPath, raw);
  const set = loadProfiles({ fs, roots: [{ dir: d, source: "user" }] });
  const res = applyProfile({ fs, settingsPath, set, now }, "kimi");
  assert.equal(res.name, "kimi");
  assert.equal(res.changed, true);
  assert.equal(res.overrideCount, 1);
  assert.equal(res.defaultModel, "kimi-coding/k3.1-pro");
  assert.ok(res.backupPath);
  assert.equal(nodeFs.readFileSync(res.backupPath!, "utf8"), raw);

  const after = JSON.parse(nodeFs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  assert.deepEqual(after.subagents, KIMI); // 整块替换：ghost 消失
  const b = { ...before } as Record<string, unknown>;
  delete b.subagents;
  const a = { ...after };
  delete a.subagents;
  assert.deepEqual(a, b); // 其它顶层键 JSON 值零丢失、零改写
});

test("同档二次调用 changed:false，不写盘、不新增备份", () => {
  const d = tmp("noop");
  put(d, "kimi.json", JSON.stringify(KIMI));
  const settingsPath = join(d, "settings.json");
  nodeFs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark", subagents: { old: 1 } }));
  const set = loadProfiles({ fs, roots: [{ dir: d, source: "user" }] });
  const r1 = applyProfile({ fs, settingsPath, set, now }, "kimi");
  assert.equal(r1.changed, true);
  const backups1 = nodeFs.readdirSync(d).filter((n) => n.includes(".bak-"));
  assert.equal(backups1.length, 1);
  const content1 = nodeFs.readFileSync(settingsPath, "utf8");
  const r2 = applyProfile({ fs, settingsPath, set, now }, "kimi");
  assert.equal(r2.changed, false);
  assert.equal(r2.backupPath, undefined);
  assert.equal(nodeFs.readFileSync(settingsPath, "utf8"), content1);
  assert.equal(nodeFs.readdirSync(d).filter((n) => n.includes(".bak-")).length, 1);
});

test("非法档（schema）→ 抛 ProfileError 且不写盘", () => {
  const d = tmp("illegal");
  put(d, "bad.json", JSON.stringify({ agentOverrides: { w: { fallbackModels: [] } } }));
  const settingsPath = join(d, "settings.json");
  const raw = '{"theme":"dark","subagents":{"old":1}}';
  nodeFs.writeFileSync(settingsPath, raw);
  // 同名损坏档会进 errors；findProfile 抛原始错误
  const set = loadProfiles({ fs, roots: [{ dir: d, source: "user" }] });
  assert.throws(() => applyProfile({ fs, settingsPath, set, now }, "bad"), ProfileError);
  assert.equal(nodeFs.readFileSync(settingsPath, "utf8"), raw);
});

test("找不到档 → ProfileError(not-found)，不写盘", () => {
  const d = tmp("notfound");
  put(d, "kimi.json", JSON.stringify(KIMI));
  const settingsPath = join(d, "settings.json");
  const raw = '{"subagents":{"old":1}}';
  nodeFs.writeFileSync(settingsPath, raw);
  const set = loadProfiles({ fs, roots: [{ dir: d, source: "user" }] });
  assert.throws(
    () => applyProfile({ fs, settingsPath, set, now }, "zzz"),
    (e: unknown) => e instanceof ProfileError && e.kind === "not-found",
  );
  assert.equal(nodeFs.readFileSync(settingsPath, "utf8"), raw);
});

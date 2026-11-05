import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import { STATUS_KEY, statusLabel, refreshStatus } from "../src/status.ts";
import { loadProfiles } from "../src/profiles.ts";
import type { ProfileSet } from "../src/profiles.ts";

const fs = nodeFs as unknown as FsLike;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "20261106-0009-subagent-switch-implementation");

function tmp(label: string): string {
  nodeFs.mkdirSync(TMP, { recursive: true });
  return nodeFs.mkdtempSync(join(TMP, `${label}-`));
}
const KIMI = JSON.stringify({ defaultModel: "kimi-coding/k3.1-pro" });

test("STATUS_KEY 唯一", () => {
  assert.equal(STATUS_KEY, "pi-subagent-switch");
});

test("statusLabel 三分支", () => {
  const d = tmp("label");
  nodeFs.writeFileSync(join(d, "kimi.json"), KIMI);
  const set: ProfileSet = loadProfiles({ fs, roots: [{ dir: d, source: "user" }] });
  assert.equal(
    statusLabel({ name: "kimi", matched: true, detail: undefined }, set),
    "subagents: kimi",
  );
  assert.equal(
    statusLabel({ name: "custom", matched: false, detail: undefined }, set),
    "subagents: custom",
  );
  const empty: ProfileSet = { profiles: [], errors: [], dirs: [], usedDir: undefined };
  assert.equal(
    statusLabel({ name: "custom", matched: false, detail: undefined }, empty),
    "subagents: 无档",
  );
});

test("refreshStatus: hasUI:false 不调 setStatus，返回 undefined", () => {
  const d = tmp("noui");
  nodeFs.writeFileSync(join(d, "kimi.json"), KIMI);
  let calls = 0;
  const ret = refreshStatus(
    { fs, settingsPath: join(d, "settings.json"), roots: [{ dir: d, source: "user" }] },
    { hasUI: false, setStatus: () => { calls++; } },
  );
  assert.equal(calls, 0);
  assert.equal(ret, undefined);
});

test("refreshStatus: 每次重新 loadProfiles（手改档后标签随之变化）", () => {
  const d = tmp("reload");
  nodeFs.writeFileSync(join(d, "kimi.json"), KIMI);
  const settingsPath = join(d, "settings.json");
  nodeFs.writeFileSync(settingsPath, JSON.stringify({ subagents: JSON.parse(KIMI) }));
  const roots = [{ dir: d, source: "user" as const }];
  const texts: Array<string | undefined> = [];
  const ui = { hasUI: true, setStatus: (_k: string, t: string | undefined) => texts.push(t) };
  refreshStatus({ fs, settingsPath, roots }, ui);
  assert.equal(texts.at(-1), "subagents: kimi");
  // 手改 settings 为 custom，并加入一个内容不同的档
  nodeFs.writeFileSync(settingsPath, JSON.stringify({ subagents: { defaultModel: "other/x" } }));
  refreshStatus({ fs, settingsPath, roots }, ui);
  assert.equal(texts.at(-1), "subagents: custom");
  // 删除所有档 → 无档
  nodeFs.unlinkSync(join(d, "kimi.json"));
  refreshStatus({ fs, settingsPath, roots }, ui);
  assert.equal(texts.at(-1), "subagents: 无档");
});

test("refreshStatus: 检测异常降级为 subagents: ?，不外抛", () => {
  const d = tmp("degrade");
  const faultFs = {
    ...(fs as object),
    existsSync: (): boolean => { throw new Error("boom"); },
  } as unknown as FsLike;
  const texts: Array<string | undefined> = [];
  const ret = refreshStatus(
    { fs: faultFs, settingsPath: join(d, "settings.json"), roots: [{ dir: d, source: "user" }] },
    { hasUI: true, setStatus: (_k: string, t: string | undefined) => texts.push(t) },
  );
  assert.equal(texts.at(-1), "subagents: ?");
  assert.equal(ret, undefined);
});

test("refreshStatus: setStatus 自身异常也吞掉、不外抛、返回 undefined", () => {
  const d = tmp("throwui");
  nodeFs.writeFileSync(join(d, "kimi.json"), KIMI);
  const ret = refreshStatus(
    {
      fs,
      settingsPath: join(d, "settings.json"),
      roots: [{ dir: d, source: "user" }],
    },
    { hasUI: true, setStatus: () => { throw new Error("ui boom"); } },
  );
  assert.equal(ret, undefined);
});

test("refreshStatus: 正常时返回 CurrentProfile", () => {
  const d = tmp("return");
  nodeFs.writeFileSync(join(d, "kimi.json"), KIMI);
  nodeFs.writeFileSync(join(d, "settings.json"), JSON.stringify({ subagents: JSON.parse(KIMI) }));
  const ret = refreshStatus(
    {
      fs,
      settingsPath: join(d, "settings.json"),
      roots: [{ dir: d, source: "user" }],
    },
    { hasUI: true, setStatus: () => {} },
  );
  assert.equal(ret?.name, "kimi");
  assert.equal(ret?.matched, true);
});

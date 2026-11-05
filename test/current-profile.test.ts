import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import { detectCurrentProfile } from "../src/current-profile.ts";
import { loadProfiles } from "../src/profiles.ts";
import type { ProfileSet } from "../src/profiles.ts";

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
function setFor(dir: string): ProfileSet {
  return loadProfiles({ fs, roots: [{ dir, source: "user" }] });
}
const SAME = JSON.stringify({ defaultModel: "m/x", agentOverrides: { w: { model: "m/y" } } });

test("命中唯一档 → matched:true，detail 为档文件路径", () => {
  const d = tmp("hit");
  put(d, "kimi.json", SAME);
  const settingsPath = join(d, "settings.json");
  nodeFs.writeFileSync(settingsPath, JSON.stringify({
    theme: "dark", subagents: JSON.parse(SAME),
  }));
  const c = detectCurrentProfile({ fs, settingsPath, set: setFor(d) });
  assert.equal(c.name, "kimi");
  assert.equal(c.matched, true);
  assert.match(c.detail ?? "", /kimi\.json/);
});

test("键序无关命中（稳定序列化比较）", () => {
  const d = tmp("keyorder");
  put(d, "kimi.json", SAME);
  const settingsPath = join(d, "settings.json");
  const value = JSON.parse(SAME);
  nodeFs.writeFileSync(settingsPath, JSON.stringify({
    subagents: { agentOverrides: value.agentOverrides, defaultModel: value.defaultModel },
  }));
  const c = detectCurrentProfile({ fs, settingsPath, set: setFor(d) });
  assert.equal(c.name, "kimi");
  assert.equal(c.matched, true);
});

test("未命中 → custom，detail 为 settings 的 defaultModel", () => {
  const d = tmp("miss");
  put(d, "kimi.json", SAME);
  const settingsPath = join(d, "settings.json");
  nodeFs.writeFileSync(settingsPath, JSON.stringify({
    subagents: { defaultModel: "other/x" },
  }));
  const c = detectCurrentProfile({ fs, settingsPath, set: setFor(d) });
  assert.equal(c.name, "custom");
  assert.equal(c.matched, false);
  assert.match(c.detail ?? "", /other\/x/);
});

test("无 subagents 键 → custom", () => {
  const d = tmp("nosub");
  put(d, "kimi.json", SAME);
  const settingsPath = join(d, "settings.json");
  nodeFs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
  const c = detectCurrentProfile({ fs, settingsPath, set: setFor(d) });
  assert.equal(c.name, "custom");
  assert.equal(c.matched, false);
});

test("settings 损坏 JSON → 永不抛错，custom + 错误摘要进 detail", () => {
  const d = tmp("corruptsettings");
  put(d, "kimi.json", SAME);
  const settingsPath = join(d, "settings.json");
  nodeFs.writeFileSync(settingsPath, "{ broken");
  const c = detectCurrentProfile({ fs, settingsPath, set: setFor(d) });
  assert.equal(c.name, "custom");
  assert.equal(c.matched, false);
  assert.ok((c.detail ?? "").length > 0);
});

test("重复内容取 name 字典序最小，detail 注明重复档名", () => {
  const d = tmp("dupe");
  put(d, "b.json", SAME);
  put(d, "a.json", SAME);
  const settingsPath = join(d, "settings.json");
  nodeFs.writeFileSync(settingsPath, JSON.stringify({ subagents: JSON.parse(SAME) }));
  const c = detectCurrentProfile({ fs, settingsPath, set: setFor(d) });
  assert.equal(c.name, "a");
  assert.equal(c.matched, true);
  assert.match(c.detail ?? "", /重复档：b/);
});

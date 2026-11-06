import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import { USAGE, runSubprofile, completeProfiles } from "../src/command.ts";
import type { CommandDeps, SelectorState, NotifyLevel, SelectorResult } from "../src/command.ts";

const fs = nodeFs as unknown as FsLike;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "20261106-0009-subagent-switch-implementation");

function tmp(label: string): string {
  nodeFs.mkdirSync(TMP, { recursive: true });
  return nodeFs.mkdtempSync(join(TMP, `${label}-`));
}
const KIMI = JSON.stringify({ defaultModel: "kimi-coding/k3.1-pro", agentOverrides: { w: { model: "k" } } });
const GPT = JSON.stringify({ defaultModel: "tcuni/gpt-6.1-terra" });

interface Harness {
  deps: CommandDeps;
  notes: Array<{ msg: string; level: NotifyLevel }>;
  selectors: SelectorState[];
  wizardCalls: string[];
  setSelector: (r: SelectorResult | undefined) => void;
  after: () => number;
}
function harness(files: Record<string, string>, settings?: string): Harness {
  const dir = tmp("cmd");
  for (const [name, content] of Object.entries(files)) {
    nodeFs.writeFileSync(join(dir, name), content);
  }
  const settingsPath = join(dir, "settings.json");
  if (settings !== undefined) nodeFs.writeFileSync(settingsPath, settings);
  const notes: Array<{ msg: string; level: NotifyLevel }> = [];
  const selectors: SelectorState[] = [];
  const wizardCalls: string[] = [];
  let picked: SelectorResult | undefined = undefined;
  let afterCount = 0;
  const deps: CommandDeps = {
    fs,
    settingsPath,
    roots: [{ dir, source: "user" }],
    notify: (msg, level) => notes.push({ msg, level }),
    openSelector: async (state) => {
      selectors.push(state);
      return picked;
    },
    openConfigWizard: async (kind) => {
      wizardCalls.push(kind);
    },
    onAfterCommand: () => { afterCount++; },
  };
  return {
    deps,
    notes,
    selectors,
    wizardCalls,
    setSelector: (r) => { picked = r; },
    after: () => afterCount,
  };
}

test("help / -h / --help → USAGE(info)，恰好刷新一次", async () => {
  for (const arg of ["help", "-h", "--help"]) {
    const h = harness({ "kimi.json": KIMI });
    await runSubprofile(arg, h.deps);
    assert.ok(h.notes.some((n) => n.msg === USAGE && n.level === "info"));
    assert.equal(h.after(), 1);
  }
});

test("空参 + 有档 → 打开选择器并逐条告警 errors", async () => {
  const h = harness({ "kimi.json": KIMI, "broken.json": "{ nope" });
  await runSubprofile("", h.deps);
  assert.equal(h.selectors.length, 1);
  assert.equal(h.selectors[0]!.profiles.length, 1);
  assert.ok(h.selectors[0]!.errors.length === 1);
  assert.ok(h.notes.some((n) => n.level === "warning"));
  assert.equal(h.after(), 1);
});

test("空参 + 无档 → warning 含 USAGE 与目录提示", async () => {
  const h = harness({});
  await runSubprofile("", h.deps);
  assert.ok(h.notes.some((n) => n.level === "warning" && n.msg.includes(USAGE)));
  assert.equal(h.selectors.length, 0);
  assert.equal(h.after(), 1);
});

test("list → 档目录行 / 每档行 / 当前档 ● / errors warning", async () => {
  const settings = JSON.stringify({ theme: "dark", subagents: JSON.parse(KIMI) });
  const h = harness({ "kimi.json": KIMI, "gpt.json": GPT, "broken.json": "{ nope" }, settings);
  await runSubprofile("list", h.deps);
  assert.ok(h.notes.some((n) => n.msg.includes("档目录") && n.level === "info"));
  assert.ok(h.notes.some((n) => n.msg.includes("●") && n.msg.includes("kimi")));
  assert.ok(h.notes.some((n) => n.msg.includes("gpt")));
  assert.ok(h.notes.some((n) => n.level === "warning"));
  assert.equal(h.after(), 1);
});

test("ls 与 list 等价", async () => {
  const h = harness({ "kimi.json": KIMI });
  await runSubprofile("ls", h.deps);
  assert.ok(h.notes.some((n) => n.msg.includes("档目录")));
});

test("<name> 直切成功 → 成功 notify + 刷新一次", async () => {
  const settings = JSON.stringify({ theme: "dark", subagents: { old: 1 } });
  const h = harness({ "kimi.json": KIMI }, settings);
  await runSubprofile("kimi", h.deps);
  assert.ok(h.notes.some((n) => n.msg.includes("已切换到档") && n.msg.includes("/reload")));
  assert.equal(h.after(), 1);
});

test("已是当前档 → 内容一致提示，不写盘", async () => {
  const settings = JSON.stringify({ theme: "dark", subagents: JSON.parse(KIMI) });
  const h = harness({ "kimi.json": KIMI }, settings);
  const before = nodeFs.readFileSync(h.deps.settingsPath, "utf8");
  await runSubprofile("kimi", h.deps);
  assert.ok(h.notes.some((n) => n.msg.includes("已是当前档")));
  assert.equal(nodeFs.readFileSync(h.deps.settingsPath, "utf8"), before);
  assert.equal(h.after(), 1);
});

test("<name> <extra> → 参数过多 warning", async () => {
  const h = harness({ "kimi.json": KIMI });
  await runSubprofile("kimi extra", h.deps);
  assert.ok(h.notes.some((n) => n.level === "warning" && n.msg.includes("参数过多")));
  assert.equal(h.after(), 1);
});

test("损坏档直切 → 原始错误只 notify error，不抛出、不写盘", async () => {
  const settings = '{"theme":"dark","subagents":{"old":1}}';
  const h = harness({ "broken.json": "{ nope" }, settings);
  await runSubprofile("broken", h.deps);
  assert.ok(h.notes.some((n) => n.level === "error"));
  assert.equal(nodeFs.readFileSync(h.deps.settingsPath, "utf8"), settings);
  assert.equal(h.after(), 1);
});

test("未知档 → not-found error notify，不抛出", async () => {
  const h = harness({ "kimi.json": KIMI });
  await runSubprofile("zzz", h.deps);
  assert.ok(h.notes.some((n) => n.level === "error" && n.msg.includes("未找到档")));
  assert.equal(h.after(), 1);
});

test("取消选择器（undefined）→ 静默且仍恰好刷新一次", async () => {
  const h = harness({ "kimi.json": KIMI });
  h.setSelector(undefined);
  await runSubprofile("", h.deps);
  assert.equal(h.selectors.length, 1);
  assert.equal(h.after(), 1);
});

test("选择器返回名字 → 走切换", async () => {
  const settings = JSON.stringify({ theme: "dark", subagents: { old: 1 } });
  const h = harness({ "kimi.json": KIMI }, settings);
  h.setSelector({ kind: "switch", name: "kimi" });
  await runSubprofile("", h.deps);
  assert.ok(h.notes.some((n) => n.msg.includes("已切换到档")));
  assert.equal(h.wizardCalls.length, 0);
});

test("/subprofile new|edit → 进入配置向导；主面板 new/edit 结果同样进入", async () => {
  const h1 = harness({ "kimi.json": KIMI });
  await runSubprofile("new", h1.deps);
  assert.deepEqual(h1.wizardCalls, ["new"]);
  assert.equal(h1.after(), 1);

  const h2 = harness({ "kimi.json": KIMI });
  await runSubprofile("edit", h2.deps);
  assert.deepEqual(h2.wizardCalls, ["edit"]);

  const h3 = harness({ "kimi.json": KIMI });
  h3.setSelector({ kind: "new" });
  await runSubprofile("", h3.deps);
  assert.deepEqual(h3.wizardCalls, ["new"]);

  const h4 = harness({ "kimi.json": KIMI });
  h4.setSelector({ kind: "edit" });
  await runSubprofile("", h4.deps);
  assert.deepEqual(h4.wizardCalls, ["edit"]);
});

test("USAGE 与补全包含 new/edit/list", async () => {
  assert.ok(USAGE.includes("new"));
  assert.ok(USAGE.includes("edit"));
  const dir = tmp("complete2");
  nodeFs.writeFileSync(join(dir, "kimi.json"), KIMI);
  const roots = [{ dir, source: "user" as const }];
  const all = completeProfiles("", { fs, roots });
  assert.deepEqual(all.map((i) => i.value), ["kimi", "new", "edit", "list"]);
});

test("runSubprofile 永不抛出：onAfterCommand 自身异常也吞掉", async () => {
  const h = harness({ "kimi.json": KIMI });
  const deps: CommandDeps = { ...h.deps, onAfterCommand: () => { throw new Error("after boom"); } };
  await runSubprofile("help", deps);
  assert.ok(h.notes.some((n) => n.msg === USAGE));
});

test("completeProfiles 按 prefix 过滤，list 放最后", () => {
  const dir = tmp("complete");
  nodeFs.writeFileSync(join(dir, "kimi.json"), KIMI);
  nodeFs.writeFileSync(join(dir, "local.json"), GPT);
  const roots = [{ dir, source: "user" as const }];
  const all = completeProfiles("", { fs, roots });
  assert.deepEqual(all.map((i) => i.value), ["kimi", "local", "new", "edit", "list"]);
  const ki = completeProfiles("ki", { fs, roots });
  assert.ok(ki.some((i) => i.value === "kimi"));
  assert.ok(!ki.some((i) => i.value === "local"));
});

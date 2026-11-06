import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import {
  runConfigureWizard,
  REVERT_OPTION,
} from "../src/configure-profile.ts";
import type { ConfigureDeps, WizardUI } from "../src/configure-profile.ts";

const fs = nodeFs as unknown as FsLike;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "20261106-0936-profile-wizard");

function tmp(label: string): string {
  nodeFs.mkdirSync(TMP, { recursive: true });
  return nodeFs.mkdtempSync(join(TMP, `${label}-`));
}

const MODELS = [
  "tcuni/gpt-6.1-terra",
  "kimi-coding/k3.1-pro",
  "kimi-coding/k3-256k",
  "tcuni-claude/claude-sonnet-5-5",
  "tcuni-claude/claude-opus-5-5",
  "m/spec",
];

const KIMI = {
  defaultModel: "kimi-coding/k3.1-pro",
  agentOverrides: {
    oracle: { model: "kimi-coding/k3.1-pro", thinking: "high" },
    worker: {
      model: "kimi-coding/k3.1-pro",
      thinking: "medium",
      tools: ["read", "write"],
      mutationTools: ["write"],
    },
    scout: { model: "kimi-coding/kimi-for-coding", thinking: "low", tools: ["read"] },
  },
};
const CLAUDE = {
  defaultModel: "tcuni-claude/claude-opus-5-5",
  agentOverrides: { oracle: { model: "tcuni-claude/claude-opus-5-5", thinking: "high" } },
};

// kimi 档 → 行 = defaultModel + oracle + worker + scout
// 扁平项 = [batch, dm:m, oracle:m, oracle:t, worker:m, worker:t, scout:m, scout:t, next]
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";
function pick(itemIdx: number): string[] {
  return [DOWN.repeat(itemIdx), ENTER];
}
const NEXT = pick(8);

interface Note {
  m: string;
  l: string;
}
interface Harness {
  deps: ConfigureDeps;
  userDir: string;
  pkgDir: string;
  settingsPath: string;
  notes: Note[];
  inputsSeen: Array<{ title: string; ph?: string }>;
  selectsSeen: Array<{ title: string; options: readonly string[] }>;
  comps: unknown[];
}
interface HarnessOpts {
  userProfiles?: Record<string, string>;
  pkgProfiles?: Record<string, string>;
  settings?: string;
  inputs?: string[];
  selects?: Array<string | undefined | ((title: string, options: readonly string[]) => string | undefined)>;
  customKeys?: string[][];
  models?: string[];
}

function harness(opts: HarnessOpts): Harness {
  const base = tmp("wiz");
  const userDir = join(base, "user");
  const pkgDir = join(base, "pkg");
  nodeFs.mkdirSync(userDir, { recursive: true });
  nodeFs.mkdirSync(pkgDir, { recursive: true });
  for (const [n, c] of Object.entries(opts.userProfiles ?? {})) {
    nodeFs.writeFileSync(join(userDir, n), c);
  }
  for (const [n, c] of Object.entries(opts.pkgProfiles ?? {})) {
    nodeFs.writeFileSync(join(pkgDir, n), c);
  }
  const settingsPath = join(base, "settings.json");
  if (opts.settings !== undefined) nodeFs.writeFileSync(settingsPath, opts.settings);

  const notes: Note[] = [];
  const inputsSeen: Harness["inputsSeen"] = [];
  const selectsSeen: Harness["selectsSeen"] = [];
  const comps: unknown[] = [];
  const inputs = [...(opts.inputs ?? [])];
  const selects = [...(opts.selects ?? [])];
  const customKeys = [...(opts.customKeys ?? [])];

  const ui: WizardUI = {
    notify: (m, l) => notes.push({ m, l }),
    input: async (title, ph) => {
      inputsSeen.push({ title, ph });
      return inputs.shift();
    },
    select: async (title, options) => {
      selectsSeen.push({ title, options });
      const v = selects.shift();
      return typeof v === "function" ? v(title, options) : v;
    },
    custom: <T>(
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (r: T) => void,
      ) => unknown,
      _options?: { overlay?: boolean },
    ): Promise<T | undefined> => {
      const keys = customKeys.length > 0 ? customKeys.shift()! : [ESC];
      let resolved = false;
      return new Promise<T | undefined>((res) => {
        const comp = factory({}, {}, {}, (r: T) => {
          resolved = true;
          res(r);
        });
        Promise.resolve(comp).then((c) => {
          comps.push(c);
          const component = c as { handleInput(d: string): void };
          for (const k of keys) {
            if (resolved) break;
            component.handleInput(k);
          }
          if (!resolved) component.handleInput("\x1b"); // 脚本未命中可完结项 → Esc 取消防挂起
        });
      });
    },
  };

  return {
    deps: {
      fs,
      settingsPath,
      roots: [
        { dir: userDir, source: "user" },
        { dir: pkgDir, source: "package" },
      ],
      userDir,
      ui,
      models: opts.models ?? MODELS,
      now: () => new Date("2026-11-06T10:00:00"),
    },
    userDir,
    pkgDir,
    settingsPath,
    notes,
    inputsSeen,
    selectsSeen,
    comps,
  };
}

const PKG = { "kimi.json": JSON.stringify(KIMI), "claude.json": JSON.stringify(CLAUDE) };
const jsonFiles = (dir: string) => nodeFs.readdirSync(dir).filter((f) => f.endsWith(".json"));

test("新建：自定义档名→模板→三角色不同 model/thinking→创建并切换；写后重载再 applyProfile", async () => {
  const h = harness({
    pkgProfiles: PKG,
    settings: JSON.stringify({ theme: "dark", subagents: { defaultModel: "m/old" } }),
    inputs: ["Planner-E2E!"],
    selects: [
      "kimi", // 模板
      "xhigh", // oracle.thinking
      "low", // worker.thinking
      "max", // scout.thinking
      "创建并切换",
    ],
    customKeys: [
      pick(2),
      ["k3-256k", "\r"],
      pick(1),
      pick(1),
      ["sonnet", "\r"],
      pick(1),
      pick(1),
      ["terra", "\r"],
      pick(1),
      pick(1),
    ],
  });
  const out = await runConfigureWizard("new", h.deps);
  assert.equal(out.status, "created");
  assert.equal(out.name, "planner-e2e"); // 规范化：小写 + 非法字符 → -
  assert.equal(out.applied, true);
  assert.ok(out.changedFields! >= 6);

  const target = join(h.userDir, "planner-e2e.json");
  assert.equal(out.path, target);
  assert.equal(nodeFs.statSync(target).mode & 0o777, 0o600);
  const v = JSON.parse(nodeFs.readFileSync(target, "utf8"));
  assert.equal(v.defaultModel, "kimi-coding/k3.1-pro"); // 未触碰 → 模板原值
  assert.equal(v.agentOverrides.oracle.model, "kimi-coding/k3-256k");
  assert.equal(v.agentOverrides.oracle.thinking, "xhigh");
  assert.equal(v.agentOverrides.worker.model, "tcuni-claude/claude-sonnet-5-5");
  assert.equal(v.agentOverrides.worker.thinking, "low");
  assert.deepEqual(v.agentOverrides.worker.tools, ["read", "write"]); // 未触碰字段保留
  assert.deepEqual(v.agentOverrides.worker.mutationTools, ["write"]);
  assert.equal(v.agentOverrides.scout.model, "tcuni/gpt-6.1-terra");
  assert.equal(v.agentOverrides.scout.thinking, "max");
  assert.deepEqual(v.agentOverrides.scout.tools, ["read"]);

  // 写后重新 loadProfiles 再 applyProfile：settings 被替换为新档内容
  const settings = JSON.parse(nodeFs.readFileSync(h.settingsPath, "utf8"));
  assert.deepEqual(settings.subagents, v);
  assert.equal(settings.theme, "dark");
  assert.ok(h.notes.some((n) => n.m.includes("已创建") && n.m.includes("planner-e2e")));
  assert.ok(h.notes.some((n) => n.m.includes("已切换到档")));
  // 模型走可搜索 custom，模板、thinking 与完成方式仍走原生 select
  assert.equal(h.inputsSeen.length, 1);
  assert.equal(h.selectsSeen.length, 5);
  assert.ok(h.comps.length >= 10);
});

test("新建：非法档名告警后重试；与有效档、损坏档重名自动 -2 后缀", async () => {
  const h = harness({
    userProfiles: { "my.json": JSON.stringify(KIMI), "dup.json": "{ broken" },
    inputs: ["!!!", "my"],
    selects: ["my", "仅创建"],
    customKeys: [NEXT],
  });
  // "!!!" → 非法告警 → 重输入 "my" → 与 my/dup 重名 → my-2
  const out = await runConfigureWizard("new", h.deps);
  assert.equal(out.name, "my-2");
  assert.ok(h.notes.some((n) => n.l === "warning" && n.m.includes("档名")));
  assert.ok(h.notes.some((n) => n.m.includes("重名") || n.m.includes("my-2")));
  assert.equal(h.inputsSeen.length, 2);
  assert.ok(nodeFs.existsSync(join(h.userDir, "my-2.json")));
  assert.equal(
    nodeFs.readFileSync(join(h.userDir, "my.json"), "utf8"),
    JSON.stringify(KIMI),
  );
});

test("新建·仅创建：写档但不动 settings；修改·仅保存：用户档备份原字节、未触碰字段全保留", async () => {
  const settings = JSON.stringify({ theme: "dark", subagents: { defaultModel: "m/old" } });
  const h = harness({
    pkgProfiles: PKG,
    settings,
    inputs: ["solo"],
    selects: ["kimi", "仅创建"],
    customKeys: [NEXT],
  });
  const out = await runConfigureWizard("new", h.deps);
  assert.equal(out.status, "created");
  assert.equal(out.applied, false);
  assert.ok(nodeFs.existsSync(join(h.userDir, "solo.json")));
  assert.equal(nodeFs.readFileSync(h.settingsPath, "utf8"), settings, "仅创建不得改 settings");

  const mine = {
    defaultModel: "m/mine",
    agentOverrides: {
      oracle: { model: "m/mine", thinking: "high" },
      worker: { model: "m/mine", thinking: "medium", tools: ["read"], mutationTools: ["edit"] },
    },
  };
  const original = JSON.stringify(mine, null, 2) + "\n";
  const h2 = harness({
    userProfiles: { "mine.json": original },
    settings,
    selects: ["mine", "xhigh", "保存并切换"],
    customKeys: [pick(5), pick(1)], // worker.thinking → 完成；第二次从保留的 cursor 5 出发
  });
  const out2 = await runConfigureWizard("edit", h2.deps);
  assert.equal(out2.status, "saved");
  assert.equal(out2.applied, true);
  assert.ok(out2.backupPath, "修改用户档必须备份");
  assert.equal(nodeFs.readFileSync(out2.backupPath!, "utf8"), original);
  assert.equal(nodeFs.statSync(out2.backupPath!).mode & 0o777, 0o600);
  const v = JSON.parse(nodeFs.readFileSync(join(h2.userDir, "mine.json"), "utf8"));
  assert.equal(v.agentOverrides.worker.thinking, "xhigh");
  assert.deepEqual(v.agentOverrides.oracle, mine.agentOverrides.oracle); // 未触碰
  assert.deepEqual(v.agentOverrides.worker.tools, ["read"]);
  assert.deepEqual(v.agentOverrides.worker.mutationTools, ["edit"]);
  const s2 = JSON.parse(nodeFs.readFileSync(h2.settingsPath, "utf8"));
  assert.deepEqual(s2.subagents, v); // 保存并切换 → settings 已更新
});

test("修改包内档 → 复制到用户根后修改，包内档逐字节不动", async () => {
  const kimiRaw = JSON.stringify(KIMI, null, 2) + "\n";
  const h = harness({
    pkgProfiles: { "kimi.json": kimiRaw },
    settings: JSON.stringify({ subagents: KIMI }),
    selects: ["kimi", "仅保存"],
    customKeys: [pick(1), ["terra", "\r"], pick(7)], // defaultModel:model → 完成
  });
  const out = await runConfigureWizard("edit", h.deps);
  assert.equal(out.status, "saved");
  assert.equal(out.copiedFromPackage, true);
  assert.equal(nodeFs.readFileSync(join(h.pkgDir, "kimi.json"), "utf8"), kimiRaw);
  const v = JSON.parse(nodeFs.readFileSync(join(h.userDir, "kimi.json"), "utf8"));
  assert.equal(v.defaultModel, "tcuni/gpt-6.1-terra");
  assert.equal(out.applied, false);
  // settings 未被写入（仅保存）：仍是原包内档内容
  const s = JSON.parse(nodeFs.readFileSync(h.settingsPath, "utf8"));
  assert.deepEqual(s.subagents, KIMI);
});

test("批量应用同一模型→单角色覆盖→恢复原值（批量后仍可逐行改）", async () => {
  const h = harness({
    pkgProfiles: PKG,
    settings: JSON.stringify({ subagents: {} }),
    inputs: ["batch-demo"],
    selects: ["kimi", "仅创建"],
    customKeys: [
      pick(0),
      ["terra", "\r"],
      pick(2),
      ["m/spec", "\r"],
      pick(2),
      ["恢复原值", "\r"],
      pick(4),
    ],
  });
  const out = await runConfigureWizard("new", h.deps);
  assert.equal(out.status, "created");
  const v = JSON.parse(nodeFs.readFileSync(join(h.userDir, "batch-demo.json"), "utf8"));
  assert.equal(v.defaultModel, "tcuni/gpt-6.1-terra"); // 批量含 defaultModel 行
  assert.equal(v.agentOverrides.oracle.model, "m/spec"); // 单行覆盖
  assert.equal(v.agentOverrides.oracle.thinking, "high"); // 未触碰
  assert.equal(v.agentOverrides.worker.model, "kimi-coding/k3.1-pro"); // 恢复 → 未触碰 → 模板原值
  assert.equal(v.agentOverrides.scout.model, "tcuni/gpt-6.1-terra"); // 批量生效
});

test("各步取消零写入：input/select/custom/finish 任一步取消 → 无文件、settings 不动", async () => {
  const settings = JSON.stringify({ subagents: { defaultModel: "m/old" } });
  const cases: Array<{ name: string; opts: HarnessOpts }> = [
    { name: "档名步取消", opts: { pkgProfiles: PKG, settings, inputs: [] } },
    { name: "模板步取消", opts: { pkgProfiles: PKG, settings, inputs: ["x1"], selects: [undefined] } },
    { name: "角色面板 Esc 取消", opts: { pkgProfiles: PKG, settings, inputs: ["x1"], selects: ["kimi"], customKeys: [[ESC]] } },
    { name: "完成方式取消", opts: { pkgProfiles: PKG, settings, inputs: ["x1"], selects: ["kimi", undefined], customKeys: [NEXT] } },
  ];
  for (const c of cases) {
    const h = harness(c.opts);
    const out = await runConfigureWizard("new", h.deps);
    assert.equal(out.status, "cancelled", c.name);
    assert.deepEqual(jsonFiles(h.userDir), [], `${c.name}：不得写档`);
    assert.equal(nodeFs.readFileSync(h.settingsPath, "utf8"), settings, `${c.name}：settings 不变`);
  }
});

test("修改向导同样零写入：选档步取消 / 保存方式取消", async () => {
  const mine = JSON.stringify(KIMI, null, 2) + "\n";
  const h1 = harness({ userProfiles: { "mine.json": mine }, selects: [undefined] });
  const o1 = await runConfigureWizard("edit", h1.deps);
  assert.equal(o1.status, "cancelled");
  assert.equal(nodeFs.readFileSync(join(h1.userDir, "mine.json"), "utf8"), mine);
  assert.equal(jsonFiles(h1.userDir).filter((f) => f.includes(".bak-") || f.endsWith(".tmp")).length, 0);

  const h2 = harness({
    userProfiles: { "mine.json": mine },
    selects: ["mine", undefined],
    customKeys: [NEXT], // KIMI = 4 行 → next = idx 8；保存方式 undefined → 取消
  });
  const o2 = await runConfigureWizard("edit", h2.deps);
  assert.equal(o2.status, "cancelled");
  assert.equal(nodeFs.readFileSync(join(h2.userDir, "mine.json"), "utf8"), mine);
});

test("无可用模型：model 选择降级为警告且不挂起；thinking 仍可选", async () => {
  const h = harness({
    pkgProfiles: PKG,
    settings: JSON.stringify({ subagents: {} }),
    inputs: ["nomodel"],
    selects: ["kimi", "max", "仅创建"],
    customKeys: [pick(1), pick(2), pick(5)], // defaultModel:model(跳过) → oracle:thinking → 完成
    models: [],
  });
  const out = await runConfigureWizard("new", h.deps);
  assert.equal(out.status, "created");
  const v = JSON.parse(nodeFs.readFileSync(join(h.userDir, "nomodel.json"), "utf8"));
  assert.equal(v.defaultModel, "kimi-coding/k3.1-pro");
  assert.equal(v.agentOverrides.oracle.thinking, "max");
  assert.ok(h.notes.some((n) => n.l === "warning" && n.m.includes("模型")));
});

test("无档可配 → 警告并取消", async () => {
  const h = harness({ settings: JSON.stringify({}) });
  const out = await runConfigureWizard("new", h.deps);
  assert.equal(out.status, "cancelled");
  assert.ok(h.notes.some((n) => n.l === "warning"));
});


test("从模型搜索 Esc 返回后保留原单元格光标，再次 Esc 取消且零写入", async () => {
  const original = JSON.stringify(KIMI, null, 2) + "\n";
  const h = harness({
    userProfiles: { "mine.json": original },
    selects: ["mine"],
    customKeys: [pick(4), [ESC], [ESC]], // worker.model → 搜索返回 → 角色面板取消
  });
  const out = await runConfigureWizard("edit", h.deps);
  assert.equal(out.status, "cancelled");
  assert.equal(h.comps.length, 3);
  assert.equal((h.comps[2] as { cursor: number }).cursor, 4);
  assert.equal(nodeFs.readFileSync(join(h.userDir, "mine.json"), "utf8"), original);
});

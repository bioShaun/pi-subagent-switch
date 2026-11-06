import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "20261106-0009-subagent-switch-implementation");
const KIMI = JSON.stringify({ defaultModel: "kimi-coding/k3.1-pro", agentOverrides: { w: { model: "k" } } });

// 扩展在模块加载时解析路径，必须先设置 env 再动态 import。
nodeFs.mkdirSync(TMP, { recursive: true });
const agentDir = nodeFs.mkdtempSync(join(TMP, "ext-"));
process.env.PI_SUBAGENT_SWITCH_AGENT_DIR = agentDir;
delete process.env.PI_SUBAGENT_PROFILES_DIR;
const userProfiles = join(agentDir, "subagent-profiles");
nodeFs.mkdirSync(userProfiles, { recursive: true });
nodeFs.writeFileSync(join(userProfiles, "kimi.json"), KIMI);
const settingsPath = join(agentDir, "settings.json");
nodeFs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark", subagents: JSON.parse(KIMI) }));

interface Note { m: string; l: string }
interface StatusCall { k: string; t: string | undefined }

function makeHarness() {
  const commands: Array<{ name: string; options: any }> = [];
  const sessionHandlers: Array<(e: any, c: any) => Promise<void> | void> = [];
  const notes: Note[] = [];
  const statuses: StatusCall[] = [];
  const customOptions: Array<{ overlay?: boolean }> = [];
  const comps: any[] = [];
  const inputsSeen: Array<{ title: string }> = [];
  const selectsSeen: Array<{ title: string }> = [];
  let simulate: "enter" | "escape" = "enter";
  const customKeyQueue: string[][] = [];
  const inputQueue: Array<string | undefined> = [];
  const selectQueue: Array<string | undefined> = [];
  const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, dim: (t: string) => t };
  const fakePi = {
    registerCommand: (name: string, options: any) => { commands.push({ name, options }); },
    on: (event: string, handler: any) => {
      if (event === "session_start") sessionHandlers.push(handler);
      return () => {};
    },
  };
  const ctx: any = {
    ui: {
      notify: (m: string, l: string) => notes.push({ m, l }),
      setStatus: (k: string, t: string | undefined) => statuses.push({ k, t }),
      theme,
      input: async (title: string) => {
        inputsSeen.push({ title });
        return inputQueue.shift();
      },
      select: async (title: string) => {
        selectsSeen.push({ title });
        return selectQueue.shift();
      },
      custom: async (factory: any, options: any) => {
        customOptions.push(options);
        let resolved = false;
        const p = new Promise<any>((res) => {
          Promise.resolve(factory({}, theme, {}, (r: any) => { resolved = true; res(r); })).then(
            (comp) => {
              comps.push(comp);
              const keys = customKeyQueue.length > 0
                ? customKeyQueue.shift()!
                : [simulate === "enter" ? "\r" : "\x1b"];
              for (const k of keys) {
                if (resolved) break;
                comp.handleInput(k);
              }
              if (!resolved) comp.handleInput("\x1b"); // 脚本未命中可完结项 → Esc 取消防挂起
            },
          );
        });
        return p;
      },
    },
    mode: "tui",
    hasUI: true,
    cwd: agentDir,
    modelRegistry: {
      getAvailable: () => [
        { provider: "tcuni", id: "gpt-6.1-terra" },
        { provider: "kimi-coding", id: "k3.1-pro" },
      ],
    },
  };
  return {
    fakePi, ctx, commands, sessionHandlers, notes, statuses, customOptions, comps,
    inputsSeen, selectsSeen,
    setSimulate: (s: "enter" | "escape") => { simulate = s; },
    setInputs: (v: Array<string | undefined>) => { inputQueue.push(...v); },
    setSelects: (v: Array<string | undefined>) => { selectQueue.push(...v); },
    setCustomKeys: (v: string[][]) => { customKeyQueue.push(...v); },
  };
}

test("注册 /subprofile、补全、session_start 刷新与 overlay:false 内联选择器", async () => {
  const ext = (await import("../extensions/index.ts")).default;
  const h = makeHarness();
  ext(h.fakePi as any);

  assert.equal(h.commands.length, 1);
  assert.equal(h.commands[0]!.name, "subprofile");
  assert.equal(typeof h.commands[0]!.options.handler, "function");
  assert.equal(typeof h.commands[0]!.options.getArgumentCompletions, "function");
  assert.equal(h.sessionHandlers.length, 1);

  // 补全
  const items = await h.commands[0]!.options.getArgumentCompletions("ki");
  assert.ok(Array.isArray(items));
  assert.ok(items!.some((i: any) => i.value === "kimi"));

  // session_start → setStatus(STATUS_KEY, "subagents: kimi")
  await h.sessionHandlers[0]!({ type: "session_start", reason: "startup" }, h.ctx);
  assert.ok(h.statuses.some((s) => s.k === "pi-subagent-switch" && s.t === "subagents: kimi"));

  // 无参 → 实际执行 custom factory，options.overlay === false
  // 先把 settings 改为 custom，使 Enter 选择 kimi 触发真实写入
  nodeFs.writeFileSync(settingsPath, JSON.stringify({ theme: "dark", subagents: { defaultModel: "custom/x" } }));
  h.setSimulate("enter");
  await h.commands[0]!.options.handler("", h.ctx);
  assert.equal(h.customOptions.length, 1);
  assert.equal(h.customOptions[0]!.overlay, false);
  assert.ok(h.comps.length === 1);
  assert.ok(h.notes.some((n) => n.m.includes("已切换到档")));
  // 命令结束后刷新状态栏
  assert.ok(h.statuses.some((s) => s.t === "subagents: kimi"));
});

test("Esc 取消选择器 → 不改文件，仍刷新状态", async () => {
  const ext = (await import("../extensions/index.ts")).default;
  const h = makeHarness();
  ext(h.fakePi as any);
  const before = nodeFs.readFileSync(settingsPath, "utf8");
  h.setSimulate("escape");
  await h.commands[0]!.options.handler("", h.ctx);
  assert.equal(nodeFs.readFileSync(settingsPath, "utf8"), before);
  assert.equal(h.customOptions.length, 1);
  assert.equal(h.customOptions[0]!.overlay, false);
});

test("非 TUI 模式 → 选择器降级为警告，不调用 custom", async () => {
  const ext = (await import("../extensions/index.ts")).default;
  const h = makeHarness();
  ext(h.fakePi as any);
  let customCalled = false;
  const nonTui = {
    ...h.ctx,
    mode: "json",
    ui: {
      ...h.ctx.ui,
      custom: async () => { customCalled = true; return undefined; },
    },
  };
  await h.commands[0]!.options.handler("", nonTui);
  assert.equal(customCalled, false);
  assert.ok(h.notes.some((n) => n.l === "warning" && n.m.includes("TUI")));
});

test("hasUI:false → 不写状态栏", async () => {
  const ext = (await import("../extensions/index.ts")).default;
  const h = makeHarness();
  ext(h.fakePi as any);
  h.ctx.hasUI = false;
  await h.sessionHandlers[0]!({ type: "session_start", reason: "startup" }, h.ctx);
  assert.equal(h.statuses.length, 0);
});

test("/subprofile new：向导真实走 input/select/custom，仅创建写入用户档目录", async () => {
  const ext = (await import("../extensions/index.ts")).default;
  const h = makeHarness();
  ext(h.fakePi as any);
  h.setInputs(["e2e-ext"]);
  h.setSelects(["kimi", "high", "仅创建"]);
  // kimi 档行 = defaultModel + w → 项 = [batch, dm:m, w:m, w:t, next]
  // 会话1：w:thinking → "high"（真实改动一个字段，使新档与 settings 内容可区分）；
  // 会话2：next。
  h.setCustomKeys([
    ["\x1b[B", "\x1b[B", "\x1b[B", "\r"],
    ["\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\r"],
  ]);
  const created = join(userProfiles, "e2e-ext.json");
  try {
    await h.commands[0]!.options.handler("new", h.ctx);
    assert.equal(h.inputsSeen.length, 1);
    assert.equal(h.selectsSeen.length, 3);
    assert.ok(nodeFs.existsSync(created));
    assert.equal(nodeFs.statSync(created).mode & 0o777, 0o600);
    const v = JSON.parse(nodeFs.readFileSync(created, "utf8"));
    assert.equal(v.defaultModel, "kimi-coding/k3.1-pro");
    assert.equal(v.agentOverrides.w.thinking, "high");
    assert.ok(h.notes.some((n) => n.m.includes("已创建")));
    // 仅创建不切换：settings 仍是 kimi 内容 → 状态栏匹配 kimi
    assert.ok(h.statuses.some((s) => s.t === "subagents: kimi"));
  } finally {
    if (nodeFs.existsSync(created)) nodeFs.unlinkSync(created);
  }
});

test("主面板动作行进向导：选择器按 n → new 向导启动", async () => {
  const ext = (await import("../extensions/index.ts")).default;
  const h = makeHarness();
  ext(h.fakePi as any);
  h.setInputs(["panel-new"]);
  h.setSelects(["kimi", "仅创建"]);
  h.setCustomKeys([["n"], ["\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\r"]]);
  const created = join(userProfiles, "panel-new.json");
  try {
    await h.commands[0]!.options.handler("", h.ctx);
    assert.equal(h.inputsSeen.length, 1);
    assert.ok(nodeFs.existsSync(created));
  } finally {
    if (nodeFs.existsSync(created)) nodeFs.unlinkSync(created);
  }
});

test("非 TUI 模式 new/edit → 警告且不调用 input/select/custom", async () => {
  const ext = (await import("../extensions/index.ts")).default;
  const h = makeHarness();
  ext(h.fakePi as any);
  const nonTui = { ...h.ctx, mode: "json" };
  for (const arg of ["new", "edit"]) {
    await h.commands[0]!.options.handler(arg, nonTui);
  }
  assert.equal(h.inputsSeen.length, 0);
  assert.equal(h.selectsSeen.length, 0);
  assert.equal(h.comps.length, 0);
  assert.ok(h.notes.filter((n) => n.l === "warning" && n.m.includes("TUI")).length >= 2);
});

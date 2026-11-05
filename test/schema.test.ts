import { test } from "node:test";
import assert from "node:assert/strict";
import { THINKING_LEVELS, ProfileError, validateSubagents } from "../src/schema.ts";

const ok = (v: unknown, name = "p"): ReturnType<typeof validateSubagents> =>
  validateSubagents(v, name);

function bad(v: unknown, name = "p"): void {
  assert.throws(
    () => validateSubagents(v, name),
    (e: unknown) => {
      assert.ok(e instanceof ProfileError, `expected ProfileError, got: ${String(e)}`);
      assert.equal(e.kind, "invalid-schema");
      assert.equal(e.profile, name);
      return true;
    },
  );
}

test("THINKING_LEVELS 常量", () => {
  assert.deepEqual([...THINKING_LEVELS], [
    "off", "minimal", "low", "medium", "high", "xhigh", "max",
  ]);
});

test("空对象通过并给出默认摘要", () => {
  const s = ok({});
  assert.equal(s.defaultModel, undefined);
  assert.equal(s.defaultProvider, undefined);
  assert.equal(s.overrideCount, 0);
});

test("完整合法档通过并给出摘要", () => {
  const s = ok({
    defaultModel: "m/x",
    defaultProvider: "p",
    defaultThinking: "low",
    maxThinking: "high",
    defaultExtensions: ["a"],
    defaultSubagentOnlyExtensions: ["b"],
    agentScanDirs: ["c"],
    agentExcludeDirs: ["d"],
    disableBuiltins: true,
    disableThinking: false,
    modelScope: {
      allow: ["m/x"], enforce: true, strict: false,
      agents: { worker: { allow: ["m/x"] } },
    },
    agentOverrides: {
      worker: { model: "m/x", thinking: "high" },
      scout: { tools: "inherit" },
    },
    agentOverridesByProvider: { p: { worker: { model: "m/y" } } },
  });
  assert.equal(s.defaultModel, "m/x");
  assert.equal(s.defaultProvider, "p");
  assert.equal(s.overrideCount, 2);
});

test("顶层未知字段报错（比 pi-subagents 严格）", () => {
  bad({ defualtModel: "x" });
});

test("fallbackModels 专项：字段路径 + 档名 + 0.85.0", () => {
  let caught: unknown;
  try {
    ok({ agentOverrides: { worker: { fallbackModels: ["a"] } } }, "kimi");
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof ProfileError);
  assert.equal(caught.field, "agentOverrides.worker.fallbackModels");
  assert.match(caught.message, /0\.85\.0/);
  assert.match(caught.message, /档 "kimi"/);
});

test("launcher 专项：字段路径 + 可读文案", () => {
  let caught: unknown;
  try {
    ok({ agentOverrides: { worker: { launcher: "x" } } });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof ProfileError);
  assert.equal(caught.field, "agentOverrides.worker.launcher");
  assert.match(caught.message, /launcher|settings override/);
});

test("override 未知字段", () => {
  bad({ agentOverrides: { worker: { modle: "x" } } });
});

test("tools：string[] / inherit / false 合法，空项与非数组非法", () => {
  ok({ agentOverrides: { w: { tools: "inherit" } } });
  ok({ agentOverrides: { w: { tools: false } } });
  ok({ agentOverrides: { w: { tools: ["read"] } } });
  bad({ agentOverrides: { w: { tools: [""] } } });
  bad({ agentOverrides: { w: { tools: 3 } } });
});

test("thinking：false / THINKING_LEVELS 合法，其它非法", () => {
  ok({ agentOverrides: { w: { thinking: false } } });
  ok({ agentOverrides: { w: { thinking: "xhigh" } } });
  bad({ agentOverrides: { w: { thinking: "bogus" } } });
  bad({ agentOverrides: { w: { thinking: 3 } } });
});

test("machine：128 合法 / 129 非法 / 控制字符非法 / false 合法 / number 非法", () => {
  ok({ agentOverrides: { w: { machine: "a".repeat(128) } } });
  bad({ agentOverrides: { w: { machine: "a".repeat(129) } } });
  bad({ agentOverrides: { w: { machine: "a\u0001b" } } });
  ok({ agentOverrides: { w: { machine: false } } });
  bad({ agentOverrides: { w: { machine: 3 } } });
});

test("modelScope.agents.<n>.agents 拒绝", () => {
  bad({ modelScope: { agents: { worker: { agents: { allow: [] } } } } });
});

test("defaultModel 空串 / 空白 / 非字符串非法", () => {
  bad({ defaultModel: "" });
  bad({ defaultModel: "   " });
  bad({ defaultModel: 3 });
});

test("maxThinking 非法值", () => {
  bad({ maxThinking: "bogus" });
});

test("顶层字符串数组含空项非法", () => {
  bad({ defaultExtensions: ["a", " "] });
});

test("单条 override 其余字段全表", () => {
  ok({
    agentOverrides: {
      w: {
        description: "d", advertise: true, fast: false,
        inheritProjectContext: true, inheritGlobalContext: false,
        inheritSkills: true, disabled: false, allowNestedSubagents: true,
        output: "file", outputMode: "file-only", model: "inherit",
        defaultProvider: false, systemPromptMode: "replace",
        defaultContext: "fresh", acceptanceRole: "writer",
        toolBudget: { a: 1 }, systemPrompt: "",
        defaultReads: ["a"], skills: false, excludeTools: ["x"],
        allowedAgents: ["y"], extensions: ["z"],
        subagentOnlyExtensions: false, mutationTools: ["apply_patch"],
      },
    },
  });
  bad({ agentOverrides: { w: { outputMode: "bogus" } } });
  bad({ agentOverrides: { w: { systemPromptMode: "bogus" } } });
  bad({ agentOverrides: { w: { defaultContext: "bogus" } } });
  bad({ agentOverrides: { w: { acceptanceRole: "bogus" } } });
  bad({ agentOverrides: { w: { systemPrompt: 3 } } });
  bad({ agentOverrides: { w: { description: "" } } });
});

test("agentOverridesByProvider 逐层校验", () => {
  ok({ agentOverridesByProvider: { p: { w: { model: "m" } } } });
  bad({ agentOverridesByProvider: { p: { w: { fallbackModels: [] } } } });
});

test("顶层非对象报错", () => {
  bad([1, 2]);
  bad(null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBatchModel,
  buildValue,
  changeList,
  createRoleEditor,
  initRoleRows,
  revertAllModels,
  revertField,
  roleEditorTheme,
  touchedKey,
} from "../src/ui/role-editor.ts";
import type { RoleEditorAction, RoleRow } from "../src/ui/role-editor.ts";

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };

const SRC = {
  defaultModel: "m/def",
  agentOverrides: {
    oracle: { model: "m/o", thinking: "high", tools: ["read"] },
    worker: {
      model: "m/w",
      thinking: "medium",
      tools: ["read", "write"],
      mutationTools: ["write"],
    },
    scout: { thinking: "low" },
  },
};

function mkEditor(
  rows: RoleRow[],
  touched: Set<string>,
  sink: RoleEditorAction[],
  title = "角色配置 · src",
) {
  return createRoleEditor({ rows, touched, title, theme, onDone: (a) => sink.push(a) });
}

test("initRoleRows：defaultModel 行无 thinking；角色继承/覆盖原值", () => {
  const rows = initRoleRows(SRC);
  assert.deepEqual(rows[0], { key: "defaultModel", model: "m/def", thinking: null });
  assert.deepEqual(rows[1], { key: "oracle", model: "m/o", thinking: "high" });
  assert.deepEqual(rows[2], { key: "worker", model: "m/w", thinking: "medium" });
  assert.deepEqual(rows[3], { key: "scout", model: "m/def", thinking: "low" });
  const bare = initRoleRows({ defaultModel: "m/x" });
  assert.equal(bare.length, 1);
  assert.equal(bare[0]!.key, "defaultModel");
});

test("扁平项 = 批量 + 每行单元格 + 完成行；cursor 回绕", () => {
  const rows = initRoleRows(SRC); // 4 行 → 1 + (1+2+2+2) + 1 = 9 项
  const done: RoleEditorAction[] = [];
  const c = mkEditor(rows, new Set(), done);
  assert.equal(c.cursor, 0);
  for (let i = 0; i < 9; i++) c.handleInput("j");
  assert.equal(c.cursor, 0, "9 次 down 后回绕到 0");
  c.handleInput("k");
  assert.equal(c.cursor, 8, "k 回绕到底部（完成行）");
  c.handleInput("\x1b[A");
  assert.equal(c.cursor, 7);
});

test("Enter 分发：批量→batch、单元格→pick、完成行→next；Esc/Ctrl+C→cancel", () => {
  const rows = initRoleRows(SRC);
  const done: RoleEditorAction[] = [];
  const c = mkEditor(rows, new Set(), done);
  c.handleInput("\r"); // cursor 0 = 批量
  c.handleInput("\x1b[B");
  c.handleInput("\r"); // defaultModel:model
  c.handleInput("\x1b[B");
  c.handleInput("\x1b[B");
  c.handleInput("\r"); // oracle:thinking（idx 3）
  assert.deepEqual(done, [
    { type: "batch" },
    { type: "pick", row: 0, field: "model" },
    { type: "pick", row: 1, field: "thinking" },
  ]);

  const done2: RoleEditorAction[] = [];
  const c2 = mkEditor(rows, new Set(), done2);
  for (let i = 0; i < 8; i++) c2.handleInput("j"); // 完成行
  c2.handleInput("\r");
  assert.deepEqual(done2, [{ type: "next" }]);

  const done3: RoleEditorAction[] = [];
  const c3 = mkEditor(rows, new Set(), done3);
  c3.handleInput("\x1b");
  const done4: RoleEditorAction[] = [];
  const c4 = mkEditor(rows, new Set(), done4);
  c4.handleInput("\x03");
  assert.deepEqual(done3, [{ type: "cancel" }]);
  assert.deepEqual(done4, [{ type: "cancel" }]);
});

test("render：表头/行/单元格对齐，cursor ▶，改动 *，defaultModel thinking 为 —，提示行 dim", () => {
  const rows = initRoleRows(SRC);
  const touched = new Set([touchedKey(1, "model")]);
  const marked = { fg: (c: string, t: string) => `[${c}]${t}`, bold: (t: string) => `<B>${t}</B>` };
  const c = createRoleEditor({ rows, touched, title: "角色配置 · kimi", theme: marked, onDone: () => {} });
  const lines = c.render(80);
  const joined = lines.join("\n");
  assert.ok(joined.includes("角色配置 · kimi"));
  assert.ok(joined.includes("批量应用同一模型"));
  assert.ok(joined.includes("defaultModel"));
  assert.ok(joined.includes("oracle"));
  assert.ok(joined.includes("完成角色配置"));
  // cursor 0 = 批量行 → ▶
  assert.ok(lines.some((l) => l.startsWith("▶ ")));
  // 改动标记：oracle model 单元格 touched → *
  const oracleLine = lines.find((l) => l.includes("oracle"))!;
  assert.ok(oracleLine.includes("m/o*") || oracleLine.includes("m/o *"), `oracle 行应有改动标记：${JSON.stringify(oracleLine)}`);
  // defaultModel 行 thinking 显示 —
  const dmLine = lines.find((l) => l.includes("defaultModel"))!;
  assert.ok(dmLine.includes("—"), `defaultModel 行 thinking 应为 —：${JSON.stringify(dmLine)}`);
  // dim 提示行
  assert.ok(lines[lines.length - 1]!.includes("[dim]"));
  // 移动 cursor 到 oracle model → 该行 bold + ▶
  const c2 = createRoleEditor({ rows, touched, title: "t", theme: marked, onDone: () => {} });
  c2.handleInput("\x1b[B");
  c2.handleInput("\x1b[B");
  const moved = c2.render(80);
  const oLine = moved.find((l) => l.includes("oracle"))!;
  assert.ok(oLine.includes("▶"), "cursor 单元格行应有 ▶");
  assert.match(oLine, /<B>/, "cursor 行应 bold");
});

test("render(28) 每行可见字符 ≤ 28", () => {
  const rows = initRoleRows(SRC);
  const c = mkEditor(rows, new Set([touchedKey(2, "thinking")]), []);
  for (const l of c.render(28)) {
    assert.ok([...l].length <= 28, `too wide: ${JSON.stringify(l)}`);
  }
});

test("buildValue：仅写 touched 字段，其它 JSON 值（tools 等）逐字节保留", () => {
  const rows = initRoleRows(SRC);
  const touched = new Set<string>();
  rows[1]!.thinking = "xhigh";
  touched.add(touchedKey(1, "thinking"));
  rows[0]!.model = "m/newdef";
  touched.add(touchedKey(0, "model"));
  const v = buildValue(SRC, rows, touched);
  assert.equal(v.defaultModel, "m/newdef");
  const ov = v.agentOverrides as Record<string, Record<string, unknown>>;
  assert.equal(ov["oracle"]!.thinking, "xhigh");
  assert.equal(ov["oracle"]!.model, "m/o"); // 未触碰 → 原值
  assert.deepEqual(ov["oracle"]!.tools, ["read"]);
  assert.deepEqual(ov["worker"], SRC.agentOverrides.worker); // 整个 override 未触碰 → 深相等
  assert.deepEqual(ov["scout"], SRC.agentOverrides.scout);
  // 入参未被修改
  assert.equal(SRC.agentOverrides.oracle.thinking, "high");
  assert.equal(SRC.defaultModel, "m/def");
});

test("批量应用 → 单行覆盖 → 恢复：touched 语义正确", () => {
  const rows = initRoleRows(SRC);
  const source = rows.map((r) => ({ ...r }));
  const touched = new Set<string>();
  applyBatchModel(rows, touched, "m/all");
  assert.ok(rows.every((r) => r.model === "m/all"));
  assert.equal(touched.size, rows.length);
  rows[1]!.model = "m/spec";
  // 单行覆盖仍是 touched
  assert.ok(touched.has(touchedKey(1, "model")));
  revertField(rows, source, touched, 2, "model");
  assert.equal(rows[2]!.model, "m/w");
  assert.ok(!touched.has(touchedKey(2, "model")));
  revertAllModels(rows, source, touched);
  assert.deepEqual(rows.map((r) => r.model), source.map((r) => r.model));
  assert.equal([...touched].filter((k) => k.endsWith(":model")).length, 0);
});

test("changeList：只列 touched 字段的 from→to", () => {
  const rows = initRoleRows(SRC);
  const source = rows.map((r) => ({ ...r }));
  const touched = new Set<string>();
  rows[3]!.thinking = "max";
  touched.add(touchedKey(3, "thinking"));
  const list = changeList(rows, source, touched);
  assert.deepEqual(list, [{ key: "scout.thinking", from: "low", to: "max" }]);
});

test("roleEditorTheme：缺 fg/bold 时退化原文", () => {
  const t = roleEditorTheme({});
  assert.equal(t.fg("dim", "x"), "x");
  assert.equal(t.bold("y"), "y");
  const real = roleEditorTheme({ fg: (c: string, s: string) => `${c}:${s}`, bold: (s: string) => `B${s}` });
  assert.equal(real.fg("dim", "x"), "dim:x");
  assert.equal(real.bold("y"), "By");
});

test("handleInput 忽略未知键；invalidate 空实现", () => {
  const rows = initRoleRows(SRC);
  const done: RoleEditorAction[] = [];
  const c = mkEditor(rows, new Set(), done);
  c.handleInput("x");
  c.handleInput("\x1b[C");
  assert.equal(c.cursor, 0);
  assert.equal(done.length, 0);
  c.invalidate();
});


test("重开面板恢复 initialCursor，移动时同步最新位置", () => {
  const rows = initRoleRows(SRC);
  const positions: number[] = [];
  const c = createRoleEditor({
    rows,
    touched: new Set(),
    initialCursor: 5,
    theme,
    onCursorChange: (cursor) => positions.push(cursor),
    onDone: () => {},
  });
  assert.equal(c.cursor, 5);
  c.handleInput("j");
  assert.equal(c.cursor, 6);
  assert.deepEqual(positions, [6]);
});

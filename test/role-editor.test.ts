import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
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

test("initRoleRows：包含 defaultModel 与 maxThinking 行；角色继承/覆盖原值", () => {
  const rows = initRoleRows(SRC);
  assert.deepEqual(rows[0], { key: "defaultModel", model: "m/def", thinking: "" });
  assert.deepEqual(rows[1], { key: "maxThinking", model: null, thinking: "" });
  assert.deepEqual(rows[2], { key: "oracle", model: "m/o", thinking: "high" });
  assert.deepEqual(rows[3], { key: "worker", model: "m/w", thinking: "medium" });
  assert.deepEqual(rows[4], { key: "scout", model: "m/def", thinking: "low" });
  const bare = initRoleRows({ defaultModel: "m/x" });
  assert.equal(bare.length, 2);
  assert.equal(bare[0]!.key, "defaultModel");
  assert.equal(bare[1]!.key, "maxThinking");
});

test("2D 导航：垂直移动保持当前列（sticky column），水平移动及 Tab 切列", () => {
  const rows = initRoleRows(SRC);
  const done: RoleEditorAction[] = [];
  const c = mkEditor(rows, new Set(), done);
  assert.equal(c.cursor, 0); // batch

  // 从 batch 向下垂直切入首行 model 列（cursor 1）
  c.handleInput("j");
  assert.equal(c.cursor, 1);

  // 向右水平切到 thinking 列（cursor 2）
  c.handleInput("l");
  assert.equal(c.cursor, 2);

  // 向下切入 maxThinking（只有 thinking，cursor 3）
  c.handleInput("j");
  assert.equal(c.cursor, 3);

  // 再向下切入 oracle：保持 preferredField = thinking（cursor 5）
  c.handleInput("j");
  assert.equal(c.cursor, 5);

  // 向左切回 model 列（cursor 4）
  c.handleInput("h");
  assert.equal(c.cursor, 4);

  // 向上切入 maxThinking：由于无 model，降级聚焦 thinking（cursor 3），但 sticky column 保持 model
  c.handleInput("k");
  assert.equal(c.cursor, 3);

  // 再向上切入 defaultModel：自动恢复 sticky column = model（cursor 1）
  c.handleInput("k");
  assert.equal(c.cursor, 1);

  // Tab 键切列：在 defaultModel 上从 model (1) 切到 thinking (2)
  c.handleInput("\t");
  assert.equal(c.cursor, 2);

  // 垂直向上到 batch (0)
  c.handleInput("\x1b[A");
  assert.equal(c.cursor, 0);

  // 垂直向上回绕到底部 next (10)
  c.handleInput("\x1b[A");
  assert.equal(c.cursor, 10);

  // next 向上回到末行 (scout)，且由于刚才 Tab 记录了 preferredField = thinking，聚焦 scout:thinking (9)
  c.handleInput("\x1b[A");
  assert.equal(c.cursor, 9);
});

test("Enter 分发：批量→batch、单元格→pick、完成行→next；Esc/Ctrl+C→cancel", () => {
  const rows = initRoleRows(SRC);
  const done: RoleEditorAction[] = [];
  const c = mkEditor(rows, new Set(), done);
  c.handleInput("\r"); // cursor 0 = 批量
  c.handleInput("j"); // defaultModel:model
  c.handleInput("\r");
  c.handleInput("\t"); // defaultModel:thinking
  c.handleInput("\r");
  assert.deepEqual(done, [
    { type: "batch" },
    { type: "pick", row: 0, field: "model" },
    { type: "pick", row: 0, field: "thinking" },
  ]);

  const done2: RoleEditorAction[] = [];
  const c2 = mkEditor(rows, new Set(), done2);
  c2.handleInput("k"); // 回绕到完成行 next
  c2.handleInput("\r");
  assert.deepEqual(done2, [{ type: "next" }]);

  const done3: RoleEditorAction[] = [];
  const c3 = mkEditor(rows, new Set(), done3);
  c3.handleInput("\x1b");
  assert.deepEqual(done3, [{ type: "cancel" }]);
});

test("render：边框+标题入上边框，cursor ▶+accent+bold，改动 * 为 warning，提示行 muted", () => {
  const rows = initRoleRows(SRC);
  const touched = new Set([touchedKey(2, "model")]);
  const FG: Record<string, string> = { accent: "36", text: "37", muted: "90", warning: "33" };
  const marked = {
    fg: (c: string, t: string) => `\x1b[${FG[c] ?? "39"}m${t}\x1b[39m`,
    bold: (t: string) => `\x1b[1m${t}\x1b[22m`,
  };
  const c = createRoleEditor({ rows, touched, title: "角色配置 · kimi", theme: marked, onDone: () => {} });
  const lines = c.render(80);
  const joined = lines.join("\n");
  assert.ok(joined.includes("角色配置 · kimi"));
  assert.ok(joined.includes("批量应用同一模型"));
  assert.ok(joined.includes("defaultModel"));
  assert.ok(joined.includes("oracle"));
  assert.ok(joined.includes("完成角色配置"));
  // 边框：标题 accent+bold 嵌入上边框，末行 accent ╰
  assert.ok(lines[0]!.startsWith("\x1b[36m") && lines[0]!.includes("\x1b[1m角色配置 · kimi"), lines[0]);
  assert.ok(lines[lines.length - 1]!.startsWith("\x1b[36m"), lines[lines.length - 1]);
  // cursor 0 = 批量行 → ▶ + accent + bold
  const batchLine = lines.find((l) => l.includes("批量应用同一模型"))!;
  assert.ok(batchLine.includes("▶ "), `批量行应有 ▶：${JSON.stringify(batchLine)}`);
  assert.ok(batchLine.includes("\x1b[36m") && batchLine.includes("\x1b[1m"), batchLine);
  // 改动标记：oracle model 单元格 touched → warning *
  const oracleLine = lines.find((l) => l.includes("oracle"))!;
  assert.match(oracleLine, /m\/o.*\x1b\[33m\*/, `oracle 行应有 warning 改动标记：${JSON.stringify(oracleLine)}`);
  // defaultModel 行 thinking 缺省显示 —
  const dmLine = lines.find((l) => l.includes("defaultModel"))!;
  assert.ok(dmLine.includes("—"), `defaultModel 行 thinking 应为 —：${JSON.stringify(dmLine)}`);
  // 快捷键提示 muted（在下边框上一行）
  const hintLine = lines.find((l) => l.includes("Esc"))!;
  assert.ok(hintLine.includes("\x1b[90m"), hintLine);
  // 移动 cursor 到 oracle model（3 次 down）→ 该单元格 accent + bold + ▶
  const c2 = createRoleEditor({ rows, touched, title: "t", theme: marked, onDone: () => {} });
  c2.handleInput("j");
  c2.handleInput("j");
  c2.handleInput("j");
  const moved = c2.render(80);
  const oLine = moved.find((l) => l.includes("oracle"))!;
  assert.ok(oLine.includes("▶"), "cursor 单元格行应有 ▶");
  assert.ok(oLine.includes("\x1b[1m"), "cursor 单元格应 bold");
  assert.ok(oLine.includes("\x1b[36m"), "cursor 单元格应 accent");
});

test("render(28) 每行可见宽度 ≤ 28", () => {
  const rows = initRoleRows(SRC);
  const c = mkEditor(rows, new Set([touchedKey(3, "thinking")]), []);
  for (const l of c.render(28)) {
    assert.ok(visibleWidth(l) <= 28, `too wide: ${JSON.stringify(l)}`);
  }
});

test("buildValue：支持 defaultModel、defaultThinking 与 maxThinking，仅写 touched 字段", () => {
  const rows = initRoleRows(SRC);
  const touched = new Set<string>();
  // 修改 defaultModel 行的 model 与 thinking
  rows[0]!.model = "m/newdef";
  touched.add(touchedKey(0, "model"));
  rows[0]!.thinking = "low";
  touched.add(touchedKey(0, "thinking"));
  // 修改 maxThinking 行的 thinking
  rows[1]!.thinking = "high";
  touched.add(touchedKey(1, "thinking"));
  // 修改 oracle 行的 thinking
  rows[2]!.thinking = "xhigh";
  touched.add(touchedKey(2, "thinking"));

  const v = buildValue(SRC, rows, touched);
  assert.equal(v.defaultModel, "m/newdef");
  assert.equal(v.defaultThinking, "low");
  assert.equal(v.maxThinking, "high");
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

test("批量应用 → 单行覆盖 → 恢复：跳过 maxThinking 行，touched 语义正确", () => {
  const rows = initRoleRows(SRC);
  const source = rows.map((r) => ({ ...r }));
  const touched = new Set<string>();
  applyBatchModel(rows, touched, "m/all");
  assert.ok(rows.filter((r) => r.model !== null).every((r) => r.model === "m/all"));
  assert.equal(rows[1]!.model, null); // maxThinking 保持 null
  assert.equal(touched.size, rows.length - 1);
  rows[2]!.model = "m/spec";
  // 单行覆盖仍是 touched
  assert.ok(touched.has(touchedKey(2, "model")));
  revertField(rows, source, touched, 3, "model");
  assert.equal(rows[3]!.model, "m/w");
  assert.ok(!touched.has(touchedKey(3, "model")));
  revertAllModels(rows, source, touched);
  assert.deepEqual(rows.map((r) => r.model), source.map((r) => r.model));
  assert.equal([...touched].filter((k) => k.endsWith(":model")).length, 0);
});

test("changeList：只列 touched 字段的 from→to", () => {
  const rows = initRoleRows(SRC);
  const source = rows.map((r) => ({ ...r }));
  const touched = new Set<string>();
  rows[4]!.thinking = "max";
  touched.add(touchedKey(4, "thinking"));
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
    initialCursor: 5, // oracle:thinking
    theme,
    onCursorChange: (cursor) => positions.push(cursor),
    onDone: () => {},
  });
  assert.equal(c.cursor, 5);
  c.handleInput("j"); // 垂直向下到 worker:thinking (idx 7)
  assert.equal(c.cursor, 7);
  assert.deepEqual(positions, [7]);
});

test("超长模型名 truncateVisible 截断对齐与超过 10 行角色视口滚动", () => {
  const longRows: RoleRow[] = [];
  for (let i = 0; i < 15; i++) {
    longRows.push({
      key: `agent-${i.toString().padStart(2, "0")}`,
      model: `provider/extraordinarily-long-subagent-model-name-variant-${i}`,
      thinking: "high",
    });
  }
  const c = mkEditor(longRows, new Set(), [], "测试超长与滚动");
  const lines = c.render(80);
  for (const l of lines) {
    assert.ok(visibleWidth(l) <= 80, `too wide: ${l}`);
  }
  // 顶端时应指示下方还有剩余项
  assert.ok(lines.some((l) => l.includes("↓ 还有 5 项")));
  assert.ok(lines.some((l) => l.includes("…")), "超长模型名应截断并含 …");

  // 向下移动多次触发展开视口滚动
  for (let i = 0; i < 12; i++) c.handleInput("j");
  const bottomLines = c.render(80);
  assert.ok(bottomLines.some((l) => l.includes("↑ 还有")));
});

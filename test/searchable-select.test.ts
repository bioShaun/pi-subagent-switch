import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createSearchableSelect } from "../src/ui/searchable-select.ts";

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const OPTIONS = [
  "kimi-coding/k3.1-pro",
  "kimi-coding/k3-256k",
  "tcuni-claude/claude-sonnet-5-5",
  "tcuni-claude/claude-opus-5-5",
  "tcuni/gpt-6.1-terra",
];

function make(initialValue?: string, done: Array<string | undefined> = []) {
  return createSearchableSelect({
    title: "worker · model",
    options: OPTIONS,
    initialValue,
    theme,
    onDone: (value) => done.push(value),
  });
}

test("初始光标落在当前模型，直接输入即可不区分大小写过滤", () => {
  const c = make("tcuni-claude/claude-opus-5-5");
  assert.equal(c.cursor, 3);
  c.handleInput("SONNET");
  assert.equal(c.query, "SONNET");
  assert.deepEqual(c.matches, ["tcuni-claude/claude-sonnet-5-5"]);
  assert.equal(c.cursor, 0);
  assert.ok(c.render(80).some((line) => line.includes("1/5 项")));
});

test("j/k 是搜索字符而不是移动键；Backspace 删除后恢复结果", () => {
  const c = make();
  c.handleInput("jk");
  assert.equal(c.query, "jk");
  assert.equal(c.cursor, 0);
  c.handleInput("\x7f");
  c.handleInput("\x7f");
  assert.equal(c.query, "");
  assert.deepEqual(c.matches, OPTIONS);
});

test("方向键回绕，Enter 返回过滤后的选中项", () => {
  const done: Array<string | undefined> = [];
  const c = make(undefined, done);
  c.handleInput("claude");
  c.handleInput("\x1b[A");
  assert.equal(c.cursor, 1);
  c.handleInput("\x1b[B");
  assert.equal(c.cursor, 0);
  c.handleInput("\r");
  assert.deepEqual(done, ["tcuni-claude/claude-sonnet-5-5"]);
});

test("无匹配时：输入非空关键字按 Enter 提交自定义模型名，空关键字不提交；Esc 返回 undefined", () => {
  // 1. 非空关键字无匹配项 → 按 Enter 直接采纳 query.trim()
  const done1: Array<string | undefined> = [];
  const c1 = make(undefined, done1);
  c1.handleInput("my-custom/model-42");
  assert.ok(c1.render(80).some((line) => line.includes("使用自定义模型: \"my-custom/model-42\"")));
  c1.handleInput("\r");
  assert.deepEqual(done1, ["my-custom/model-42"]);

  // 2. 空列表且空关键字 → 按 Enter 不提交
  const done2: Array<string | undefined> = [];
  const c2 = createSearchableSelect({
    title: "custom",
    options: [],
    theme,
    onDone: (v) => done2.push(v),
  });
  c2.handleInput("\r");
  assert.deepEqual(done2, []);

  // 3. Esc 返回 undefined
  c2.handleInput("\x1b");
  assert.deepEqual(done2, [undefined]);
});

test("长列表滚动显示匹配位置，窄终端每行不超宽", () => {
  const options = Array.from({ length: 20 }, (_, i) => `provider/model-${i}`);
  const c = createSearchableSelect({ title: "model", options, theme, onDone: () => {} });
  c.handleInput("\x1b[6~");
  const lines = c.render(40);
  assert.ok(lines.some((line) => line.includes("9/20")));
  assert.ok(lines.some((line) => line.includes("显示")));
  for (const line of lines) assert.ok(visibleWidth(line) <= 40, JSON.stringify(line));
});

test("边框+标题入上边框；选中项 accent+bold，无匹配 warning，提示 muted", () => {
  const FG: Record<string, string> = { accent: "36", text: "37", muted: "90", warning: "33" };
  const marked = {
    fg: (c: string, t: string) => `\x1b[${FG[c] ?? "39"}m${t}\x1b[39m`,
    bold: (t: string) => `\x1b[1m${t}\x1b[22m`,
  };
  const c = createSearchableSelect({ title: "worker · model", options: OPTIONS, theme: marked, onDone: () => {} });
  const lines = c.render(80);
  assert.ok(lines[0]!.startsWith("\x1b[36m") && lines[0]!.includes("\x1b[1mworker · model"), lines[0]);
  assert.ok(lines[lines.length - 1]!.startsWith("\x1b[36m"), lines[lines.length - 1]);
  const selLine = lines.find((l) => l.includes("▶"))!;
  assert.ok(selLine.includes("\x1b[36m") && selLine.includes("\x1b[1m"), selLine);
  assert.ok(lines.some((l) => l.includes("\x1b[37m")), "未选中项应 text");
  assert.ok(lines.some((l) => l.includes("\x1b[90m") && l.includes("Esc")), "快捷键应 muted");
  // 无匹配 → warning
  const c2 = createSearchableSelect({ title: "t", options: OPTIONS, theme: marked, onDone: () => {} });
  c2.handleInput("zzz");
  assert.ok(c2.render(60).some((l) => l.includes("\x1b[33m") && l.includes("没有匹配项")));
});

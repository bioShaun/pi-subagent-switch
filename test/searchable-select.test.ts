import { test } from "node:test";
import assert from "node:assert/strict";
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

test("无匹配时 Enter 不提交；Esc 返回 undefined", () => {
  const done: Array<string | undefined> = [];
  const c = make(undefined, done);
  c.handleInput("not-found");
  assert.ok(c.render(80).some((line) => line.includes("没有匹配项")));
  c.handleInput("\r");
  assert.deepEqual(done, []);
  c.handleInput("\x1b");
  assert.deepEqual(done, [undefined]);
});

test("长列表滚动显示匹配位置，窄终端每行不超宽", () => {
  const options = Array.from({ length: 20 }, (_, i) => `provider/model-${i}`);
  const c = createSearchableSelect({ title: "model", options, theme, onDone: () => {} });
  c.handleInput("\x1b[6~");
  const lines = c.render(40);
  assert.ok(lines.some((line) => line.includes("9/20")));
  assert.ok(lines.some((line) => line.includes("显示")));
  for (const line of lines) assert.ok([...line].length <= 40, JSON.stringify(line));
});

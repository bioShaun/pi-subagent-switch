import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui/dist/utils.js";
import { framedPanel, padVisible } from "../src/ui/frame.ts";

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const marked = {
  fg: (c: string, t: string) => `[${c}]${t}`,
  bold: (t: string) => `<B>${t}</B>`,
};

test("framedPanel：上下边框 + 左右竖线，标题嵌入上边框", () => {
  const lines = framedPanel({
    width: 30,
    title: "Subagent 配置",
    lines: ["行一", "行二"],
    theme,
  });
  assert.equal(lines.length, 4);
  assert.ok(lines[0]!.startsWith("╭"), lines[0]);
  assert.ok(lines[0]!.includes("Subagent 配置"));
  assert.ok(lines[0]!.endsWith("╮"), lines[0]);
  assert.ok(lines[3]!.startsWith("╰") && lines[3]!.endsWith("╯"), lines[3]);
  for (const l of lines.slice(1, 3)) {
    assert.ok(l.startsWith("│") && l.endsWith("│"), JSON.stringify(l));
  }
  for (const l of lines) assert.equal(visibleWidth(l), 30, JSON.stringify(l));
});

test("framedPanel：ANSI 内容按可见宽度补齐，中文宽字符对齐", () => {
  const ansi = "\x1b[31mred\x1b[39m tail";
  const lines = framedPanel({
    width: 20,
    lines: [ansi, "中文宽", "x".repeat(40)],
    theme,
  });
  assert.equal(lines.length, 5);
  for (const l of lines) assert.equal(visibleWidth(l), 20, JSON.stringify(l));
  assert.ok(lines[1]!.includes("red"));
  assert.ok(lines[2]!.includes("中文宽"));
});

test("framedPanel：超长标题截断但角标完整；20/40/80 列均不超宽", () => {
  const title = "非常长长长长长长长长长长长长长长长长的标题";
  for (const w of [20, 40, 80]) {
    const lines = framedPanel({ width: w, title, lines: ["a"], theme });
    for (const l of lines) {
      assert.equal(visibleWidth(l), w, `width=${w} ${JSON.stringify(l)}`);
    }
    assert.ok(lines[0]!.startsWith("╭") && lines[0]!.endsWith("╮"), lines[0]);
    assert.ok(lines[1]!.startsWith("│") && lines[1]!.endsWith("│"), lines[1]);
  }
});

test("framedPanel：极窄宽度降级为简单截断，不抛异常、角标不错位", () => {
  for (const w of [0, 1, 4, 6, 7]) {
    const lines = framedPanel({
      width: w,
      title: "Title",
      lines: ["abcdef", "123"],
      theme,
    });
    for (const l of lines) assert.ok(visibleWidth(l) <= w, `w=${w} ${JSON.stringify(l)}`);
  }
});

test("framedPanel：边框 accent、面板标题 accent + bold，正文不受影响", () => {
  const lines = framedPanel({ width: 24, title: "T", lines: ["body"], theme: marked });
  assert.ok(lines[0]!.startsWith("[accent]"), lines[0]);
  assert.ok(lines[0]!.includes("<B>T</B>"), lines[0]);
  assert.ok(lines[lines.length - 1]!.startsWith("[accent]"), lines[lines.length - 1]);
  // 内容行的竖线也是 accent
  assert.ok(lines[1]!.includes("[accent]│"), lines[1]);
  assert.ok(lines[1]!.includes("body"));
});

test("framedPanel：无标题 → 纯横线上边框", () => {
  const lines = framedPanel({ width: 10, lines: ["a"], theme });
  assert.equal(lines[0], "╭" + "─".repeat(8) + "╮");
});

test("padVisible：按可见宽度补齐，宽字符与 ANSI 正确计算", () => {
  assert.equal(visibleWidth(padVisible("abc", 6)), 6);
  assert.equal(visibleWidth(padVisible("中文", 6)), 6);
  assert.equal(visibleWidth(padVisible("\x1b[31mx\x1b[39m", 4)), 4);
  // 已超宽 → 原样返回（不截断，由调用方截）
  assert.equal(padVisible("abcdefgh", 3), "abcdefgh");
});

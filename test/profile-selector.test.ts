import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createProfileSelector } from "../src/ui/profile-selector.ts";
import type { SelectorResult } from "../src/ui/profile-selector.ts";
import type { Profile } from "../src/profiles.ts";
import type { CurrentProfile } from "../src/current-profile.ts";

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
/** 区分颜色 token 的 ANSI 假主题：visibleWidth 忽略转义序列，不断言行宽。 */
const FG_CODE: Record<string, string> = {
  accent: "36",
  text: "37",
  muted: "90",
  success: "32",
  warning: "33",
  dim: "90",
};
const marked = {
  fg: (c: string, t: string) => `\x1b[${FG_CODE[c] ?? "39"}m${t}\x1b[39m`,
  bold: (t: string) => `\x1b[1m${t}\x1b[22m`,
};
const A = "\x1b[36m"; // accent
const T = "\x1b[37m"; // text
const M = "\x1b[90m"; // muted
const S = "\x1b[32m"; // success
const W = "\x1b[33m"; // warning
const B = "\x1b[1m"; // bold
const custom: CurrentProfile = { name: "custom", matched: false, detail: undefined };

function mk(name: string, defaultModel: string | undefined, overrideCount: number): Profile {
  return {
    name,
    path: `/p/${name}.json`,
    value: {},
    summary: { defaultModel, defaultProvider: undefined, overrideCount },
    source: "package",
  } as Profile;
}

test("初始 cursor 落在当前档索引", () => {
  const profiles = [mk("a", "m", 1), mk("kimi", "k", 8), mk("z", "z", 2)];
  const cur: CurrentProfile = { name: "kimi", matched: true, detail: "/p/kimi.json" };
  const c = createProfileSelector({ profiles, current: cur, theme, onDone: () => {} });
  assert.equal(c.cursor, 1);
});

test("未命中当前档 → cursor 0", () => {
  const profiles = [mk("a", "m", 1), mk("kimi", "k", 8)];
  const c = createProfileSelector({ profiles, current: custom, theme, onDone: () => {} });
  assert.equal(c.cursor, 0);
});

test("down/up/j/k 与回绕（含尾部两个动作行）", () => {
  const profiles = [mk("a", "m", 1), mk("b", "m", 1)]; // 2 档 + 2 动作 = 4 项
  const c = createProfileSelector({ profiles, current: custom, theme, onDone: () => {} });
  assert.equal(c.cursor, 0);
  c.handleInput("\x1b[B"); assert.equal(c.cursor, 1);
  c.handleInput("\x1b[B"); assert.equal(c.cursor, 2);
  c.handleInput("\x1b[B"); assert.equal(c.cursor, 3);
  c.handleInput("\x1b[B"); assert.equal(c.cursor, 0); // 到底回绕到顶
  c.handleInput("j"); assert.equal(c.cursor, 1);
  c.handleInput("\x1b[A"); assert.equal(c.cursor, 0);
  c.handleInput("k"); assert.equal(c.cursor, 3); // 到顶回绕到底
});

test("Enter 应用当前档名", () => {
  const profiles = [mk("a", "m", 1), mk("kimi", "k", 8)];
  const done: Array<SelectorResult | undefined> = [];
  const c = createProfileSelector({ profiles, current: custom, theme, onDone: (r) => done.push(r) });
  c.handleInput("\x1b[B");
  c.handleInput("\r");
  assert.deepEqual(done, [{ kind: "switch", name: "kimi" }]);
});

test("主面板尾部动作行：Enter → new/edit；n/e 快捷键直达", () => {
  const profiles = [mk("a", "m", 1), mk("b", "m", 1)];

  const d1: Array<SelectorResult | undefined> = [];
  const c1 = createProfileSelector({ profiles, current: custom, theme, onDone: (r) => d1.push(r) });
  c1.handleInput("j");
  c1.handleInput("j"); // 第 2 项 = ＋ 新建档
  c1.handleInput("\r");
  assert.deepEqual(d1, [{ kind: "new" }]);

  const d2: Array<SelectorResult | undefined> = [];
  const c2 = createProfileSelector({ profiles, current: custom, theme, onDone: (r) => d2.push(r) });
  for (let i = 0; i < 3; i++) c2.handleInput("j"); // 第 3 项 = ✎ 修改档
  c2.handleInput("\r");
  assert.deepEqual(d2, [{ kind: "edit" }]);

  const d3: Array<SelectorResult | undefined> = [];
  const d4: Array<SelectorResult | undefined> = [];
  createProfileSelector({ profiles, current: custom, theme, onDone: (r) => d3.push(r) }).handleInput("n");
  createProfileSelector({ profiles, current: custom, theme, onDone: (r) => d4.push(r) }).handleInput("e");
  assert.deepEqual(d3, [{ kind: "new" }]);
  assert.deepEqual(d4, [{ kind: "edit" }]);
});

test("Esc / Ctrl+C 取消 → undefined", () => {
  const profiles = [mk("a", "m", 1)];
  const a: Array<SelectorResult | undefined> = [];
  const b: Array<SelectorResult | undefined> = [];
  createProfileSelector({ profiles, current: custom, theme, onDone: (r) => a.push(r) }).handleInput("\x1b");
  createProfileSelector({ profiles, current: custom, theme, onDone: (r) => b.push(r) }).handleInput("\x03");
  assert.deepEqual(a, [undefined]);
  assert.deepEqual(b, [undefined]);
});

test("其它键忽略（不移动、不 onDone）", () => {
  const profiles = [mk("a", "m", 1), mk("b", "m", 1)];
  const done: Array<SelectorResult | undefined> = [];
  const c = createProfileSelector({ profiles, current: custom, theme, onDone: (r) => done.push(r) });
  c.handleInput("x");
  c.handleInput("\x1b[C");
  assert.equal(c.cursor, 0);
  assert.equal(done.length, 0);
});

test("render(40) 边框完整且每行可见宽度 ≤ 40", () => {
  const profiles = [mk("kimi", "kimi-coding/k3.1-pro", 8), mk("gpt", "tcuni/gpt-6.1-terra", 8)];
  const cur: CurrentProfile = { name: "kimi", matched: true, detail: "/p/kimi.json" };
  const c = createProfileSelector({ profiles, current: cur, theme, onDone: () => {} });
  const lines = c.render(40);
  assert.equal(lines.length, 7); // 上边框 + 2 档 + 2 动作 + 1 提示 + 下边框
  assert.ok(lines[0]!.startsWith("╭") && lines[0]!.endsWith("╮"), lines[0]);
  assert.ok(lines[6]!.startsWith("╰") && lines[6]!.endsWith("╯"), lines[6]);
  for (const l of lines) assert.ok(visibleWidth(l) <= 40, `too wide: ${JSON.stringify(l)}`);
});

test("render(80) 标题入上边框；cursor 行 accent+bold；当前档 ● 为 success；末行提示", () => {
  const profiles = [mk("kimi", "kimi-coding/k3.1-pro", 8), mk("gpt", "tcuni/gpt-6.1-terra", 8)];
  const cur: CurrentProfile = { name: "kimi", matched: true, detail: "/p/kimi.json" };
  const c = createProfileSelector({ profiles, current: cur, theme: marked, onDone: () => {} });
  const lines = c.render(80);
  // 上边框：accent + bold 标题
  assert.ok(lines[0]!.startsWith(A), lines[0]);
  assert.ok(lines[0]!.includes(`${B}Subagent 配置`), lines[0]);
  // 第 1 内容行 = cursor+current：accent+bold ▶ 行 + success ●
  assert.ok(lines[1]!.includes("▶"));
  assert.ok(lines[1]!.includes(B), lines[1]);
  assert.ok(lines[1]!.includes(A), lines[1]);
  assert.ok(lines[1]!.includes(S), lines[1]);
  assert.ok(lines[1]!.includes("●"));
  assert.ok(lines[2]!.includes("gpt"));
  assert.ok(lines[3]!.includes("新建"));
  assert.ok(lines[4]!.includes("修改"));
  // 快捷键提示 muted，下边框 accent
  assert.ok(lines[5]!.includes(M) && lines[5]!.includes("Esc"), lines[5]);
  assert.ok(lines[6]!.startsWith(A), lines[6]);
});

test("颜色层级：档名/模型 text、override 数 muted、动作行 text、空列表警告 warning", () => {
  const profiles = [mk("kimi", "kimi-coding/k3.1-pro", 8)];
  const cur: CurrentProfile = { name: "kimi", matched: true, detail: "/p/kimi.json" };
  const c = createProfileSelector({ profiles, current: cur, theme: marked, onDone: () => {} });
  c.handleInput("j"); // cursor → ＋ 新建档 动作行，档行成为非 cursor
  const lines = c.render(80);
  // 非 cursor 档行：text 正文 + muted 计数 + success ●
  assert.ok(lines[1]!.includes(T), lines[1]);
  assert.ok(lines[1]!.includes(`${M}8 overrides`), lines[1]);
  assert.ok(lines[1]!.includes(S), lines[1]);
  // cursor 动作行 accent+bold；非 cursor 动作行 text
  assert.ok(lines[2]!.includes(A) && lines[2]!.includes(B), lines[2]);
  assert.ok(lines[3]!.includes(T), lines[3]);
  const empty = createProfileSelector({ profiles: [], current: custom, theme: marked, onDone: () => {} }).render(60);
  assert.ok(empty.some((l) => l.includes(W) && l.includes("未找到档文件")), empty.join("\n"));
});

test("空档列表 → 提示 + Enter 取消", () => {
  const done: Array<SelectorResult | undefined> = [];
  const c = createProfileSelector({ profiles: [], current: custom, theme, onDone: (r) => done.push(r) });
  const lines = c.render(60);
  assert.ok(lines.some((l) => l.includes("未找到档文件")));
  c.handleInput("\r");
  assert.deepEqual(done, [undefined]);
});

test("invalidate() 为空实现", () => {
  const c = createProfileSelector({ profiles: [mk("a", "m", 1)], current: custom, theme, onDone: () => {} });
  c.invalidate();
  assert.equal(c.cursor, 0);
});

test("r002 缺陷：cursor 移动产生可见反馈——仅 cursor 行 ▶，非 cursor 行两个空格对齐，仅指针行变化", () => {
  const profiles = [
    mk("alpha", "m/a", 1),
    mk("beta", "m/b", 2),
    mk("gamma", "m/c", 3),
  ];
  const c = createProfileSelector({ profiles, current: custom, theme, onDone: () => {} });

  const before = c.render(80);
  assert.equal(before.length, 8); // 上边框 + 3 档 + 2 动作 + 1 提示 + 下边框
  assert.ok(before[1]!.includes("▶ "), `cursor 行应有 ▶：${JSON.stringify(before[1])}`);
  for (const i of [2, 3]) {
    assert.ok(before[i]!.includes("│   "), `非 cursor 行 ${i} 应为两个空格对齐：${JSON.stringify(before[i])}`);
    assert.ok(!before[i]!.includes("▶"), `非 cursor 行 ${i} 不应出现 ▶`);
  }

  c.handleInput("\x1b[B"); // down → cursor 1
  assert.equal(c.cursor, 1);
  const after = c.render(80);
  assert.notDeepEqual(after, before, "cursor 下移后渲染必须变化");
  assert.ok(!after[1]!.includes("▶"));
  assert.ok(after[2]!.includes("▶ "));
  // 仅指针行变化：第 3 档行（始终非指针）与提示行保持不变
  assert.equal(after[3], before[3]);
  assert.equal(after[6], before[6]);

  // up / j / k 同样产生可见反馈
  const back = c.render(80); // cursor 1
  c.handleInput("k"); // up → cursor 0
  const up = c.render(80);
  assert.notDeepEqual(up, back);
  assert.ok(up[1]!.includes("▶ "));
  c.handleInput("j"); // down → cursor 1
  assert.notDeepEqual(c.render(80), up);
});

test("current 标记与 cursor 可分离：current 行 ● 为 success，cursor 行 accent+bold", () => {
  const profiles = [mk("kimi", "kimi-coding/k3.1-pro", 8), mk("gpt", "tcuni/gpt-6.1-terra", 8)];
  const cur: CurrentProfile = { name: "kimi", matched: true, detail: "/p/kimi.json" };
  const c = createProfileSelector({ profiles, current: cur, theme: marked, onDone: () => {} });

  // 初始 cursor 落在当前档（索引 0）：既是 cursor 行又是 current 行
  const initial = c.render(80);
  assert.ok(initial[1]!.includes("▶"));
  assert.ok(initial[1]!.includes("●"));
  assert.ok(initial[1]!.includes(B));
  assert.ok(initial[1]!.includes(S));

  // 下移后 cursor 到 gpt 行；current 行仍保留 ●/success，但不再是 ▶/bold
  c.handleInput("\x1b[B");
  const moved = c.render(80);
  assert.ok(moved[1]!.includes("●"), "current 行仍应有 ●");
  assert.ok(moved[1]!.includes(S), "current 标记应为 success");
  assert.ok(!moved[1]!.includes("▶"), "current 行不再是 cursor 行");
  assert.ok(moved[2]!.includes("▶"), "新 cursor 行应有 ▶");
  assert.ok(moved[2]!.includes(A), "新 cursor 行应 accent");
  assert.ok(!moved[2]!.includes("●"), "新 cursor 行不是 current 行，不应有 ●");
});

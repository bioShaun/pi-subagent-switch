import { test } from "node:test";
import assert from "node:assert/strict";
import { createProfileSelector } from "../src/ui/profile-selector.ts";
import type { SelectorResult } from "../src/ui/profile-selector.ts";
import type { Profile } from "../src/profiles.ts";
import type { CurrentProfile } from "../src/current-profile.ts";

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
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

test("render(40) 每行可见字符 ≤ 40", () => {
  const profiles = [mk("kimi", "kimi-coding/k3.1-pro", 8), mk("gpt", "tcuni/gpt-6.1-terra", 8)];
  const cur: CurrentProfile = { name: "kimi", matched: true, detail: "/p/kimi.json" };
  const c = createProfileSelector({ profiles, current: cur, theme, onDone: () => {} });
  const lines = c.render(40);
  assert.equal(lines.length, 5); // 2 档 + 2 动作 + 1 提示
  for (const l of lines) assert.ok([...l].length <= 40, `too wide: ${JSON.stringify(l)}`);
});

test("render(80) 当前档行尾 ● 且整行 bold；动作行列出向导入口；末行提示", () => {
  const marked = { fg: (_c: string, t: string) => `[dim]${t}`, bold: (t: string) => `<B>${t}</B>` };
  const profiles = [mk("kimi", "kimi-coding/k3.1-pro", 8), mk("gpt", "tcuni/gpt-6.1-terra", 8)];
  const cur: CurrentProfile = { name: "kimi", matched: true, detail: "/p/kimi.json" };
  const c = createProfileSelector({ profiles, current: cur, theme: marked, onDone: () => {} });
  const lines = c.render(80);
  assert.match(lines[0]!, /<B>/);
  assert.ok(lines[0]!.includes("●"));
  assert.ok(lines[1]!.includes("gpt"));
  assert.ok(lines[2]!.includes("新建"));
  assert.ok(lines[3]!.includes("修改"));
  assert.match(lines[4]!, /\[dim\]/);
  assert.ok(lines[4]!.includes("Esc"));
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
  assert.equal(before.length, 6); // 3 档 + 2 动作 + 1 提示
  assert.ok(before[0]!.startsWith("▶ "), `cursor 行应有 ▶：${JSON.stringify(before[0])}`);
  for (const i of [1, 2]) {
    assert.ok(before[i]!.startsWith("  "), `非 cursor 行 ${i} 应以两个空格开头：${JSON.stringify(before[i])}`);
    assert.ok(!before[i]!.includes("▶"), `非 cursor 行 ${i} 不应出现 ▶`);
  }

  c.handleInput("\x1b[B"); // down → cursor 1
  assert.equal(c.cursor, 1);
  const after = c.render(80);
  assert.notDeepEqual(after, before, "cursor 下移后渲染必须变化");
  assert.ok(after[0]!.startsWith("  ") && !after[0]!.includes("▶"));
  assert.ok(after[1]!.startsWith("▶ "));
  // 仅指针行变化：第 2 行（始终非指针）与提示行保持不变
  assert.equal(after[2], before[2]);
  assert.equal(after[5], before[5]);

  // up / j / k 同样产生可见反馈
  const back = c.render(80); // cursor 1
  c.handleInput("k"); // up → cursor 0
  const up = c.render(80);
  assert.notDeepEqual(up, back);
  assert.ok(up[0]!.startsWith("▶ "));
  c.handleInput("j"); // down → cursor 1
  assert.notDeepEqual(c.render(80), up);
});

test("r002：current 行 ●/bold 语义不变，且与 cursor 行可分离", () => {
  const marked = { fg: (_c: string, t: string) => `[dim]${t}`, bold: (t: string) => `<B>${t}</B>` };
  const profiles = [mk("kimi", "kimi-coding/k3.1-pro", 8), mk("gpt", "tcuni/gpt-6.1-terra", 8)];
  const cur: CurrentProfile = { name: "kimi", matched: true, detail: "/p/kimi.json" };
  const c = createProfileSelector({ profiles, current: cur, theme: marked, onDone: () => {} });

  // 初始 cursor 落在当前档（索引 0）：既是 cursor 行又是 current 行
  const initial = c.render(80);
  assert.ok(initial[0]!.includes("▶"));
  assert.ok(initial[0]!.includes("●"));
  assert.match(initial[0]!, /<B>/);

  // 下移后 cursor 到第 1 行；current 行（第 0 行）仍保留 ●/bold，但不再是 ▶
  c.handleInput("\x1b[B");
  const moved = c.render(80);
  assert.ok(moved[0]!.includes("●"), "current 行仍应有 ●");
  assert.match(moved[0]!, /<B>/, "current 行仍应 bold");
  assert.ok(!moved[0]!.includes("▶"), "current 行不再是 cursor 行");
  assert.ok(moved[1]!.includes("▶"), "新 cursor 行应有 ▶");
  assert.ok(!moved[1]!.includes("●"), "新 cursor 行不是 current 行，不应有 ●");
});

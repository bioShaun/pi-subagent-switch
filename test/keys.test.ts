import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKey } from "../src/keys.ts";

test("up / down（ANSI 与应用光标模式）", () => {
  assert.equal(parseKey("\x1b[A"), "up");
  assert.equal(parseKey("\x1bOA"), "up");
  assert.equal(parseKey("\x1b[B"), "down");
  assert.equal(parseKey("\x1bOB"), "down");
});

test("enter", () => {
  assert.equal(parseKey("\r"), "enter");
  assert.equal(parseKey("\n"), "enter");
});

test("escape / ctrl+c", () => {
  assert.equal(parseKey("\x1b"), "escape");
  assert.equal(parseKey("\x03"), "ctrl+c");
});

test("单码点可打印字符 → {char}", () => {
  assert.deepEqual(parseKey("j"), { char: "j" });
  assert.deepEqual(parseKey("k"), { char: "k" });
  assert.deepEqual(parseKey("😀"), { char: "😀" });
});

test("Kitty / CSI-u：方向键、Enter、Escape、Ctrl+C 与 j/k", () => {
  assert.equal(parseKey("\x1b[57419u"), "up");
  assert.equal(parseKey("\x1b[57420u"), "down");
  assert.equal(parseKey("\x1b[57420;1:3u"), "down");
  assert.equal(parseKey("\x1b[13u"), "enter");
  assert.equal(parseKey("\x1b[27u"), "escape");
  assert.equal(parseKey("\x1b[99;5u"), "ctrl+c");
  assert.deepEqual(parseKey("\x1b[106u"), { char: "j" });
  assert.deepEqual(parseKey("\x1b[107u"), { char: "k" });
});

test("无法识别或不支持的按键 → undefined", () => {
  assert.equal(parseKey("\x1b[C"), undefined);
  assert.equal(parseKey("\x1b[1;2B"), undefined);
  assert.equal(parseKey("ab"), undefined);
  assert.equal(parseKey("\x01"), undefined);
  assert.equal(parseKey(""), undefined);
});

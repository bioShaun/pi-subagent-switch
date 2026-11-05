import { test } from "node:test";
import assert from "node:assert/strict";
import { stableStringify } from "../src/stable-json.ts";

test("键递归排序", () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(
    stableStringify({ z: { b: 1, a: 2 }, a: 1 }),
    '{"a":1,"z":{"a":2,"b":1}}',
  );
});

test("数组保序（含数组内对象排序）", () => {
  assert.equal(stableStringify({ a: [3, 1, 2], b: 0 }), '{"a":[3,1,2],"b":0}');
  assert.equal(stableStringify([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]');
});

test("值为 undefined 的键被丢弃", () => {
  assert.equal(stableStringify({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(stableStringify({ a: undefined }), "{}");
});

test("顶层 primitive", () => {
  assert.equal(stableStringify(1), "1");
  assert.equal(stableStringify("x"), '"x"');
  assert.equal(stableStringify(null), "null");
  assert.equal(stableStringify(true), "true");
});

test("键序无关：不同插入序的同值对象相等", () => {
  const a = { defaultModel: "x", agentOverrides: { z: 1, a: 2 } };
  const b = { agentOverrides: { a: 2, z: 1 }, defaultModel: "x" };
  assert.equal(stableStringify(a), stableStringify(b));
});

test("不可序列化值抛 TypeError", () => {
  assert.throws(() => stableStringify({ a: 1n }), TypeError);
});

test("r002 缺陷：JSON.parse 产生的 __proto__ 自有键——顶层/嵌套保留、递归排序、与不同内容不碰撞", () => {
  const a = JSON.parse('{"__proto__":{"model":"a"},"defaultModel":"x"}');
  const without = JSON.parse('{"defaultModel":"x"}');
  const different = JSON.parse('{"__proto__":{"model":"b"},"defaultModel":"x"}');

  // 缺陷复现：普通 {} 累积排序键时 __proto__ 被当成原型 setter 丢掉，
  // 导致含该键的档与不含该键的档序列化结果相等（会错误跳过实际切换）。
  assert.notEqual(
    stableStringify(a),
    stableStringify(without),
    "含 __proto__ 的档与不含该键的档必须可区分",
  );
  assert.equal(
    stableStringify(a),
    '{"__proto__":{"model":"a"},"defaultModel":"x"}',
  );

  // 不同内容不碰撞
  assert.notEqual(stableStringify(a), stableStringify(different));

  // 嵌套 __proto__ 保留并递归排序
  const nested = JSON.parse('{"outer":{"__proto__":{"nested":1},"z":2}}');
  assert.equal(
    stableStringify(nested),
    '{"outer":{"__proto__":{"nested":1},"z":2}}',
  );

  // 原始值形态的 __proto__ 也保留
  const prim = JSON.parse('{"__proto__":1,"a":2}');
  assert.equal(stableStringify(prim), '{"__proto__":1,"a":2}');

  // 输出可被 JSON.parse 且仍保留自有 __proto__ 键
  const round = JSON.parse(stableStringify(a));
  assert.ok(Object.prototype.hasOwnProperty.call(round, "__proto__"));
});

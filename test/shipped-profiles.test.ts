import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSubagents } from "../src/schema.ts";
import { stableStringify } from "../src/stable-json.ts";

const PROFILES = fileURLToPath(new URL("../profiles/", import.meta.url));
const NAMES = ["gpt", "kimi", "claude", "local"] as const;

function read(name: string): any {
  return JSON.parse(nodeFs.readFileSync(join(PROFILES, `${name}.json`), "utf8"));
}

test("4 个随包档逐一通过校验器，且各有 8 个 override", () => {
  for (const n of NAMES) {
    const s = validateSubagents(read(n), n);
    assert.equal(s.overrideCount, 8, `${n} 应有 8 个 override`);
  }
});

test("gpt.json：8 个 override，defaultModel === tcuni/gpt-6.1-terra", () => {
  const gpt = read("gpt");
  assert.equal(gpt.defaultModel, "tcuni/gpt-6.1-terra");
  assert.equal(Object.keys(gpt.agentOverrides).length, 8);
});

test("local.json：所有 model 均为 qwen-local/qwen3.8-27b 且全部 thinking:off", () => {
  const local = read("local");
  assert.equal(local.defaultModel, "qwen-local/qwen3.8-27b");
  for (const ov of Object.values(local.agentOverrides) as any[]) {
    assert.equal(ov.model, "qwen-local/qwen3.8-27b");
    assert.equal(ov.thinking, "off");
  }
});

test("4 档结构一致（除 model/thinking 外字段 stableStringify 相同）", () => {
  const strip = (v: any): string => {
    const clone = structuredClone(v);
    delete clone.defaultModel;
    for (const ov of Object.values(clone.agentOverrides) as any[]) {
      delete ov.model;
      delete ov.thinking;
    }
    return stableStringify(clone);
  };
  const base = strip(read("gpt"));
  for (const n of ["kimi", "claude", "local"]) {
    assert.equal(strip(read(n)), base, `${n} 结构应与 gpt 一致`);
  }
});

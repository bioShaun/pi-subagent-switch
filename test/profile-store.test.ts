import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import { ProfileError } from "../src/schema.ts";
import {
  ProfileStoreError,
  assertProfileName,
  dedupeProfileName,
  normalizeProfileName,
  saveUserProfile,
} from "../src/profile-store.ts";

const fs = nodeFs as unknown as FsLike;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "20261106-0936-profile-wizard");

function tmp(label: string): string {
  nodeFs.mkdirSync(TMP, { recursive: true });
  return nodeFs.mkdtempSync(join(TMP, `${label}-`));
}

const VALID = {
  defaultModel: "m/def",
  agentOverrides: {
    oracle: { model: "m/o", thinking: "high" },
    worker: { model: "m/w", thinking: "medium", tools: ["read", "write"], mutationTools: ["write"] },
  },
};

test("normalizeProfileName：大小写/空白/非法字符归一，空结果报错", () => {
  assert.deepEqual(normalizeProfileName("  My Profile!! "), {
    ok: true,
    name: "my-profile",
  });
  assert.deepEqual(normalizeProfileName("kimi"), { ok: true, name: "kimi" });
  const bad = normalizeProfileName("!!!");
  assert.equal(bad.ok, false);
  const empty = normalizeProfileName("   ");
  assert.equal(empty.ok, false);
  const long = normalizeProfileName("a".repeat(80));
  assert.equal(long.ok, false);
});

test("assertProfileName / dedupeProfileName：合法名放行，重名自动 -2/-3", () => {
  assert.doesNotThrow(() => assertProfileName("my-profile_2.x"));
  assert.throws(() => assertProfileName("../evil"), ProfileStoreError);
  assert.throws(() => assertProfileName("Bad Name"), ProfileStoreError);
  assert.throws(() => assertProfileName("a".repeat(65)), ProfileStoreError);
  const taken = new Set(["kimi", "kimi-2"]);
  assert.deepEqual(dedupeProfileName("kimi", taken), { name: "kimi-3", changed: true });
  assert.deepEqual(dedupeProfileName("other", taken), { name: "other", changed: false });
});

test("新档：schema 校验后同目录原子写，0o600，无备份，无临时文件残留", () => {
  const dir = tmp("store-new");
  const res = saveUserProfile({ fs, dir }, "fresh", VALID);
  const target = join(dir, "fresh.json");
  assert.equal(res.path, target);
  assert.equal(res.backupPath, undefined);
  assert.equal(
    nodeFs.readFileSync(target, "utf8"),
    JSON.stringify(VALID, null, 2) + "\n",
  );
  assert.equal(nodeFs.statSync(target).mode & 0o777, 0o600);
  assert.equal(
    nodeFs.readdirSync(dir).filter((f) => f.endsWith(".tmp") || f.includes(".bak-")).length,
    0,
  );
  assert.ok(res.bytes > 0);
});

test("用户档目录缺失：mkdir 递归创建后写入；fs 无 mkdirSync 则报 ProfileStoreError", () => {
  const base = tmp("store-mkdir");
  const dir = join(base, "a", "b", "subagent-profiles");
  saveUserProfile({ fs, dir }, "deep", VALID);
  assert.ok(nodeFs.existsSync(join(dir, "deep.json")));

  const noMkdir = {
    existsSync: nodeFs.existsSync.bind(nodeFs),
    readFileSync: nodeFs.readFileSync.bind(nodeFs),
    writeFileSync: nodeFs.writeFileSync.bind(nodeFs),
    renameSync: nodeFs.renameSync.bind(nodeFs),
    unlinkSync: nodeFs.unlinkSync.bind(nodeFs),
    statSync: nodeFs.statSync.bind(nodeFs),
    readdirSync: nodeFs.readdirSync.bind(nodeFs),
  } as unknown as FsLike;
  const dir2 = join(base, "no-such-dir");
  assert.throws(() => saveUserProfile({ fs: noMkdir, dir: dir2 }, "x", VALID), ProfileStoreError);
  assert.equal(nodeFs.existsSync(dir2), false);
});

test("修改已存在的用户档：先备份原始字节（0o600）再覆盖；原 mode 保留", () => {
  const dir = tmp("store-edit");
  const target = join(dir, "mine.json");
  const ORIGINAL = '{\n  "defaultModel": "m/old",\n  "custom": true\n}\n';
  nodeFs.writeFileSync(target, ORIGINAL, { mode: 0o640 });
  const res = saveUserProfile(
    { fs, dir, now: () => new Date("2026-11-06T12:00:00") },
    "mine",
    VALID,
  );
  assert.ok(res.backupPath, "应产生备份");
  assert.match(res.backupPath!, /mine\.json\.bak-20261106-120000$/);
  assert.equal(nodeFs.readFileSync(res.backupPath!, "utf8"), ORIGINAL);
  assert.equal(nodeFs.statSync(res.backupPath!).mode & 0o777, 0o600);
  assert.equal(
    nodeFs.readFileSync(target, "utf8"),
    JSON.stringify(VALID, null, 2) + "\n",
  );
  assert.equal(nodeFs.statSync(target).mode & 0o777, 0o640);
});

test("schema 非法 → 抛 ProfileError，目录内零产物", () => {
  const dir = tmp("store-schema");
  const bad = { defaultModel: "m/x", agentOverrides: { w: { fallbackModels: ["a"] } } };
  assert.throws(() => saveUserProfile({ fs, dir }, "bad", bad), ProfileError);
  assert.equal(nodeFs.readdirSync(dir).length, 0);
});

test("非法档名 → ProfileStoreError，不落盘", () => {
  const dir = tmp("store-name");
  assert.throws(
    () => saveUserProfile({ fs, dir }, "../escape", VALID),
    ProfileStoreError,
  );
  assert.throws(
    () => saveUserProfile({ fs, dir }, "has space", VALID),
    ProfileStoreError,
  );
  assert.equal(nodeFs.readdirSync(dir).length, 0);
});

test("renameSync 失败 → 清理临时文件后重抛，原文件不动", () => {
  const dir = tmp("store-rename");
  const target = join(dir, "keep.json");
  const ORIGINAL = '{"defaultModel":"m/old"}\n';
  nodeFs.writeFileSync(target, ORIGINAL);
  const boomFs = {
    ...fs,
    renameSync: () => {
      throw new Error("rename boom");
    },
  } as FsLike;
  assert.throws(
    () => saveUserProfile({ fs: boomFs, dir }, "keep", VALID),
    /rename boom/,
  );
  assert.equal(nodeFs.readFileSync(target, "utf8"), ORIGINAL);
  assert.equal(nodeFs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
});

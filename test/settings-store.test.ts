import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import { sha256 } from "../src/fs.ts";
import {
  ABSENT_FINGERPRINT,
  SettingsStoreError,
  readSettings,
  withSubagents,
  writeSettings,
  backupPathFor,
} from "../src/settings-store.ts";

const fs = nodeFs as unknown as FsLike;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "20261106-0009-subagent-switch-implementation");

function tmp(label: string): string {
  nodeFs.mkdirSync(TMP, { recursive: true });
  return nodeFs.mkdtempSync(join(TMP, `${label}-`));
}

test("readSettings: 缺文件 → existed:false / doc:{} / absent 指纹 / 无 raw、mode", () => {
  const p = join(tmp("missing"), "settings.json");
  const s = readSettings(fs, p);
  assert.equal(s.existed, false);
  assert.deepEqual(s.doc, {});
  assert.equal(s.fingerprint, ABSENT_FINGERPRINT);
  assert.equal(s.raw, undefined);
  assert.equal(s.mode, undefined);
});

test("readSettings: 非法 JSON / 非对象根 → SettingsStoreError", () => {
  const p = join(tmp("badjson"), "settings.json");
  nodeFs.writeFileSync(p, "{ nope");
  assert.throws(() => readSettings(fs, p), SettingsStoreError);
  const p2 = join(tmp("array"), "settings.json");
  nodeFs.writeFileSync(p2, "[1,2]");
  assert.throws(() => readSettings(fs, p2), SettingsStoreError);
});

test("readSettings: fingerprint = sha256(raw)，mode 保留 0o777 位", () => {
  const p = join(tmp("fp"), "settings.json");
  const raw = '{"theme":"dark","subagents":{}}\n';
  nodeFs.writeFileSync(p, raw, { mode: 0o600 });
  nodeFs.chmodSync(p, 0o600);
  const s = readSettings(fs, p);
  assert.equal(s.existed, true);
  assert.equal(s.fingerprint, sha256(Buffer.from(raw)));
  assert.equal(s.mode, 0o600);
  assert.equal(s.raw?.toString("utf8"), raw);
  assert.equal(s.doc.theme, "dark");
});

test("withSubagents: 整块替换顶层 subagents、其它键深相等、不改入参", () => {
  const doc = { theme: "dark", packages: ["a"], subagents: { old: true } };
  const next = withSubagents(doc, { defaultModel: "x", agentOverrides: { w: 1 } });
  assert.deepEqual(next.subagents, { defaultModel: "x", agentOverrides: { w: 1 } });
  assert.equal(next.theme, "dark");
  assert.deepEqual(next.packages, ["a"]);
  assert.deepEqual(doc.subagents, { old: true });
  assert.notEqual(next.subagents, doc.subagents);
});

test("backupPathFor 格式", () => {
  assert.equal(
    backupPathFor("/a/settings.json", "20261106-001122"),
    "/a/settings.json.bak-20261106-001122",
  );
});

test("writeSettings: 2 空格+尾换行、备份 wx/0o600/逐字节、temp wx + mode 保留 + rename", () => {
  const dir = tmp("write");
  const p = join(dir, "settings.json");
  const raw = '{"theme":"dark","subagents":{"defaultModel":"old"}}';
  nodeFs.writeFileSync(p, raw, { mode: 0o600 });
  nodeFs.chmodSync(p, 0o600);
  const snapshot = readSettings(fs, p);
  const doc = { theme: "dark", subagents: { defaultModel: "new" } };
  const stamp = "20261106-010203";
  const res = writeSettings(fs, p, doc, { snapshot, stamp });
  const written = nodeFs.readFileSync(p, "utf8");
  assert.equal(written, JSON.stringify(doc, null, 2) + "\n");
  assert.equal(res.fingerprint, sha256(written));
  assert.equal(res.backupPath, backupPathFor(p, stamp));
  const backup = res.backupPath!;
  assert.equal(nodeFs.readFileSync(backup, "utf8"), raw);
  assert.equal(nodeFs.statSync(backup).mode & 0o777, 0o600);
  assert.equal(nodeFs.statSync(p).mode & 0o777, 0o600);
  assert.deepEqual(nodeFs.readdirSync(dir).sort(), [basename(backup), "settings.json"].sort());
});

test("writeSettings: 指纹不一致 → 中止且不写入", () => {
  const dir = tmp("fpconflict");
  const p = join(dir, "settings.json");
  nodeFs.writeFileSync(p, '{"subagents":{"a":1}}');
  const snapshot = readSettings(fs, p);
  const tampered = '{"subagents":{"a":2},"theme":"x"}';
  nodeFs.writeFileSync(p, tampered);
  assert.throws(
    () => writeSettings(fs, p, { subagents: { b: 3 } }, { snapshot, stamp: "s1" }),
    SettingsStoreError,
  );
  assert.equal(nodeFs.readFileSync(p, "utf8"), tampered);
  assert.equal(nodeFs.readdirSync(dir).length, 1);
});

test("writeSettings: 缺文件时 existed:false，不生成备份", () => {
  const dir = tmp("nobak");
  const p = join(dir, "settings.json");
  const snapshot = readSettings(fs, p);
  const res = writeSettings(fs, p, { subagents: { a: 1 } }, { snapshot, stamp: "s1" });
  assert.equal(res.backupPath, undefined);
  assert.equal(nodeFs.readdirSync(dir).length, 1);
  assert.equal(
    nodeFs.readFileSync(p, "utf8"),
    JSON.stringify({ subagents: { a: 1 } }, null, 2) + "\n",
  );
});

test("writeSettings: 同 stamp 备份 wx 冲突报错", () => {
  const dir = tmp("bakcollision");
  const p = join(dir, "settings.json");
  nodeFs.writeFileSync(p, '{"subagents":{"a":1}}');
  const snapshot = readSettings(fs, p);
  writeSettings(fs, p, { subagents: { a: 2 } }, { snapshot, stamp: "same" });
  const snap2 = readSettings(fs, p);
  assert.throws(() =>
    writeSettings(fs, p, { subagents: { a: 3 } }, { snapshot: snap2, stamp: "same" }),
  );
});

test("writeSettings: rename 失败 → 清理临时文件且 settings 不变", () => {
  const dir = tmp("renamefail");
  const p = join(dir, "settings.json");
  const raw = '{"subagents":{"a":1}}';
  nodeFs.writeFileSync(p, raw);
  const snapshot = readSettings(fs, p);
  const faultFs = {
    ...(fs as object),
    renameSync: (_from: string, _to: string): void => {
      throw new Error("rename boom");
    },
  } as unknown as FsLike;
  assert.throws(
    () => writeSettings(faultFs, p, { subagents: { b: 2 } }, { snapshot, stamp: "s1" }),
    /rename boom/,
  );
  assert.equal(nodeFs.readFileSync(p, "utf8"), raw);
  assert.equal(nodeFs.readdirSync(dir).filter((n) => n.endsWith(".tmp")).length, 0);
});

import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FsLike } from "../src/fs.ts";
import { resolveProfileDirs, loadProfiles, findProfile } from "../src/profiles.ts";
import { ProfileError } from "../src/schema.ts";

const fs = nodeFs as unknown as FsLike;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TMP = join(ROOT, ".tmp", "profiles");

function tmp(label: string): string {
  nodeFs.mkdirSync(TMP, { recursive: true });
  return nodeFs.mkdtempSync(join(TMP, `${label}-`));
}
const VALID = JSON.stringify({
  defaultModel: "m/x",
  agentOverrides: { w: { model: "m/x" } },
});
function put(dir: string, name: string, content: string): void {
  nodeFs.mkdirSync(dir, { recursive: true });
  nodeFs.writeFileSync(join(dir, name), content);
}
function roots(
  ...pairs: Array<[string, "user" | "package"]>
): Array<{ dir: string; source: "user" | "package" }> {
  return pairs.map(([dir, source]) => ({ dir, source }));
}

test("resolveProfileDirs: 默认 [user, package]", () => {
  const dirs = resolveProfileDirs({
    agentDir: "/home/u/.pi/agent", packageRoot: "/pkg", env: {},
  });
  assert.deepEqual(dirs, [
    { dir: join("/home/u/.pi/agent", "subagent-profiles"), source: "user" },
    { dir: join("/pkg", "profiles"), source: "package" },
  ]);
});

test("resolveProfileDirs: env 覆盖（trim）且不回退", () => {
  const dirs = resolveProfileDirs({
    agentDir: "/a", packageRoot: "/p",
    env: { PI_SUBAGENT_PROFILES_DIR: "  /custom  " },
  });
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0]!.dir, "/custom");
  assert.equal(dirs[0]!.source, "user");
});

test("resolveProfileDirs: env 空白视为未设置", () => {
  const dirs = resolveProfileDirs({
    agentDir: "/a", packageRoot: "/p",
    env: { PI_SUBAGENT_PROFILES_DIR: "   " },
  });
  assert.equal(dirs.length, 2);
});

test("按名合并（Per-profile Shadowing）：user 优先且未重名 package 保留，同名损坏档屏蔽", () => {
  const u = tmp("user");
  const p = tmp("pkg");
  const userDir = join(u, "subagent-profiles");
  const pkgDir = join(p, "profiles");

  // a: 仅 user 有
  put(userDir, "a.json", JSON.stringify({ defaultModel: "user/a", agentOverrides: {} }));
  // b: 仅 package 有
  put(pkgDir, "b.json", JSON.stringify({ defaultModel: "pkg/b", agentOverrides: {} }));
  // c: 两处均有，user 覆盖 package
  put(userDir, "c.json", JSON.stringify({ defaultModel: "user/c", agentOverrides: {} }));
  put(pkgDir, "c.json", JSON.stringify({ defaultModel: "pkg/c", agentOverrides: {} }));
  // d: user 损坏档，package 是合法档；损坏档屏蔽 package 且进 errors
  put(userDir, "d.json", "{ broken json");
  put(pkgDir, "d.json", JSON.stringify({ defaultModel: "pkg/d", agentOverrides: {} }));

  const set = loadProfiles({
    fs,
    roots: roots([userDir, "user"], [pkgDir, "package"]),
  });

  assert.deepEqual(set.profiles.map((x) => x.name), ["a", "b", "c"]);
  const a = set.profiles.find((x) => x.name === "a");
  const b = set.profiles.find((x) => x.name === "b");
  const c = set.profiles.find((x) => x.name === "c");

  assert.equal(a?.source, "user");
  assert.equal(a?.summary.defaultModel, "user/a");
  assert.equal(b?.source, "package");
  assert.equal(b?.summary.defaultModel, "pkg/b");
  assert.equal(c?.source, "user");
  assert.equal(c?.summary.defaultModel, "user/c");

  assert.equal(set.usedDir?.source, "user");
  assert.equal(set.errors.length, 1);
  assert.equal(set.errors[0]?.profile, "d");
  assert.equal(set.errors[0]?.kind, "invalid-json");
});

test("user 空目录 → 回退 package", () => {
  const u = tmp("user");
  const p = tmp("pkg");
  nodeFs.mkdirSync(join(u, "subagent-profiles"), { recursive: true });
  put(join(p, "profiles"), "b.json", VALID);
  const set = loadProfiles({
    fs,
    roots: roots([join(u, "subagent-profiles"), "user"], [join(p, "profiles"), "package"]),
  });
  assert.deepEqual(set.profiles.map((x) => x.name), ["b"]);
  assert.equal(set.usedDir?.source, "package");
});

test("目录全部缺失 → 空集且不抛错", () => {
  const set = loadProfiles({
    fs,
    roots: roots([join(TMP, "nope1"), "user"], [join(TMP, "nope2"), "package"]),
  });
  assert.deepEqual(set.profiles, []);
  assert.equal(set.usedDir, undefined);
});

test("跳过 . 前缀文件 + .json 大小写不敏感", () => {
  const d = tmp("skip");
  put(d, "a.json", VALID);
  put(d, "B.JSON", VALID);
  put(d, ".hidden.json", "{ broken");
  const set = loadProfiles({ fs, roots: roots([d, "user"]) });
  assert.equal(set.profiles.length, 2);
  assert.ok(set.profiles.some((x) => x.name === "a"));
  assert.ok(set.profiles.some((x) => x.name === "B"));
  assert.equal(set.errors.length, 0);
});

test("非法 JSON / 非法 schema 进 errors，其它档仍可用", () => {
  const d = tmp("errors");
  put(d, "a.json", VALID);
  put(d, "broken.json", "{ not json");
  put(d, "schema.json", JSON.stringify({ agentOverrides: { w: { fallbackModels: [] } } }));
  const set = loadProfiles({ fs, roots: roots([d, "user"]) });
  assert.deepEqual(set.profiles.map((x) => x.name), ["a"]);
  assert.equal(set.errors.length, 2);
  assert.ok(set.errors.every((e) => e instanceof ProfileError));
  assert.deepEqual(set.errors.map((e) => e.kind).sort(), ["invalid-json", "invalid-schema"]);
});

test("档按 name 升序", () => {
  const d = tmp("sort");
  put(d, "zeta.json", VALID);
  put(d, "alpha.json", VALID);
  put(d, "mid.json", VALID);
  const set = loadProfiles({ fs, roots: roots([d, "user"]) });
  assert.deepEqual(set.profiles.map((x) => x.name), ["alpha", "mid", "zeta"]);
});

test("findProfile: 允许省略 .json 后缀", () => {
  const d = tmp("find");
  put(d, "kimi.json", VALID);
  const set = loadProfiles({ fs, roots: roots([d, "user"]) });
  assert.equal(findProfile(set, "kimi").name, "kimi");
  assert.equal(findProfile(set, "kimi.json").name, "kimi");
});

test("findProfile: 名字大小写敏感", () => {
  const d = tmp("case");
  put(d, "kimi.json", VALID);
  const set = loadProfiles({ fs, roots: roots([d, "user"]) });
  assert.throws(
    () => findProfile(set, "Kimi"),
    (e: unknown) => e instanceof ProfileError && e.kind === "not-found",
  );
});

test("findProfile: 同名损坏档抛原始错误而非 not-found", () => {
  const d = tmp("corrupt");
  put(d, "broken.json", "{ not json");
  const set = loadProfiles({ fs, roots: roots([d, "user"]) });
  assert.throws(
    () => findProfile(set, "broken"),
    (e: unknown) => e instanceof ProfileError && e.kind === "invalid-json",
  );
});

test("findProfile: 不存在 → not-found 且列出可用档名", () => {
  const d = tmp("nf");
  put(d, "a.json", VALID);
  put(d, "b.json", VALID);
  const set = loadProfiles({ fs, roots: roots([d, "user"]) });
  assert.throws(
    () => findProfile(set, "zzz"),
    (e: unknown) => {
      assert.ok(e instanceof ProfileError);
      assert.equal(e.kind, "not-found");
      assert.match(e.message, /a/);
      assert.match(e.message, /b/);
      return true;
    },
  );
});

after(() => {
  nodeFs.rmSync(TMP, { recursive: true, force: true });
  try {
    nodeFs.rmdirSync(join(ROOT, ".tmp"));
  } catch {
    // 其它并发测试文件尚未结束时忽略
  }
});

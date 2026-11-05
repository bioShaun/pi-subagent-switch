/**
 * subagents schema 校验器 —— 对齐 pi-subagents 0.85.0。
 * 字段来源：agents.js:41-47（BUILTIN_OVERRIDE_FIELDS）、:761-945（单条 override）、
 * :946+（readSubagentSettings 顶层）、model-scope.js:142-167（modelScope）。
 * 与 pi-subagent-cfg 的旧校验器不共用：0.85.0 已移除 fallbackModels / launcher。
 */

export const THINKING_LEVELS = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

export type ProfileErrorKind =
  | "invalid-json"
  | "unreadable"
  | "invalid-schema"
  | "not-found"
  | "no-profiles";

export class ProfileError extends Error {
  readonly kind: ProfileErrorKind;
  readonly profile: string | undefined;
  readonly field: string | undefined;

  constructor(
    kind: ProfileErrorKind,
    message: string,
    extra?: { profile?: string; field?: string },
  ) {
    super(message);
    this.name = "ProfileError";
    this.kind = kind;
    this.profile = extra?.profile;
    this.field = extra?.field;
  }
}

export interface SubagentsSummary {
  defaultModel: string | undefined;
  defaultProvider: string | undefined;
  overrideCount: number;
}

const THINKING_SET: ReadonlySet<string> = new Set<string>(THINKING_LEVELS);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const BOOL_KEYS = new Set([
  "advertise", "fast", "inheritProjectContext", "inheritGlobalContext",
  "inheritSkills", "disabled", "allowNestedSubagents",
]);
const STRING_ARRAY_OR_FALSE = new Set([
  "defaultReads", "skills", "excludeTools", "allowedAgents",
  "extensions", "subagentOnlyExtensions", "mutationTools",
]);
const TOP_KEYS = new Set([
  "defaultModel", "defaultProvider", "defaultThinking", "maxThinking",
  "defaultExtensions", "defaultSubagentOnlyExtensions", "agentScanDirs",
  "agentExcludeDirs", "disableBuiltins", "disableThinking", "modelScope",
  "agentOverrides", "agentOverridesByProvider",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => isNonEmptyString(x));
}
function fail(message: string, profile: string, field?: string): never {
  const path = field ?? "(root)";
  throw new ProfileError(
    "invalid-schema",
    `档 "${profile}" 字段 ${path}: ${message}`,
    { profile, field },
  );
}

function validateOverride(ov: unknown, path: string, profile: string): void {
  if (!isPlainObject(ov)) fail("override 必须是对象", profile, path);
  for (const key of Object.keys(ov)) {
    const p = `${path}.${key}`;
    const v = ov[key];
    if (key === "fallbackModels") {
      fail("该字段在 pi-subagents 0.85.0 已移除（agents.js:766-768），请只配置一个 model", profile, p);
    }
    if (key === "launcher") {
      fail("该字段不能出现在 settings override 中（agents.js:769-771），请在用户级 agent 文件中设置", profile, p);
    }
    switch (key) {
      case "description":
        if (!isNonEmptyString(v)) fail("必须是非空字符串", profile, p);
        break;
      case "machine":
        if (!(v === false || (isNonEmptyString(v) && v.length <= 128 && !CONTROL_CHARS.test(v)))) {
          fail("必须是 false 或长度 ≤128 且无控制字符的非空字符串", profile, p);
        }
        break;
      case "output":
        if (!(v === false || isNonEmptyString(v))) fail("必须是非空字符串或 false", profile, p);
        break;
      case "outputMode":
        if (v !== "inline" && v !== "file-only") fail("必须是 inline 或 file-only", profile, p);
        break;
      case "model":
        if (!(typeof v === "string" || v === false)) fail("必须是字符串或 false", profile, p);
        break;
      case "defaultProvider":
        if (!(v === false || isNonEmptyString(v))) fail("必须是非空字符串或 false", profile, p);
        break;
      case "thinking":
        if (!(v === false || (typeof v === "string" && THINKING_SET.has(v)))) {
          fail("必须是 THINKING_LEVELS 之一或 false", profile, p);
        }
        break;
      case "systemPromptMode":
        if (v !== "append" && v !== "replace") fail("必须是 append 或 replace", profile, p);
        break;
      case "defaultContext":
        if (v !== "fresh" && v !== "fork" && v !== false) fail("必须是 fresh / fork / false", profile, p);
        break;
      case "acceptanceRole":
        if (v !== "read-only" && v !== "writer" && v !== false) {
          fail("必须是 read-only / writer / false", profile, p);
        }
        break;
      case "toolBudget":
        if (!(v === false || isPlainObject(v))) fail("必须是对象或 false", profile, p);
        break;
      case "systemPrompt":
        if (typeof v !== "string") fail("必须是字符串", profile, p);
        break;
      case "tools":
        if (!(v === false || v === "inherit" || isStringArray(v))) {
          fail('必须是非空字符串数组 / "inherit" / false', profile, p);
        }
        break;
      default:
        if (BOOL_KEYS.has(key)) {
          if (typeof v !== "boolean") fail("必须是 boolean", profile, p);
        } else if (STRING_ARRAY_OR_FALSE.has(key)) {
          if (!(v === false || isStringArray(v))) fail("必须是非空字符串数组或 false", profile, p);
        } else {
          fail(`未知字段 "${key}"`, profile, p);
        }
    }
  }
}

function validateModelScope(v: unknown, path: string, profile: string): void {
  if (!isPlainObject(v)) fail("modelScope 必须是对象", profile, path);
  for (const key of Object.keys(v)) {
    const p = `${path}.${key}`;
    const vv = v[key];
    if (key === "allow") {
      if (!isStringArray(vv)) fail("必须是非空字符串数组", profile, p);
      continue;
    }
    if (key === "enforce" || key === "strict") {
      if (typeof vv !== "boolean") fail("必须是 boolean", profile, p);
      continue;
    }
    if (key === "agents") {
      if (!isPlainObject(vv)) fail("agents 必须是对象", profile, p);
      for (const agent of Object.keys(vv)) {
        const entry = vv[agent];
        const ep = `${p}.${agent}`;
        if (!isPlainObject(entry)) fail("必须是对象", profile, ep);
        for (const k2 of Object.keys(entry)) {
          const v2 = entry[k2];
          const e2p = `${ep}.${k2}`;
          if (k2 === "agents") {
            fail("modelScope.agents.<n> 内不允许嵌套 agents（model-scope.js:155-157）", profile, e2p);
          }
          if (k2 === "allow") {
            if (!isStringArray(v2)) fail("必须是非空字符串数组", profile, e2p);
            continue;
          }
          if (k2 === "enforce" || k2 === "strict") {
            if (typeof v2 !== "boolean") fail("必须是 boolean", profile, e2p);
            continue;
          }
          fail(`未知字段 "${k2}"`, profile, e2p);
        }
      }
      continue;
    }
    fail(`未知字段 "${key}"`, profile, p);
  }
}

/** 校验一个 `subagents` 值（不修改入参、不做 trim 归一化，保证写回内容与手写档逐字一致）。 */
export function validateSubagents(value: unknown, profileName: string): SubagentsSummary {
  if (!isPlainObject(value)) fail("subagents 必须是对象", profileName);
  const obj = value;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (!TOP_KEYS.has(key)) fail(`未知字段 "${key}"`, profileName, key);
    switch (key) {
      case "defaultModel":
      case "defaultProvider":
      case "defaultThinking":
        if (!isNonEmptyString(v)) fail("必须是非空字符串", profileName, key);
        break;
      case "maxThinking":
        if (typeof v !== "string" || !THINKING_SET.has(v)) {
          fail("必须是 THINKING_LEVELS 之一", profileName, key);
        }
        break;
      case "defaultExtensions":
      case "defaultSubagentOnlyExtensions":
      case "agentScanDirs":
      case "agentExcludeDirs":
        if (!isStringArray(v)) fail("必须是非空字符串数组", profileName, key);
        break;
      case "disableBuiltins":
      case "disableThinking":
        if (typeof v !== "boolean") fail("必须是 boolean", profileName, key);
        break;
      case "modelScope":
        validateModelScope(v, key, profileName);
        break;
      case "agentOverrides":
        if (!isPlainObject(v)) fail("agentOverrides 必须是对象", profileName, key);
        for (const agent of Object.keys(v)) {
          validateOverride(v[agent], `${key}.${agent}`, profileName);
        }
        break;
      case "agentOverridesByProvider":
        if (!isPlainObject(v)) fail("agentOverridesByProvider 必须是对象", profileName, key);
        for (const provider of Object.keys(v)) {
          const agents = v[provider];
          if (!isPlainObject(agents)) fail("必须是对象", profileName, `${key}.${provider}`);
          for (const agent of Object.keys(agents)) {
            validateOverride(agents[agent], `${key}.${provider}.${agent}`, profileName);
          }
        }
        break;
    }
  }
  return {
    defaultModel: typeof obj.defaultModel === "string" ? obj.defaultModel : undefined,
    defaultProvider: typeof obj.defaultProvider === "string" ? obj.defaultProvider : undefined,
    overrideCount: isPlainObject(obj.agentOverrides) ? Object.keys(obj.agentOverrides).length : 0,
  };
}

import { basename } from "node:path";
import type { FsLike } from "./fs.ts";
import { findProfile, loadProfiles } from "./profiles.ts";
import type { Profile, ProfileRoot, ProfileSet } from "./profiles.ts";
import { THINKING_LEVELS } from "./schema.ts";
import { applyProfile } from "./apply-profile.ts";
import {
  dedupeProfileName,
  normalizeProfileName,
  saveUserProfile,
} from "./profile-store.ts";
import {
  applyBatchModel,
  buildValue,
  changeList,
  createRoleEditor,
  initRoleRows,
  revertAllModels,
  revertField,
  roleEditorTheme,
  touchedKey,
} from "./ui/role-editor.ts";
import type { RoleEditorAction, RoleRow } from "./ui/role-editor.ts";

export type WizardKind = "new" | "edit";
export type WizardNotify = (message: string, level: "info" | "warning" | "error") => void;

/** 模型/思考选择列表末位的「恢复原值（移除本次改动）」选项。 */
export const REVERT_OPTION = "↩ 恢复原值（移除本次改动）";

/** 向导用到的宿主 UI 子集；与 PiUIContext 结构兼容。 */
export interface WizardUI {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  select(title: string, options: readonly string[]): Promise<string | undefined>;
  custom<T>(
    factory: (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
      done: (result: T) => void,
    ) => unknown,
    options?: { overlay?: boolean },
  ): Promise<T | undefined>;
  notify: WizardNotify;
}

export interface ConfigureDeps {
  readonly fs: FsLike;
  readonly settingsPath: string;
  /** loadProfiles 用的全部候选根（写后重载用）。 */
  readonly roots: readonly ProfileRoot[];
  /** 可写用户档目录（env 根或 agentDir/subagent-profiles）。 */
  readonly userDir: string;
  readonly ui: WizardUI;
  /** 可用模型名（`${provider}/${id}`），来自 modelRegistry.getAvailable()。 */
  readonly models: readonly string[];
  readonly now?: () => Date;
}

export interface WizardOutcome {
  readonly status: "created" | "saved" | "cancelled";
  readonly name?: string;
  readonly path?: string;
  readonly backupPath?: string;
  readonly applied?: boolean;
  readonly copiedFromPackage?: boolean;
  readonly changedFields?: number;
}

interface RoleSession {
  rows: RoleRow[];
  sourceRows: RoleRow[];
  touched: Set<string>;
}

function cancelled(deps: ConfigureDeps): WizardOutcome {
  deps.ui.notify("已取消，未做任何改动", "info");
  return { status: "cancelled" };
}

/** 已占用档名 = 已加载档 + 损坏档 + 用户档目录里的其它 *.json 文件主干。 */
function takenNames(deps: ConfigureDeps, set: ProfileSet): Set<string> {
  const taken = new Set(set.profiles.map((p) => p.name));
  for (const e of set.errors) {
    if (e.profile) taken.add(e.profile);
  }
  try {
    if (deps.fs.existsSync(deps.userDir)) {
      for (const f of deps.fs.readdirSync(deps.userDir)) {
        if (/\.json$/i.test(f) && !f.startsWith(".")) {
          taken.add(f.replace(/\.json$/i, ""));
        }
      }
    }
  } catch {
    // 目录不可读时只用已知名
  }
  return taken;
}

/** 角色配置面板循环：pick/batch 用宿主原生 select，面板本身用 ctx.ui.custom。 */
async function editRoles(
  deps: ConfigureDeps,
  title: string,
  source: Profile["value"],
): Promise<RoleSession | undefined> {
  const { ui, models } = deps;
  const rows = initRoleRows(source);
  const sourceRows = rows.map((r) => ({ ...r }));
  const touched = new Set<string>();
  for (;;) {
    const action = await ui.custom<RoleEditorAction>(
      (_tui, theme, _kb, done) =>
        createRoleEditor({
          rows,
          touched,
          title,
          theme: roleEditorTheme(theme),
          onDone: done,
        }),
      { overlay: false },
    );
    if (action === undefined || action.type === "cancel") return undefined;
    if (action.type === "next") return { rows, sourceRows, touched };
    if (action.type === "batch") {
      if (models.length === 0) {
        ui.notify("modelRegistry.getAvailable() 无可用模型，无法批量应用", "warning");
        continue;
      }
      const sel = await ui.select(
        `批量应用 model 到全部 ${rows.length} 行（Esc 返回不改值）`,
        [...models, REVERT_OPTION],
      );
      if (sel === undefined) continue;
      if (sel === REVERT_OPTION) revertAllModels(rows, sourceRows, touched);
      else applyBatchModel(rows, touched, sel);
      continue;
    }
    const row = rows[action.row];
    if (!row) continue;
    if (action.field === "model" && models.length === 0) {
      ui.notify("modelRegistry.getAvailable() 无可用模型，model 不可选", "warning");
      continue;
    }
    const options =
      action.field === "model"
        ? [...models, REVERT_OPTION]
        : [...THINKING_LEVELS, REVERT_OPTION];
    const sel = await ui.select(`${row.key} · ${action.field}（Esc 返回不改值）`, options);
    if (sel === undefined) continue;
    if (sel === REVERT_OPTION) {
      revertField(rows, sourceRows, touched, action.row, action.field);
      continue;
    }
    row[action.field] = sel;
    touched.add(touchedKey(action.row, action.field));
  }
}

interface CommitOpts {
  kind: WizardKind;
  name: string;
  src: Profile;
  session: RoleSession;
  switchTo: boolean;
}

/** 提交：构建值 → 安全写用户档 → 重新 loadProfiles → 可选 applyProfile 切换。 */
async function commit(deps: ConfigureDeps, opts: CommitOpts): Promise<WizardOutcome> {
  const value = buildValue(opts.src.value, opts.session.rows, opts.session.touched);
  const res = saveUserProfile(
    { fs: deps.fs, dir: deps.userDir, now: deps.now },
    opts.name,
    value,
  );
  const newSet = loadProfiles({ fs: deps.fs, roots: deps.roots });
  const changed = changeList(
    opts.session.rows,
    opts.session.sourceRows,
    opts.session.touched,
  ).length;
  const copied = opts.kind === "edit" && opts.src.source === "package";
  if (opts.switchTo) {
    const r = applyProfile(
      { fs: deps.fs, settingsPath: deps.settingsPath, set: newSet },
      opts.name,
    );
    if (!r.changed) {
      deps.ui.notify("已是当前档；内容一致，未写入、未备份", "info");
    } else {
      deps.ui.notify(
        `已切换到档 "${opts.name}"（备份 ${r.backupPath ? basename(r.backupPath) : "无"}）；下一次启动 subagent 生效，无需 /reload`,
        "info",
      );
    }
  }
  const verb = opts.kind === "new" ? "创建" : "保存";
  const tail = opts.switchTo ? "，并切换为当前档" : "，当前档未改变";
  const extra = copied ? "（包内档只读，已复制到用户目录）" : "";
  deps.ui.notify(
    `已${verb}档 "${opts.name}"${tail}，共修改 ${changed} 个字段${extra}`,
    "info",
  );
  return {
    status: opts.kind === "new" ? "created" : "saved",
    name: opts.name,
    path: res.path,
    backupPath: res.backupPath,
    applied: opts.switchTo,
    copiedFromPackage: copied,
    changedFields: changed,
  };
}

async function runNew(deps: ConfigureDeps, set: ProfileSet): Promise<WizardOutcome> {
  const { ui } = deps;
  // 第 1 步：档名（唯一的文本输入；非法告警后重试，重名自动 -2/-3）
  let name: string;
  for (;;) {
    const raw = await ui.input("新建档 · 档名（仅 a-z 0-9 . _ -，Esc 取消）", "my-profile");
    if (raw === undefined) return cancelled(deps);
    const n = normalizeProfileName(raw);
    if (!n.ok) {
      ui.notify(`档名无效：${n.msg}，请重新输入`, "warning");
      continue;
    }
    const d = dedupeProfileName(n.name!, takenNames(deps, set));
    if (d.changed) {
      ui.notify(`与现有档重名，自动改为 "${d.name}"`, "warning");
    }
    name = d.name;
    break;
  }
  // 第 2 步：模板
  const tplName = await ui.select(
    "新建档 · 选择模板（沿用其角色结构，Esc 取消）",
    set.profiles.map((p) => p.name),
  );
  if (tplName === undefined) return cancelled(deps);
  const src = findProfile(set, tplName);
  // 第 3 步：角色配置面板
  const session = await editRoles(deps, `新建档 · 角色配置 · 模板 ${src.name}`, src.value);
  if (session === undefined) return cancelled(deps);
  // 第 4 步：创建方式
  const act = await ui.select("新建档 · 创建方式", ["创建并切换", "仅创建", "取消"]);
  if (act === undefined || act === "取消") return cancelled(deps);
  return commit(deps, {
    kind: "new",
    name,
    src,
    session,
    switchTo: act === "创建并切换",
  });
}

async function runEdit(deps: ConfigureDeps, set: ProfileSet): Promise<WizardOutcome> {
  const { ui } = deps;
  // 第 1 步：选档（包内档保存时复制到用户目录，包内档永不写）
  const pick = await ui.select(
    "修改档 · 选择档（包内档将复制到用户目录，Esc 取消）",
    set.profiles.map((p) => p.name),
  );
  if (pick === undefined) return cancelled(deps);
  const src = findProfile(set, pick);
  // 第 2 步：角色配置面板
  const session = await editRoles(deps, `修改档 · 角色配置 · ${src.name}`, src.value);
  if (session === undefined) return cancelled(deps);
  // 第 3 步：保存方式
  const act = await ui.select("修改档 · 保存方式", ["保存并切换", "仅保存", "取消"]);
  if (act === undefined || act === "取消") return cancelled(deps);
  return commit(deps, {
    kind: "edit",
    name: src.name,
    src,
    session,
    switchTo: act === "保存并切换",
  });
}

/**
 * 新建/修改档向导（全程键盘可操作）：
 *   新建 = 档名(ctx.ui.input) → 模板(ctx.ui.select) → 角色配置面板(ctx.ui.custom)
 *          → 创建并切换 / 仅创建 / 取消；
 *   修改 = 选档 → 角色配置面板 → 保存并切换 / 仅保存 / 取消。
 * 任一步取消/返回零写入；仅 touched 字段进入写入；写完重新 loadProfiles 再按
 * 选择 applyProfile。非 TUI 由 adapter 在进入前降级为警告。
 */
export async function runConfigureWizard(
  kind: WizardKind,
  deps: ConfigureDeps,
): Promise<WizardOutcome> {
  const set = loadProfiles({ fs: deps.fs, roots: deps.roots });
  if (set.profiles.length === 0) {
    deps.ui.notify("未找到可用档：请先在用户或包内目录准备至少一个档", "warning");
    return { status: "cancelled" };
  }
  return kind === "new" ? runNew(deps, set) : runEdit(deps, set);
}

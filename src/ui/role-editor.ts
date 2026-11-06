import { parseKey } from "../keys.ts";
import { keyChunks } from "./profile-selector.ts";
import type { SubagentsValue } from "../profiles.ts";

export type RoleField = "model" | "thinking";

/** 一行 = defaultModel（thinking 恒 null）或一个角色。 */
export interface RoleRow {
  key: string;
  model: string;
  thinking: string | null;
}

export interface RoleEditorTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export type RoleEditorAction =
  | { type: "pick"; row: number; field: RoleField }
  | { type: "batch" }
  | { type: "next" }
  | { type: "cancel" };

export interface RoleEditorDeps {
  readonly rows: readonly RoleRow[];
  readonly touched: ReadonlySet<string>;
  readonly title?: string;
  readonly initialCursor?: number;
  readonly theme: RoleEditorTheme;
  readonly onCursorChange?: (cursor: number) => void;
  readonly onDone: (action: RoleEditorAction) => void;
}

export interface RoleEditorComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  readonly cursor: number;
}

/** 鸭子类型适配宿主 theme：fg/bold 缺失时退化为原文。 */
export function roleEditorTheme(theme: unknown): RoleEditorTheme {
  const t = theme as Partial<RoleEditorTheme> | undefined;
  return {
    fg: (color, text) => (t && typeof t.fg === "function" ? t.fg(color, text) : text),
    bold: (text) => (t && typeof t.bold === "function" ? t.bold(text) : text),
  };
}

export function touchedKey(row: number, field: RoleField): string {
  return `${row}:${field}`;
}

function asRec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * 由 subagents 值生成行：首行 defaultModel（无 thinking 单元格），其后是
 * agentOverrides 的全部角色（保序）。角色无 model/thinking 时分别回落到
 * defaultModel / "medium"（对齐已验收原型）。
 */
export function initRoleRows(value: SubagentsValue): RoleRow[] {
  const obj = asRec(value);
  const def = typeof obj.defaultModel === "string" ? obj.defaultModel : "";
  const rows: RoleRow[] = [{ key: "defaultModel", model: def, thinking: null }];
  const ov = asRec(obj.agentOverrides);
  for (const key of Object.keys(ov)) {
    const o = asRec(ov[key]);
    rows.push({
      key,
      model: typeof o.model === "string" && o.model ? o.model : def,
      thinking: typeof o.thinking === "string" && o.thinking ? o.thinking : "medium",
    });
  }
  return rows;
}

/** 仅把 touched 的字段应用到 source 的深拷贝上；其余 JSON 值（tools 等）原样保留。 */
export function buildValue(
  source: SubagentsValue,
  rows: readonly RoleRow[],
  touched: ReadonlySet<string>,
): SubagentsValue {
  const v = structuredClone(source) as Record<string, unknown>;
  for (const key of touched) {
    const [riStr, field] = key.split(":");
    const ri = Number(riStr);
    const row = rows[ri];
    if (!row || (field !== "model" && field !== "thinking")) continue;
    if (row.key === "defaultModel") {
      if (field === "model") v.defaultModel = row.model;
      continue;
    }
    const ao = asRec(v.agentOverrides);
    v.agentOverrides = ao;
    ao[row.key] = asRec(ao[row.key]);
    (ao[row.key] as Record<string, unknown>)[field] = row[field];
  }
  return v as SubagentsValue;
}

export interface FieldChange {
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

/** 修改预览：touched 的逐字段 from → to 列表（按行序、model 先于 thinking）。 */
export function changeList(
  rows: readonly RoleRow[],
  sourceRows: readonly RoleRow[],
  touched: ReadonlySet<string>,
): FieldChange[] {
  const out: FieldChange[] = [];
  rows.forEach((row, ri) => {
    for (const field of ["model", "thinking"] as const) {
      if (!touched.has(touchedKey(ri, field))) continue;
      const src = sourceRows[ri];
      out.push({
        key: `${row.key}.${field}`,
        from: src ? String(src[field] ?? "") : "",
        to: String(row[field] ?? ""),
      });
    }
  });
  return out;
}

/** 批量应用同一 model 到全部行（记录 touched）。 */
export function applyBatchModel(
  rows: RoleRow[],
  touched: Set<string>,
  model: string,
): void {
  rows.forEach((row, i) => {
    row.model = model;
    touched.add(touchedKey(i, "model"));
  });
}

/** 恢复全部行的 model 到原值（清除 touched）。 */
export function revertAllModels(
  rows: RoleRow[],
  sourceRows: readonly RoleRow[],
  touched: Set<string>,
): void {
  rows.forEach((row, i) => {
    const src = sourceRows[i];
    if (src) row.model = src.model;
    touched.delete(touchedKey(i, "model"));
  });
}

/** 恢复单个字段到原值（清除 touched）。 */
export function revertField(
  rows: RoleRow[],
  sourceRows: readonly RoleRow[],
  touched: Set<string>,
  row: number,
  field: RoleField,
): void {
  const target = rows[row];
  const src = sourceRows[row];
  if (!target || !src) return;
  if (field === "model") target.model = src.model;
  else target.thinking = src.thinking;
  touched.delete(touchedKey(row, field));
}

/** 先按可见码点截断纯文本，再套 ANSI，避免截断破坏颜色码。 */
function truncate(s: string, width: number): string {
  const chars = [...s];
  return chars.length <= width ? s : chars.slice(0, width).join("");
}

type FlatItem =
  | { kind: "batch" }
  | { kind: "cell"; row: number; field: RoleField }
  | { kind: "next" };

/**
 * 角色配置面板（ctx.ui.custom 组件）：批量行 + defaultModel 与模板全部角色行，
 * 每行独立 model/thinking 单元格；Enter 产生 pick/batch/next 动作（model 打开
 * 可搜索列表，thinking 交给宿主原生 select），Esc/Ctrl+C → cancel。仅渲染，不写状态。
 */
export function createRoleEditor(deps: RoleEditorDeps): RoleEditorComponent {
  const { rows, touched, title, theme, onDone } = deps;
  const items: FlatItem[] = [{ kind: "batch" }];
  rows.forEach((row, ri) => {
    items.push({ kind: "cell", row: ri, field: "model" });
    if (row.thinking !== null) items.push({ kind: "cell", row: ri, field: "thinking" });
  });
  items.push({ kind: "next" });
  // row/field → 扁平下标，渲染时用
  const cellIdx = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.kind === "cell") cellIdx.set(touchedKey(it.row, it.field), i);
  });
  let cursor = Math.max(0, Math.min(deps.initialCursor ?? 0, items.length - 1));
  const move = (delta: number): void => {
    cursor = (cursor + delta + items.length) % items.length;
    deps.onCursorChange?.(cursor);
  };

  const KEY_W = 16;
  const MODEL_W = 32;
  const THINK_W = 12;

  return {
    get cursor(): number {
      return cursor;
    },
    handleInput(data: string): void {
      // 一段 data 可能含多个键序列（如连续方向键 + Enter），逐键处理；
      // 产出动作（onDone）后立即返回——组件生命周期由宿主接管。
      for (const chunk of keyChunks(data)) {
        const key = parseKey(chunk);
        if (key === undefined) continue;
        if (key === "up") {
          move(-1);
          continue;
        }
        if (key === "down") {
          move(1);
          continue;
        }
        if (key === "enter") {
          const it = items[cursor];
          if (!it) continue;
          if (it.kind === "batch") {
            onDone({ type: "batch" });
          } else if (it.kind === "next") {
            onDone({ type: "next" });
          } else {
            onDone({ type: "pick", row: it.row, field: it.field });
          }
          return;
        }
        if (key === "escape" || key === "ctrl+c") {
          onDone({ type: "cancel" });
          return;
        }
        if (typeof key === "object") {
          if (key.char === "k") {
            move(-1);
            continue;
          }
          if (key.char === "j") {
            move(1);
            continue;
          }
        }
        // 其它键忽略
      }
    },
    invalidate(): void {
      // 无缓存
    },
    render(width: number): string[] {
      const lines: string[] = [];
      const current = items[cursor];
      lines.push(
        theme.fg(
          "dim",
          truncate(`${title ?? "角色配置"} · 每行独立选择 model / thinking；* = 本次改动`, width),
        ),
      );
      const batchFocused = current?.kind === "batch";
      lines.push(
        truncate(
          `${batchFocused ? "▶ " : "· "}批量应用同一模型到全部行（可选快捷，之后仍可逐行覆盖）`,
          width,
        ),
      );
      lines.push(
        theme.fg(
          "dim",
          truncate(`  ${"角色".padEnd(KEY_W)}${"model".padEnd(MODEL_W)}${"thinking".padEnd(THINK_W)}`, width),
        ),
      );
      rows.forEach((row, ri) => {
        const mFocused = cursor === cellIdx.get(touchedKey(ri, "model"));
        const tFocused = cursor === cellIdx.get(touchedKey(ri, "thinking"));
        const mCell =
          `${mFocused ? "▶ " : "  "}${row.model}` +
          (touched.has(touchedKey(ri, "model")) ? "*" : "");
        const tCell =
          row.thinking === null
            ? "  —"
            : `${tFocused ? "▶ " : "  "}${row.thinking}` +
              (touched.has(touchedKey(ri, "thinking")) ? "*" : "");
        const line = truncate(
          `· ${row.key.padEnd(KEY_W)}${mCell.padEnd(MODEL_W)}${tCell.padEnd(THINK_W)}`,
          width,
        );
        lines.push(mFocused || tFocused ? theme.bold(line) : line);
      });
      const nextFocused = current?.kind === "next";
      lines.push(
        truncate(`${nextFocused ? "▶ " : "· "}完成角色配置，继续 →`, width),
      );
      lines.push(
        theme.fg(
          "dim",
          truncate("↑/↓ 或 j/k 移动 · Enter 选择/继续 · Esc 取消（零改动）", width),
        ),
      );
      return lines;
    },
  };
}

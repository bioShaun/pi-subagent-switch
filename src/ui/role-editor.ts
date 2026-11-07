import { parseKey } from "../keys.ts";
import { keyChunks } from "./profile-selector.ts";
import { framedPanel, padVisible, truncateVisible } from "./frame.ts";
import type { SubagentsValue } from "../profiles.ts";

export type RoleField = "model" | "thinking";

export const MAX_VISIBLE_ROLE_ROWS = 10;

/** 一行 = defaultModel、maxThinking 或一个角色。 */
export interface RoleRow {
  key: string;
  model: string | null;
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
 * 由 subagents 值生成行：
 * Row 0: defaultModel (model: def, thinking: defThinking)
 * Row 1: maxThinking (model: null, thinking: maxThinking)
 * Row 2+: agentOverrides 的全部角色（保序）。角色无 model/thinking 时分别回落到
 * defaultModel / (defThinking || "medium")。
 */
export function initRoleRows(value: SubagentsValue): RoleRow[] {
  const obj = asRec(value);
  const def = typeof obj.defaultModel === "string" ? obj.defaultModel : "";
  const defThinking = typeof obj.defaultThinking === "string" ? obj.defaultThinking : "";
  const maxThinking = typeof obj.maxThinking === "string" ? obj.maxThinking : "";

  const rows: RoleRow[] = [
    { key: "defaultModel", model: def, thinking: defThinking },
    { key: "maxThinking", model: null, thinking: maxThinking },
  ];

  const ov = asRec(obj.agentOverrides);
  for (const key of Object.keys(ov)) {
    const o = asRec(ov[key]);
    rows.push({
      key,
      model: typeof o.model === "string" && o.model ? o.model : def,
      thinking: typeof o.thinking === "string" && o.thinking ? o.thinking : (defThinking || "medium"),
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
      if (field === "model" && row.model) v.defaultModel = row.model;
      if (field === "thinking" && row.thinking) v.defaultThinking = row.thinking;
      continue;
    }
    if (row.key === "maxThinking") {
      if (field === "thinking" && row.thinking) v.maxThinking = row.thinking;
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
        from: src && src[field] !== null ? String(src[field] ?? "") : "",
        to: row[field] !== null ? String(row[field] ?? "") : "",
      });
    }
  });
  return out;
}

/** 批量应用同一 model 到全部可设置 model 的行（跳过 model === null 的行，记录 touched）。 */
export function applyBatchModel(
  rows: RoleRow[],
  touched: Set<string>,
  model: string,
): void {
  rows.forEach((row, i) => {
    if (row.model !== null) {
      row.model = model;
      touched.add(touchedKey(i, "model"));
    }
  });
}

/** 恢复全部行的 model 到原值（清除 touched）。 */
export function revertAllModels(
  rows: RoleRow[],
  sourceRows: readonly RoleRow[],
  touched: Set<string>,
): void {
  rows.forEach((row, i) => {
    if (row.model !== null) {
      const src = sourceRows[i];
      if (src && src.model !== null) row.model = src.model;
      touched.delete(touchedKey(i, "model"));
    }
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
    if (row.model !== null) items.push({ kind: "cell", row: ri, field: "model" });
    if (row.thinking !== null) items.push({ kind: "cell", row: ri, field: "thinking" });
  });
  items.push({ kind: "next" });

  // row/field → 扁平下标，渲染与导航用
  const cellIdx = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.kind === "cell") cellIdx.set(touchedKey(it.row, it.field), i);
  });

  let cursor = Math.max(0, Math.min(deps.initialCursor ?? 0, items.length - 1));
  let preferredField: RoleField = "model";
  const initItem = items[cursor];
  if (initItem && initItem.kind === "cell") {
    preferredField = initItem.field;
  }

  const findRowCell = (ri: number, pref: RoleField): number | undefined => {
    const direct = cellIdx.get(touchedKey(ri, pref));
    if (direct !== undefined) return direct;
    const other: RoleField = pref === "model" ? "thinking" : "model";
    return cellIdx.get(touchedKey(ri, other));
  };

  const moveVertical = (delta: 1 | -1): void => {
    const cur = items[cursor];
    if (!cur) return;
    if (cur.kind === "batch") {
      if (delta === 1) {
        cursor = findRowCell(0, preferredField) ?? items.length - 1;
      } else {
        cursor = items.length - 1;
      }
    } else if (cur.kind === "next") {
      if (delta === 1) {
        cursor = 0;
      } else {
        cursor = findRowCell(rows.length - 1, preferredField) ?? 0;
      }
    } else {
      const nextRow = cur.row + delta;
      if (nextRow < 0) {
        cursor = 0;
      } else if (nextRow >= rows.length) {
        cursor = items.length - 1;
      } else {
        const targetIdx = findRowCell(nextRow, preferredField);
        if (targetIdx !== undefined) {
          cursor = targetIdx;
        }
      }
    }
    deps.onCursorChange?.(cursor);
  };

  const moveHorizontal = (key: "left" | "right" | "tab"): void => {
    const cur = items[cursor];
    if (!cur) return;
    if (cur.kind === "cell") {
      if (key === "tab") {
        const otherField: RoleField = cur.field === "model" ? "thinking" : "model";
        const otherIdx = cellIdx.get(touchedKey(cur.row, otherField));
        if (otherIdx !== undefined) {
          cursor = otherIdx;
          preferredField = otherField;
          deps.onCursorChange?.(cursor);
        } else {
          cursor = (cursor + 1) % items.length;
          const n = items[cursor];
          if (n && n.kind === "cell") preferredField = n.field;
          deps.onCursorChange?.(cursor);
        }
        return;
      }
      const targetField: RoleField = key === "left" ? "model" : "thinking";
      if (cur.field !== targetField) {
        const targetIdx = cellIdx.get(touchedKey(cur.row, targetField));
        if (targetIdx !== undefined) {
          cursor = targetIdx;
          preferredField = targetField;
          deps.onCursorChange?.(cursor);
        }
      }
    } else if (key === "tab") {
      cursor = (cursor + 1) % items.length;
      const n = items[cursor];
      if (n && n.kind === "cell") preferredField = n.field;
      deps.onCursorChange?.(cursor);
    }
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
          moveVertical(-1);
          continue;
        }
        if (key === "down") {
          moveVertical(1);
          continue;
        }
        if (key === "left") {
          moveHorizontal("left");
          continue;
        }
        if (key === "right") {
          moveHorizontal("right");
          continue;
        }
        if (key === "tab") {
          moveHorizontal("tab");
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
            moveVertical(-1);
            continue;
          }
          if (key.char === "j") {
            moveVertical(1);
            continue;
          }
          if (key.char === "h") {
            moveHorizontal("left");
            continue;
          }
          if (key.char === "l") {
            moveHorizontal("right");
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
        theme.fg("muted", "每行独立选择 model / thinking；* = 本次改动"),
      );
      const batchFocused = current?.kind === "batch";
      const batchText = `${batchFocused ? "▶ " : "· "}批量应用同一模型到全部行（可选快捷，之后仍可逐行覆盖）`;
      lines.push(
        batchFocused
          ? theme.fg("accent", theme.bold(batchText))
          : theme.fg("text", batchText),
      );
      lines.push(
        theme.fg(
          "muted",
          `  ${padVisible("角色", KEY_W)}${padVisible("model", MODEL_W)}${padVisible("thinking", THINK_W)}`,
        ),
      );

      let activeRow = 0;
      if (current && current.kind === "cell") {
        activeRow = current.row;
      } else if (current && current.kind === "next") {
        activeRow = rows.length - 1;
      }
      let start = 0;
      let end = rows.length;
      if (rows.length > MAX_VISIBLE_ROLE_ROWS) {
        const half = Math.floor(MAX_VISIBLE_ROLE_ROWS / 2);
        start = Math.max(0, Math.min(activeRow - half, rows.length - MAX_VISIBLE_ROLE_ROWS));
        end = start + MAX_VISIBLE_ROLE_ROWS;
      }

      if (start > 0) {
        lines.push(theme.fg("muted", `  ↑ 还有 ${start} 项`));
      }

      const cell = (
        focused: boolean,
        value: string | null,
        isTouched: boolean,
        colWidth: number,
      ): string => {
        const valStr = value || "—";
        const maxValW = Math.max(1, colWidth - 2 - (isTouched ? 1 : 0) - 1);
        const truncated = truncateVisible(valStr, maxValW);
        const text = `${focused ? "▶ " : "  "}${truncated}`;
        const styled = focused
          ? theme.fg("accent", theme.bold(text))
          : theme.fg("text", text);
        // * 紧跟在值后（warning 色），其余列宽补空格
        const marked = styled + (isTouched ? theme.fg("warning", "*") : "");
        return padVisible(marked, colWidth);
      };

      for (let ri = start; ri < end; ri++) {
        const row = rows[ri]!;
        const mFocused = cursor === cellIdx.get(touchedKey(ri, "model"));
        const tFocused = cursor === cellIdx.get(touchedKey(ri, "thinking"));
        const keyCol = padVisible(truncateVisible(row.key, KEY_W - 1), KEY_W);
        const mSeg =
          row.model === null
            ? padVisible(theme.fg("text", "  —"), MODEL_W)
            : cell(mFocused, row.model, touched.has(touchedKey(ri, "model")), MODEL_W);
        const tSeg =
          row.thinking === null
            ? padVisible(theme.fg("text", "  —"), THINK_W)
            : cell(tFocused, row.thinking, touched.has(touchedKey(ri, "thinking")), THINK_W);
        lines.push(theme.fg("text", `· ${keyCol}`) + mSeg + tSeg);
      }

      if (end < rows.length) {
        lines.push(theme.fg("muted", `  ↓ 还有 ${rows.length - end} 项`));
      }

      const nextFocused = current?.kind === "next";
      const nextText = `${nextFocused ? "▶ " : "· "}完成角色配置，继续 →`;
      lines.push(
        nextFocused
          ? theme.fg("accent", theme.bold(nextText))
          : theme.fg("text", nextText),
      );
      lines.push(
        theme.fg("muted", "↑/↓ 切行 · ←/→/Tab 切列 · Enter 选择/继续 · Esc 取消（零改动）"),
      );
      return framedPanel({
        width,
        title: title ?? "角色配置",
        lines,
        theme,
      });
    },
  };
}

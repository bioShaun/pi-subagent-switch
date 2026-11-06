import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface FrameTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export interface FrameOptions {
  readonly width: number;
  /** 可选标题，accent+bold 嵌入上边框；超长截断、保留完整角标。 */
  readonly title?: string;
  /** 内容行，可含 ANSI 与宽字符；左右各留 1 格内边距、按可见宽度补齐。 */
  readonly lines: readonly string[];
  readonly theme: FrameTheme;
}

/** 宽度 < MIN_FRAMED 时放弃画框，逐行简单截断（不产生负 repeat / 错位角标）。 */
const MIN_FRAMED = 8;

/** 按可见宽度补空格到 n 列；已超宽 → 原样返回（截断由调用方负责）。 */
export function padVisible(s: string, n: number): string {
  const w = visibleWidth(s);
  return w >= n ? s : s + " ".repeat(n - w);
}

/**
 * 共用的圆角面板边框（三个内联面板复用）：
 *   ╭─ 标题 ────────╮
 *   │ 内容行 …      │
 *   ╰───────────────╯
 * 边框 accent，标题 accent+bold；所有输出行 visibleWidth ≤ width；
 * 极窄宽度降级为简单截断。不做背景填充，避免明暗主题下出现不协调色块。
 */
export function framedPanel(opts: FrameOptions): string[] {
  const { width, title, lines, theme } = opts;
  const w = Math.max(0, Math.floor(width));
  if (w < MIN_FRAMED) {
    const out: string[] = [];
    if (title !== undefined) out.push(truncateToWidth(title, w));
    for (const line of lines) out.push(truncateToWidth(line, w));
    return out;
  }
  const border = (s: string): string => theme.fg("accent", s);
  const inner = w - 4; // "│ " + content + " │"
  let top: string;
  if (title !== undefined) {
    const t = truncateToWidth(title, Math.max(0, w - 6)); // 保证末尾至少 1 个 ─
    const fill = Math.max(0, w - 5 - visibleWidth(t));
    top = border("╭─ ") + border(theme.bold(t)) + border(` ${"─".repeat(fill)}╮`);
  } else {
    top = border(`╭${"─".repeat(w - 2)}╮`);
  }
  const bottom = border(`╰${"─".repeat(w - 2)}╯`);
  const body = lines.map((line) => {
    const padded =
      visibleWidth(line) >= inner ? truncateToWidth(line, inner) : padVisible(line, inner);
    return `${border("│")} ${padded} ${border("│")}`;
  });
  return [top, ...body, bottom];
}

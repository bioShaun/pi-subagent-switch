import { parseKey } from "../keys.ts";
import type { Profile } from "../profiles.ts";
import type { CurrentProfile } from "../current-profile.ts";

export interface SelectorTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}
export interface ProfileSelectorDeps {
  readonly profiles: readonly Profile[];
  readonly current: CurrentProfile;
  readonly theme: SelectorTheme;
  readonly onDone: (result: string | undefined) => void;
}
export interface ProfileSelectorComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  readonly cursor: number;
}

/** 先按可见码点截断纯文本，再套 ANSI，避免截断破坏颜色码。 */
function truncate(s: string, width: number): string {
  const chars = [...s];
  return chars.length <= width ? s : chars.slice(0, width).join("");
}

export function createProfileSelector(deps: ProfileSelectorDeps): ProfileSelectorComponent {
  const { profiles, current, theme, onDone } = deps;
  let cursor = 0;
  if (current.matched) {
    const idx = profiles.findIndex((p) => p.name === current.name);
    if (idx >= 0) cursor = idx;
  }
  const move = (delta: number): void => {
    if (profiles.length === 0) return;
    cursor = (cursor + delta + profiles.length) % profiles.length;
  };

  return {
    get cursor(): number {
      return cursor;
    },
    handleInput(data: string): void {
      const key = parseKey(data);
      if (key === undefined) return;
      if (key === "up") {
        move(-1);
        return;
      }
      if (key === "down") {
        move(1);
        return;
      }
      if (key === "enter") {
        const chosen = profiles[cursor];
        onDone(chosen ? chosen.name : undefined);
        return;
      }
      if (key === "escape" || key === "ctrl+c") {
        onDone(undefined);
        return;
      }
      if (typeof key === "object") {
        if (key.char === "k") {
          move(-1);
          return;
        }
        if (key.char === "j") {
          move(1);
          return;
        }
      }
      // 其它键忽略
    },
    invalidate(): void {
      // 无缓存
    },
    render(width: number): string[] {
      if (profiles.length === 0) {
        return [
          truncate(
            "未找到档文件：请创建 ~/.pi/agent/subagent-profiles/*.json",
            width,
          ),
        ];
      }
      const lines: string[] = [];
      for (let i = 0; i < profiles.length; i++) {
        const p = profiles[i]!;
        const isCursor = i === cursor;
        const isCurrent = current.matched && p.name === current.name;
        // 仅 cursor 行显示 ▶，其余行用两个空格保持列对齐（两者均为 2 个可见码点），
        // 使 cursor 移动在 render 输出中产生可见反馈；current 行 ●/bold 语义不变。
        const prefix = isCursor ? "▶ " : "  ";
        const cols =
          `${prefix}${p.name.padEnd(12)}` +
          `${(p.summary.defaultModel ?? "—").padEnd(22)}` +
          `${p.summary.overrideCount} overrides`;
        const plain = `${cols}${isCurrent ? "  ●" : ""}`;
        const line = truncate(plain, width);
        lines.push(isCurrent ? theme.bold(line) : line);
      }
      lines.push(
        theme.fg("dim", truncate("↑/↓ 选择 · Enter 应用 · Esc 取消", width)),
      );
      return lines;
    },
  };
}

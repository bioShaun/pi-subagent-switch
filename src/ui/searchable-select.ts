import { parseKey } from "../keys.ts";
import { keyChunks } from "./profile-selector.ts";
import type { SelectorTheme } from "./profile-selector.ts";

export interface SearchableSelectDeps {
  readonly title: string;
  readonly options: readonly string[];
  readonly initialValue?: string;
  readonly theme: SelectorTheme;
  readonly onDone: (result: string | undefined) => void;
}

export interface SearchableSelectComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  readonly cursor: number;
  readonly query: string;
  readonly matches: readonly string[];
}

function truncate(s: string, width: number): string {
  const chars = [...s];
  return chars.length <= width ? s : chars.slice(0, Math.max(0, width)).join("");
}

const MAX_VISIBLE = 8;

export function createSearchableSelect(
  deps: SearchableSelectDeps,
): SearchableSelectComponent {
  const { title, options, theme, onDone } = deps;
  let query = "";
  let matches = [...options];
  let cursor = Math.max(0, options.indexOf(deps.initialValue ?? ""));

  const move = (delta: number): void => {
    if (matches.length === 0) return;
    cursor = (cursor + delta + matches.length) % matches.length;
  };
  const filter = (): void => {
    const needle = query.trim().toLocaleLowerCase();
    matches = options.filter((option) => option.toLocaleLowerCase().includes(needle));
    cursor = 0;
  };

  return {
    get cursor(): number {
      return cursor;
    },
    get query(): string {
      return query;
    },
    get matches(): readonly string[] {
      return matches;
    },
    handleInput(data: string): void {
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
        if (key === "pageup") {
          move(-MAX_VISIBLE);
          continue;
        }
        if (key === "pagedown") {
          move(MAX_VISIBLE);
          continue;
        }
        if (key === "home") {
          cursor = 0;
          continue;
        }
        if (key === "end") {
          cursor = Math.max(0, matches.length - 1);
          continue;
        }
        if (key === "enter") {
          const selected = matches[cursor];
          if (selected !== undefined) onDone(selected);
          return;
        }
        if (key === "escape" || key === "ctrl+c") {
          onDone(undefined);
          return;
        }
        if (key === "backspace") {
          query = [...query].slice(0, -1).join("");
          filter();
          continue;
        }
        if (typeof key === "object") {
          query += key.char;
          filter();
        }
      }
    },
    invalidate(): void {
      // 无缓存
    },
    render(width: number): string[] {
      const lines = [
        theme.bold(truncate(title, width)),
        theme.fg(
          "dim",
          truncate(`搜索 › ${query || "输入关键字过滤"}  ·  ${matches.length}/${options.length} 项`, width),
        ),
      ];
      if (matches.length === 0) {
        lines.push("  没有匹配项，请修改关键字");
      } else {
        const start = Math.max(
          0,
          Math.min(cursor - Math.floor(MAX_VISIBLE / 2), matches.length - MAX_VISIBLE),
        );
        const end = Math.min(start + MAX_VISIBLE, matches.length);
        for (let i = start; i < end; i++) {
          const selected = i === cursor;
          const line = truncate(`${selected ? "▶ " : "  "}${matches[i]}`, width);
          lines.push(selected ? theme.bold(line) : line);
        }
        if (matches.length > MAX_VISIBLE) {
          lines.push(theme.fg("dim", truncate(`  ${cursor + 1}/${matches.length} · 显示 ${start + 1}–${end}`, width)));
        }
      }
      lines.push(
        theme.fg("dim", truncate("输入过滤 · Backspace 删除 · ↑/↓ 选择 · Enter 确认 · Esc 返回", width)),
      );
      return lines;
    },
  };
}

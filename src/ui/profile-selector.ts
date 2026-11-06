import { truncateToWidth } from "@earendil-works/pi-tui/dist/utils.js";
import { parseKey } from "../keys.ts";
import { framedPanel } from "./frame.ts";
import type { Profile } from "../profiles.ts";
import type { CurrentProfile } from "../current-profile.ts";

/**
 * 把一段原始输入拆成单个键事件：终端/测试脚本可能一次投递多个键序列
 * （如 "\x1b[B\x1b[B\r" = 两次下方向键 + Enter）。CSI 序列以 0x40-0x7E 的
 * 终止字节结束，SS3（\x1bO）取三字节，裸 \x1b 自成一键，其余按字符拆。
 * 与 ui/role-editor.ts 共享此实现。
 */
export function* keyChunks(data: string): Generator<string> {
  let i = 0;
  while (i < data.length) {
    if (data[i] === "\x1b") {
      const next = data[i + 1];
      if (next === undefined || next === "\x1b") {
        yield "\x1b";
        i += 1;
      } else if (next === "[") {
        let j = i + 2;
        while (j < data.length && !/[@-~]/.test(data.charAt(j))) j++;
        const end = Math.min(j + 1, data.length);
        yield data.slice(i, end);
        i = end;
      } else if (next === "O") {
        yield data.slice(i, i + 3);
        i += 3;
      } else {
        yield data.slice(i, i + 2); // Alt+键：整段交给 parseKey（多半忽略）
        i += 2;
      }
    } else {
      yield data[i]!;
      i += 1;
    }
  }
}

export interface SelectorTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** 主面板结果：切档，或进入新建/修改配置向导。 */
export type SelectorResult =
  | { kind: "switch"; name: string }
  | { kind: "new" }
  | { kind: "edit" };

export interface ProfileSelectorDeps {
  readonly profiles: readonly Profile[];
  readonly current: CurrentProfile;
  readonly theme: SelectorTheme;
  readonly onDone: (result: SelectorResult | undefined) => void;
}
export interface ProfileSelectorComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  readonly cursor: number;
}

interface ActionItem {
  readonly kind: "new" | "edit";
  readonly label: string;
  readonly desc: string;
}

const ACTIONS: readonly ActionItem[] = [
  { kind: "new", label: "＋ 新建档", desc: "档名 → 模板 → 角色配置 → 创建方式" },
  { kind: "edit", label: "✎ 修改档", desc: "选档 → 角色配置 → 保存方式" },
];

const PANEL_TITLE = "Subagent 配置";

export function createProfileSelector(deps: ProfileSelectorDeps): ProfileSelectorComponent {
  const { profiles, current, theme, onDone } = deps;
  const itemCount = profiles.length + ACTIONS.length;
  let cursor = 0;
  if (current.matched) {
    const idx = profiles.findIndex((p) => p.name === current.name);
    if (idx >= 0) cursor = idx;
  }
  const move = (delta: number): void => {
    if (itemCount === 0) return;
    cursor = (cursor + delta + itemCount) % itemCount;
  };

  return {
    get cursor(): number {
      return cursor;
    },
    handleInput(data: string): void {
      // 一段 data 可能含多个键序列（如连续方向键 + Enter），逐键处理；
      // 产出结果（onDone）后立即返回——组件生命周期由宿主接管。
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
          // 空档列表只有提示行：Enter = 取消，避免误触动作行
          if (profiles.length === 0) {
            onDone(undefined);
            return;
          }
          const p = profiles[cursor];
          if (p) {
            onDone({ kind: "switch", name: p.name });
            return;
          }
          const action = ACTIONS[cursor - profiles.length];
          onDone(action ? { kind: action.kind } : undefined);
          return;
        }
        if (key === "escape" || key === "ctrl+c") {
          onDone(undefined);
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
          if (key.char === "n") {
            onDone({ kind: "new" });
            return;
          }
          if (key.char === "e") {
            onDone({ kind: "edit" });
            return;
          }
        }
        // 其它键忽略
      }
    },
    invalidate(): void {
      // 无缓存
    },
    render(width: number): string[] {
      const inner = Math.max(0, width - 4); // 框内可用可见宽度
      if (profiles.length === 0) {
        return framedPanel({
          width,
          title: PANEL_TITLE,
          theme,
          lines: [
            theme.fg(
              "warning",
              "未找到档文件：请创建 ~/.pi/agent/subagent-profiles/*.json",
            ),
          ],
        });
      }
      const lines: string[] = [];
      for (let i = 0; i < profiles.length; i++) {
        const p = profiles[i]!;
        const isCursor = i === cursor;
        const isCurrent = current.matched && p.name === current.name;
        // 仅 cursor 行显示 ▶，其余行用两个空格保持列对齐（两者均为 2 个可见码点），
        // 使 cursor 移动在 render 输出中产生可见反馈。
        const prefix = isCursor ? "▶ " : "  ";
        const countText = `${p.summary.overrideCount} overrides`;
        const markerText = isCurrent ? "  ●" : "";
        // 档名/模型列按剩余宽度截断，给 overrides 计数与 ● 标记留位
        const main = truncateToWidth(
          `${prefix}${p.name.padEnd(12)}${(p.summary.defaultModel ?? "—").padEnd(22)}`,
          Math.max(0, inner - countText.length - markerText.length),
        );
        const styledMain = isCursor
          ? theme.fg("accent", theme.bold(main))
          : theme.fg("text", main);
        const count = theme.fg("muted", countText);
        const marker = isCurrent ? theme.fg("success", markerText) : "";
        lines.push(styledMain + count + marker);
      }
      for (let a = 0; a < ACTIONS.length; a++) {
        const action = ACTIONS[a]!;
        const isCursor = profiles.length + a === cursor;
        const main = truncateToWidth(
          `${isCursor ? "▶ " : "  "}${action.label.padEnd(12)}${action.desc}`,
          inner,
        );
        lines.push(
          isCursor ? theme.fg("accent", theme.bold(main)) : theme.fg("text", main),
        );
      }
      lines.push(
        theme.fg("muted", "↑/↓ 选择 · Enter 确认 · Esc 取消 · n 新建 · e 修改"),
      );
      return framedPanel({ width, title: PANEL_TITLE, lines, theme });
    },
  };
}

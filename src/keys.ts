export type KeyId =
  | "up"
  | "down"
  | "enter"
  | "escape"
  | "ctrl+c"
  | "home"
  | "end"
  | "pageup"
  | "pagedown"
  | { char: string };

/** 手写识别（不 import pi-tui，保持零运行时依赖），只认选择器需要的按键。 */
export function parseKey(data: string): KeyId | undefined {
  if (data === "\x1b[A" || data === "\x1bOA") return "up";
  if (data === "\x1b[B" || data === "\x1bOB") return "down";
  if (data === "\r" || data === "\n") return "enter";
  if (data === "\x1b") return "escape";
  if (data === "\x03") return "ctrl+c";
  if ([...data].length === 1) {
    const ch = data;
    if (!/[\u0000-\u001f\u007f]/.test(ch)) return { char: ch };
    return undefined;
  }
  return undefined;
}

import { parseKey as parsePiKey } from "@earendil-works/pi-tui";

export type KeyId =
  | "up"
  | "down"
  | "left"
  | "right"
  | "tab"
  | "enter"
  | "escape"
  | "ctrl+c"
  | "backspace"
  | "home"
  | "end"
  | "pageup"
  | "pagedown"
  | { char: string };

export function parseKey(data: string): KeyId | undefined {
  const key = parsePiKey(data);
  switch (key) {
    case "up":
    case "down":
    case "left":
    case "right":
    case "tab":
    case "enter":
    case "escape":
    case "ctrl+c":
    case "backspace":
    case "home":
    case "end":
      return key;
    case "pageUp":
      return "pageup";
    case "pageDown":
      return "pagedown";
    case "esc":
      return "escape";
    case "space":
      return { char: " " };
  }
  if (data === "\t" || data === "\x1b[9u") return "tab";
  if (data === "\x1b[D" || data === "\x1bOD" || data === "\x1b[57417u") return "left";
  if (data === "\x1b[C" || data === "\x1bOC" || data === "\x1b[57418u") return "right";
  if (key !== undefined && [...key].length === 1 && !/[\u0000-\u001f\u007f]/.test(key)) {
    return { char: key };
  }
  if ([...data].length === 1 && !/[\u0000-\u001f\u007f]/.test(data)) {
    return { char: data };
  }
  return undefined;
}

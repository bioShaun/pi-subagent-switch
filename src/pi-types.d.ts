/**
 * 手写 host 类型 shim — 对齐 Pi 1.5.0 的 types.d.ts 行号（见 plans/subagent-switch-plan.md §1.3 / R15）。
 * 故意不声明 getSettingsPath()：强制 extensions/index.ts 走「动态探测 + join(getAgentDir(), "settings.json")」兜底。
 * 仅声明本插件用到的子集，使 tsc --noEmit 不依赖真实安装 pi（零运行时依赖）。
 */
declare module "@earendil-works/pi-coding-agent" {
  export interface PiTheme {
    fg(color: string, text: string): string;
    bold(text: string): string;
    dim?(text: string): string;
  }
  export interface PiComponentLike {
    render(width: number): string[];
    invalidate(): void;
    handleInput?(data: string): void;
    dispose?(): void;
  }
  export interface PiAutocompleteItem {
    value: string;
    label: string;
    description?: string;
  }
  export interface PiUIContext {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
    readonly theme: PiTheme;
    custom<T>(
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (r: T) => void,
      ) => PiComponentLike | Promise<PiComponentLike>,
      options?: { overlay?: boolean },
    ): Promise<T | undefined>;
  }
  export type PiMode = "tui" | "rpc" | "json" | "print";
  export interface PiContext {
    ui: PiUIContext;
    mode: PiMode;
    hasUI: boolean;
    cwd: string;
  }
  export interface PiCommandContext extends PiContext {}
  export interface PiSessionStartEvent {
    type: "session_start";
    reason: "startup" | "reload" | "new" | "resume" | "fork";
  }
  export interface PiAPI {
    on(
      event: "session_start",
      handler: (e: PiSessionStartEvent, ctx: PiContext) => Promise<void> | void,
    ): () => void;
    registerCommand(
      name: string,
      options: {
        description?: string;
        getArgumentCompletions?: (
          prefix: string,
        ) => PiAutocompleteItem[] | null | Promise<PiAutocompleteItem[] | null>;
        handler: (args: string, ctx: PiCommandContext) => Promise<void>;
      },
    ): void;
  }
  export const CONFIG_DIR_NAME: string;
  export function getAgentDir(): string;
}

import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import * as nodeFs from "node:fs";
import type { PiAPI, PiCommandContext } from "@earendil-works/pi-coding-agent";
import type { FsLike } from "../src/fs.ts";
import { resolveProfileDirs } from "../src/profiles.ts";
import type { ProfileRoot } from "../src/profiles.ts";
import { completeProfiles, runSubprofile } from "../src/command.ts";
import type { CommandDeps } from "../src/command.ts";
import { refreshStatus } from "../src/status.ts";
import { runConfigureWizard } from "../src/configure-profile.ts";
import { createProfileSelector } from "../src/ui/profile-selector.ts";
import type { SelectorResult, SelectorTheme } from "../src/ui/profile-selector.ts";

const nodeFsLike = nodeFs as unknown as FsLike;

// R1：getSettingsPath() 未从包入口导出（dist/index.d.ts:2），运行时动态探测；
// host 缺失（未安装 pi 的单测环境）时回退到 env/homedir，保证 fake Pi/ctx 可测。
const host = await tryLoadHost();

async function tryLoadHost(): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import("@earendil-works/pi-coding-agent")) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function agentDir(): string {
  if (host && typeof host.getAgentDir === "function") {
    return (host.getAgentDir as () => string)();
  }
  return process.env.PI_SUBAGENT_SWITCH_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function resolveSettingsPath(): string {
  if (host && typeof host.getSettingsPath === "function") {
    return (host.getSettingsPath as () => string)();
  }
  return join(agentDir(), "settings.json");
}

function themeAdapter(theme: unknown): SelectorTheme {
  const t = theme as Partial<SelectorTheme> | undefined;
  return {
    fg: (color, text) => (t && typeof t.fg === "function" ? t.fg(color, text) : text),
    bold: (text) => (t && typeof t.bold === "function" ? t.bold(text) : text),
  };
}

interface StatusDeps {
  fs: FsLike;
  settingsPath: string;
  roots: readonly ProfileRoot[];
}

/** ctx.modelRegistry.getAvailable() → `${provider}/${id}` 列表；宿主缺失/抛错 → []。 */
function modelIds(ctx: PiCommandContext): string[] {
  const reg = ctx.modelRegistry;
  if (!reg || typeof reg.getAvailable !== "function") return [];
  try {
    return reg
      .getAvailable()
      .map((m) => `${m.provider}/${m.id}`)
      .filter((s) => s.length > 1);
  } catch {
    return [];
  }
}

function makeDeps(ctx: PiCommandContext, statusDeps: StatusDeps): CommandDeps {
  return {
    fs: nodeFsLike,
    settingsPath: statusDeps.settingsPath,
    roots: statusDeps.roots,
    notify: (m, l) => ctx.ui.notify(m, l),
    openSelector: async (state) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "/subprofile 选择器需要交互式 TUI；请用 /subprofile <name> 直切。",
          "warning",
        );
        return undefined;
      }
      const picked = await ctx.ui.custom<SelectorResult | undefined>(
        (_tui, theme, _kb, done) =>
          createProfileSelector({
            profiles: state.profiles,
            current: state.current,
            theme: themeAdapter(theme),
            onDone: done,
          }),
        { overlay: false },
      );
      return picked ?? undefined;
    },
    openConfigWizard: async (kind) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          `/subprofile ${kind} 向导需要交互式 TUI；请手动编辑用户档目录下的 *.json。`,
          "warning",
        );
        return;
      }
      const userRoot = statusDeps.roots.find((r) => r.source === "user");
      if (!userRoot) {
        ctx.ui.notify("未找到可写的用户档目录（roots 无 user 根）", "error");
        return;
      }
      await runConfigureWizard(kind, {
        fs: nodeFsLike,
        settingsPath: statusDeps.settingsPath,
        roots: statusDeps.roots,
        userDir: userRoot.dir,
        ui: ctx.ui,
        models: modelIds(ctx),
      });
    },
    onAfterCommand: () => {
      refreshStatus(statusDeps, {
        hasUI: ctx.hasUI,
        setStatus: (key, text) => ctx.ui.setStatus(key, text),
      });
    },
  };
}

export default function (pi: PiAPI): void {
  try {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const settingsPath = resolveSettingsPath();
    const roots = resolveProfileDirs({
      agentDir: agentDir(),
      packageRoot,
      env: process.env,
    });
    const statusDeps: StatusDeps = { fs: nodeFsLike, settingsPath, roots };

    pi.registerCommand("subprofile", {
      description: "Switch the whole pi-subagents `subagents` block from a profile file",
      getArgumentCompletions: (prefix) =>
        completeProfiles(prefix, { fs: nodeFsLike, roots }),
      handler: async (args, ctx) => {
        await runSubprofile(args, makeDeps(ctx, statusDeps));
      },
    });

    // session_start 覆盖 startup|reload|new|resume|fork；再叠加每次 /subprofile 结束后的刷新。
    pi.on("session_start", (_event, ctx) => {
      refreshStatus(statusDeps, {
        hasUI: ctx.hasUI,
        setStatus: (key, text) => ctx.ui.setStatus(key, text),
      });
    });
  } catch {
    // deps 构造失败（如 getAgentDir() 抛错）时 ctx 尚不可用 → 不注册命令，不让扩展加载崩溃。
    return;
  }
}

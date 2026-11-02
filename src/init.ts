import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { isChromiumInstalled } from "./drivers/browser.js";
import { ffmpegPath } from "./ffmpeg.js";
import { packageRoot, skillFile } from "./guide.js";

const require = createRequire(import.meta.url);

export interface InitOptions {
  browser?: boolean;
  mcp?: boolean;
  skill?: boolean;
  dryRun?: boolean;
  home?: string;
  log?: (msg: string) => void;
}

export interface InitReport {
  done: string[];
  skipped: string[];
  warnings: string[];
}

function onPath(cmd: string): boolean {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return probe.status === 0;
}

/** How agents should start the MCP server: from npm, or from this checkout when not installed from npm. */
export function mcpCommand(): { command: string; args: string[] } {
  const root = packageRoot();
  if (fs.existsSync(path.join(root, ".git"))) {
    return { command: process.execPath, args: [path.join(root, "dist", "cli.js"), "mcp"] };
  }
  // The npm package is agent-screenplay ("screenplay" belongs to someone else on npm).
  return { command: "npx", args: ["-y", "agent-screenplay", "mcp"] };
}

export async function init(opts: InitOptions = {}): Promise<InitReport> {
  const log = opts.log ?? (() => {});
  const home = opts.home ?? os.homedir();
  const report: InitReport = { done: [], skipped: [], warnings: [] };
  const act = (what: string, fn: () => void) => {
    if (opts.dryRun) {
      report.done.push(`(dry run) ${what}`);
      return;
    }
    try {
      fn();
      report.done.push(what);
    } catch (e) {
      report.warnings.push(`${what}: ${(e as Error).message}`);
    }
  };

  // 1. Chromium for web recordings.
  if (opts.browser !== false) {
    if (isChromiumInstalled()) report.skipped.push("Chromium already installed");
    else {
      log("Downloading Chromium (once)…");
      act("Installed Chromium for web recordings", () => {
        const cli = path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js");
        const r = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
        if (r.status !== 0) throw new Error("the download failed; run `npx playwright install chromium`, or set SCREENPLAY_CHROME to an installed Chrome");
      });
    }
  }

  // 2. ffmpeg.
  try {
    ffmpegPath();
  } catch (e) {
    report.warnings.push((e as Error).message);
  }

  // 3. MCP server in the agents found on this machine.
  if (opts.mcp !== false) {
    const { command, args } = mcpCommand();
    const found: string[] = [];

    if (onPath("claude")) {
      found.push("Claude Code");
      const exists = spawnSync("claude", ["mcp", "get", "screenplay"], { stdio: "ignore" }).status === 0;
      if (exists) report.skipped.push("Claude Code already has the screenplay MCP server");
      else
        act("Added the MCP server to Claude Code (user scope)", () => {
          const r = spawnSync("claude", ["mcp", "add", "--scope", "user", "screenplay", "--", command, ...args], { encoding: "utf8" });
          if (r.status !== 0) throw new Error(r.stderr || "claude mcp add failed");
        });
    }

    const codexDir = path.join(home, ".codex");
    if (onPath("codex") || fs.existsSync(codexDir)) {
      found.push("Codex");
      const file = path.join(codexDir, "config.toml");
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (/^\[mcp_servers\.screenplay\]/m.test(current)) report.skipped.push("Codex already has the screenplay MCP server");
      else
        act(`Added the MCP server to Codex (${file})`, () => {
          fs.mkdirSync(codexDir, { recursive: true });
          const block = [
            "",
            "[mcp_servers.screenplay]",
            `command = ${JSON.stringify(command)}`,
            `args = [${args.map((a) => JSON.stringify(a)).join(", ")}]`,
            "# Filming and editing a video takes longer than the default tool timeout.",
            "tool_timeout_sec = 900",
            "",
          ].join("\n");
          fs.writeFileSync(file, current.replace(/\s*$/, "\n") + block);
        });
    }

    const cursorDir = path.join(home, ".cursor");
    if (fs.existsSync(cursorDir)) {
      found.push("Cursor");
      const file = path.join(cursorDir, "mcp.json");
      let json: { mcpServers?: Record<string, unknown> } = {};
      if (fs.existsSync(file)) {
        try {
          json = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
          report.warnings.push(`${file} is not valid JSON: add the screenplay server by hand`);
          json = { mcpServers: { screenplay: true } };
        }
      }
      if (json.mcpServers?.screenplay) report.skipped.push("Cursor already has the screenplay MCP server");
      else
        act(`Added the MCP server to Cursor (${file})`, () => {
          json.mcpServers = { ...(json.mcpServers ?? {}), screenplay: { command, args } };
          fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
        });
    }

    if (found.length === 0) {
      report.warnings.push(
        `No agent found (Claude Code, Codex, Cursor). Add the MCP server by hand: command "${command}", args ${JSON.stringify(args)}.`,
      );
    }
  }

  // 4. The guide as a skill, for agents that load skills from disk.
  if (opts.skill !== false) {
    const targets = [
      { dir: path.join(home, ".claude"), name: "Claude Code" },
      { dir: path.join(home, ".codex"), name: "Codex" },
    ];
    for (const t of targets) {
      if (!fs.existsSync(t.dir)) continue;
      const dest = path.join(t.dir, "skills", "screenplay", "SKILL.md");
      act(`Installed the screenplay skill for ${t.name} (${dest})`, () => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(skillFile(), dest);
      });
    }
  }

  // 5. Desktop recordings need OS permissions on macOS.
  if (process.platform === "darwin") {
    report.warnings.push(
      "For desktop apps on macOS, allow your terminal (or agent app) in System Settings → Privacy & Security → Screen Recording and → Accessibility. Web recordings need nothing.",
    );
  }
  return report;
}

#!/usr/bin/env node
import { Command } from "commander";
import { check, record, render } from "./core.js";
import { guideText, schemaText } from "./guide.js";
import { init } from "./init.js";
import { login } from "./login.js";
import { ScenarioError } from "./scenario/load.js";
import { VERSION } from "./version.js";

const program = new Command();
program
  .name("screenplay")
  .description("Screen Studio-quality screen recordings for AI agents.")
  .version(VERSION);

const log = (msg: string) => process.stderr.write(`${msg}\n`);

function fail(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`\n✗ ${msg}\n`);
  if (process.env.SCREENPLAY_DEBUG && e instanceof Error && !(e instanceof ScenarioError)) process.stderr.write(`${e.stack}\n`);
  process.exit(1);
}

program
  .command("record")
  .argument("<scenario>", "scenario JSON file")
  .description("Film the scenario and edit the video (MP4 + storyboard).")
  .option("--no-voice", "skip the voice-over even if the scenario enables it")
  .option("--gif", "also write a GIF")
  .option("--json", "print the result as JSON")
  .action(async (file: string, o: { voice: boolean; gif?: boolean; json?: boolean }) => {
    try {
      const r = await record(file, { noVoice: !o.voice, gif: o.gif, log });
      if (o.json) console.log(JSON.stringify(r, null, 2));
      else {
        log(`\n✓ ${r.mp4} (${r.duration.toFixed(1)}s, ${r.steps} steps, edited in ${r.seconds.toFixed(0)}s)`);
        log(`  storyboard: ${r.storyboard}`);
        if (r.gif) log(`  gif: ${r.gif}`);
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("render")
  .argument("<scenario>", "scenario JSON file")
  .description("Edit the last recording again without filming (style, zoom, captions, narration).")
  .option("--no-voice", "skip the voice-over even if the scenario enables it")
  .option("--gif", "also write a GIF")
  .option("--json", "print the result as JSON")
  .action(async (file: string, o: { voice: boolean; gif?: boolean; json?: boolean }) => {
    try {
      const r = await render(file, { noVoice: !o.voice, gif: o.gif, log });
      if (o.json) console.log(JSON.stringify(r, null, 2));
      else log(`\n✓ ${r.mp4} (${r.duration.toFixed(1)}s)\n  storyboard: ${r.storyboard}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("style")
  .argument("<scenario>", "scenario JSON file")
  .description("Open the style editor in your browser: background, padding, corners and shadow, on a frame of the recording.")
  .option("--port <port>", "port to listen on (default: any free port)")
  .option("--no-open", "print the link instead of opening the browser")
  .action(async (file: string, o: { port?: string; open: boolean }) => {
    try {
      const { startStyleEditor } = await import("./editor/server.js");
      await startStyleEditor(file, { port: o.port ? Number(o.port) : undefined, open: o.open, log });
      log("Press Ctrl+C to stop.");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("check")
  .argument("<scenario>", "scenario JSON file")
  .description("Play the scenario quickly without filming: every element exists and the flow completes.")
  .option("--json", "print the report as JSON")
  .action(async (file: string, o: { json?: boolean }) => {
    try {
      const r = await check(file, { log: o.json ? undefined : log });
      if (o.json) console.log(JSON.stringify(r, null, 2));
      else {
        for (const s of r.steps) {
          log(`${s.ok ? "✓" : "✗"} ${s.index + 1}. ${s.step}${s.error && s.error !== "not reached" ? `\n    ${s.error}` : ""}`);
          if (s.candidates?.length) log(`    visible targets: ${s.candidates.slice(0, 15).join(", ")}`);
        }
        if (r.screenshot) log(`\nScreenshot where it stopped: ${r.screenshot}`);
        log(r.ok ? "\n✓ The scenario plays to the end." : "\n✗ The scenario stops before the end.");
      }
      if (!r.ok) process.exit(2);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("init")
  .description("Set up Screenplay: download Chromium, add the MCP server to Claude Code, Codex and Cursor, install the guide.")
  .option("--no-browser", "do not download Chromium")
  .option("--no-mcp", "do not add the MCP server to agents")
  .option("--no-skill", "do not install the guide as a skill")
  .option("--dry-run", "show what would change")
  .action(async (o: { browser: boolean; mcp: boolean; skill: boolean; dryRun?: boolean }) => {
    try {
      const r = await init({ browser: o.browser, mcp: o.mcp, skill: o.skill, dryRun: o.dryRun, log });
      for (const d of r.done) log(`✓ ${d}`);
      for (const s of r.skipped) log(`· ${s}`);
      for (const w of r.warnings) log(`! ${w}`);
      log("\nReady. Ask your agent: \"Make a screen recording that shows how <feature> works.\"");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("login")
  .argument("<url>", "page to sign in on")
  .option("-o, --out <file>", "where to save the session", ".screenplay/auth.json")
  .description("Open a browser to sign in once, or to pass a bot check (Cloudflare) by hand; close the window when done. The session is saved for scenarios (auth.storageState).")
  .action(async (url: string, o: { out: string }) => {
    try {
      const file = await login(url, o.out, log);
      log(`✓ Session saved to ${file}. Use it with "auth": { "storageState": "${o.out}" }. Keep it out of git.`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("mcp")
  .description("Run the MCP server on stdio (for agents).")
  .action(async () => {
    const { startMcpServer } = await import("./mcp/server.js");
    await startMcpServer();
  });

program
  .command("guide")
  .description("Print the guide to writing good scenarios.")
  .action(() => {
    process.stdout.write(guideText());
  });

program
  .command("schema")
  .description("Print the JSON schema of scenarios.")
  .action(() => {
    process.stdout.write(schemaText());
  });

program.parseAsync(process.argv).catch(fail);


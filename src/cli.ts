#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import { check, record, render } from "./core.js";
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

program.parseAsync(process.argv).catch(fail);

void fs;

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { check, record, render } from "../../src/core.js";
import { ffmpegPath } from "../../src/ffmpeg.js";

const root = path.resolve(__dirname, "../..");

function videoDuration(file: string): number {
  const r = spawnSync(ffmpegPath(), ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

function scenarioFile(extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-e2e-"));
  const file = path.join(dir, "e2e.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      url: path.join(root, "examples/demo-app/index.html"),
      output: { width: 640, height: 360, fps: 24 },
      steps: [
        { title: "E2E" },
        { click: "text=Camille Laurent", say: "Open the conversation." },
        { click: "role=button[name='Take over']" },
        { type: "On it", into: "placeholder=Write a reply…" },
        { click: "role=button[name='Send']" },
        { callout: "text=On it", text: "Sent", duration: 1 },
        { end: "Done" },
      ],
      ...extra,
    }),
  );
  return file;
}

describe("web recording, end to end", () => {
  it("checks, records, renders again", async () => {
    const file = scenarioFile();
    const c = await check(file);
    expect(c.ok).toBe(true);

    const r = await record(file);
    expect(fs.existsSync(r.mp4)).toBe(true);
    expect(fs.existsSync(r.storyboard)).toBe(true);
    const d = videoDuration(r.mp4);
    expect(d).toBeGreaterThan(8);
    expect(Math.abs(d - r.duration)).toBeLessThan(0.3);

    // A style change needs no new filming.
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.style = { background: "midnight", cursor: "dot" };
    fs.writeFileSync(file, JSON.stringify(json));
    const r2 = await render(file, { gif: true });
    expect(fs.existsSync(r2.gif!)).toBe(true);
  }, 240_000);

  it("reports a missing target with the visible ones", async () => {
    const file = scenarioFile({ steps: [{ click: "text=Nobody" }] });
    const c = await check(file);
    expect(c.ok).toBe(false);
    expect(c.steps[0].candidates).toContain("text=Camille Laurent");
  }, 60_000);

  it("refuses to re-render when actions changed", async () => {
    const file = scenarioFile({ steps: [{ click: "text=Camille Laurent" }] });
    await record(file);
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.steps.push({ click: "role=button[name='Take over']" });
    fs.writeFileSync(file, JSON.stringify(json));
    await expect(render(file)).rejects.toThrow(/steps changed/);
  }, 120_000);
});

describe("MCP server", () => {
  it("lists its tools and serves the guide", async () => {
    const t = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist/cli.js"), "mcp"] });
    const client = new Client({ name: "e2e", version: "1" });
    await client.connect(t);
    const tools = (await client.listTools()).tools.map((x) => x.name).sort();
    expect(tools).toEqual(["screenplay_check", "screenplay_guide", "screenplay_record", "screenplay_render"]);
    const g = (await client.callTool({ name: "screenplay_guide", arguments: {} })) as { content: Array<{ text: string }> };
    expect(g.content[0].text).toContain("## The loop");
    await client.close();
  }, 30_000);
});

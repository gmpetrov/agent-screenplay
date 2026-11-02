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
    await expect(render(file)).rejects.toThrow(/no longer matches/);
    // Same number and kinds of steps, different target: still refused.
    json.steps = [{ click: "text=Jonas Becker" }];
    fs.writeFileSync(file, JSON.stringify(json));
    await expect(render(file)).rejects.toThrow(/step 1/);
  }, 120_000);
});

describe("MCP server", () => {
  it("lists its tools and serves the guide", async () => {
    const t = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist/cli.js"), "mcp"] });
    const client = new Client({ name: "e2e", version: "1" });
    await client.connect(t);
    const list = (await client.listTools()).tools;
    expect(list.map((x) => x.name).sort()).toEqual(["screenplay_check", "screenplay_guide", "screenplay_record", "screenplay_render"]);
    // Playing a scenario performs real actions: never advertise it as read-only.
    for (const name of ["screenplay_check", "screenplay_record"]) {
      const tool = list.find((x) => x.name === name)!;
      expect(tool.annotations?.readOnlyHint).toBe(false);
      expect(tool.annotations?.destructiveHint).toBe(true);
    }
    // Rendering does not touch the app, but may call the voice service.
    const renderTool = list.find((x) => x.name === "screenplay_render")!;
    expect(renderTool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    // An invalid inline scenario must not overwrite the file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-mcp-"));
    const target = path.join(dir, "keep.json");
    fs.writeFileSync(target, "original");
    const bad = (await client.callTool({ name: "screenplay_check", arguments: { path: target, scenario: { steps: [] } } })) as { isError?: boolean };
    expect(bad.isError).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("original");
    const g = (await client.callTool({ name: "screenplay_guide", arguments: {} })) as { content: Array<{ text: string }> };
    expect(g.content[0].text).toContain("## The loop");
    await client.close();
  }, 30_000);
});

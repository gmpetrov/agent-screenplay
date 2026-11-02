import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjectConfig, mergeStyles } from "../src/scenario/config.js";
import { loadScenario, parseScenario } from "../src/scenario/load.js";
import { resolveStyle } from "../src/render/style.js";
import { saveStyle, startStyleEditor, state } from "../src/editor/server.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** A project folder with a scenario in a subfolder. */
function project(config?: object, scenarioStyle?: object) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sp-style-")));
  dirs.push(root);
  fs.mkdirSync(path.join(root, "videos"));
  if (config) fs.writeFileSync(path.join(root, "screenplay.config.json"), JSON.stringify(config));
  const file = path.join(root, "videos", "demo.json");
  fs.writeFileSync(file, JSON.stringify({ url: "https://example.com", ...(scenarioStyle ? { style: scenarioStyle } : {}), steps: [{ pause: 1 }] }));
  return { root, file };
}
const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));

describe("style", () => {
  it("accepts custom gradients and rejects bad colors", async () => {
    const s = parseScenario({ url: "x", style: { background: { gradient: ["#0ea5e9", "#6366f1"], angle: 90 } }, steps: [{ pause: 1 }] });
    const r = await resolveStyle(s.style, ".");
    expect(r.background).toEqual({ kind: "gradient", stops: ["#0ea5e9", "#6366f1"], angle: 90 });
    expect(() => parseScenario({ url: "x", style: { background: { gradient: ["blue", "#fff"] } }, steps: [{ pause: 1 }] })).toThrow(/hex color/);
    expect(() => parseScenario({ url: "x", style: { background: { gradient: ["#fff"] } }, steps: [{ pause: 1 }] })).toThrow();
  });

  it("merges the project's style under the scenario's, setting by setting", () => {
    const { root, file } = project({ style: { background: "sunset", padding: 120, radius: 24 } }, { radius: 4 });
    expect(findProjectConfig(path.dirname(file))).toBe(path.join(root, "screenplay.config.json"));
    expect(loadScenario(file).scenario.style).toEqual({ background: "sunset", padding: 120, radius: 4 });
    expect(mergeStyles(undefined, { radius: 2 })).toEqual({ radius: 2 });
  });

  it("resolves a project image relative to the config file", () => {
    const { root, file } = project({ style: { background: "brand/bg.png" } });
    expect(loadScenario(file).scenario.style?.background).toBe(path.join(root, "brand", "bg.png"));
  });

  it("saves to the scenario, keeping its other settings", () => {
    const { file } = project(undefined, { cursor: "dot", padding: 10 });
    saveStyle(file, "scenario", { background: "#0f172a", padding: 96, radius: 20, shadow: false });
    expect(read(file).style).toEqual({ cursor: "dot", padding: 96, background: "#0f172a", radius: 20, shadow: false });
  });

  it("saves to the project and removes the scenario's overrides of those settings", () => {
    const { root, file } = project(undefined, { cursor: "dot", padding: 10, radius: 2 });
    const saved = saveStyle(file, "project", { background: { gradient: ["#0ea5e9", "#6366f1"] }, padding: 96, radius: 20, shadow: true });
    expect(saved).toBe(path.join(path.dirname(file), "screenplay.config.json"));
    expect(read(saved).style).toEqual({ background: { gradient: ["#0ea5e9", "#6366f1"] }, padding: 96, radius: 20, shadow: true });
    expect(read(file).style).toEqual({ cursor: "dot" });
    // An existing config higher up is the one updated.
    const p2 = project({ style: { accent: "#ff0000" } });
    saveStyle(p2.file, "project", { padding: 50 } as never);
    expect(read(path.join(p2.root, "screenplay.config.json")).style).toEqual({ accent: "#ff0000", padding: 50 });
    expect(root).not.toBe(p2.root);
  });

  it("stores an uploaded image relative to the file that uses it", () => {
    const { root, file } = project({});
    const img = path.join(path.dirname(file), "screenplay-assets", "bg.png");
    saveStyle(file, "project", { background: img });
    expect(read(path.join(root, "screenplay.config.json")).style.background).toBe("videos/screenplay-assets/bg.png");
    saveStyle(file, "scenario", { background: img });
    expect(read(file).style.background).toBe("screenplay-assets/bg.png");
  });

  it("refuses an invalid style", () => {
    const { file } = project();
    expect(() => saveStyle(file, "scenario", { padding: 9999 } as never)).toThrow(/Invalid style/);
  });

  it("reports the styles as written", () => {
    const { file } = project({ style: { padding: 120 } }, { radius: 3, cursor: "dot" });
    const s = state(file);
    expect(s.projectStyle).toEqual({ padding: 120 });
    expect(s.scenarioStyle).toEqual({ radius: 3 });
    expect(s.configExists).toBe(true);
    expect(s.hasTake).toBe(false);
  });
});

describe("style editor server", () => {
  it("needs the token and serves only images of the project", async () => {
    const { root, file } = project({});
    fs.writeFileSync(path.join(root, "secret.txt"), "no");
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sp-out-")));
    dirs.push(outside);
    fs.writeFileSync(path.join(outside, "private.png"), "x");
    fs.writeFileSync(path.join(path.dirname(file), "ok.png"), "x");
    const ed = await startStyleEditor(file, { open: false });
    try {
      const base = ed.url.split("/?")[0];
      const token = new URL(ed.url).searchParams.get("t")!;
      expect((await fetch(`${base}/`)).status).toBe(403);
      expect((await fetch(`${base}/api/state`)).status).toBe(403);
      expect((await fetch(ed.url)).status).toBe(200);
      const h = { "x-token": token };
      expect((await (await fetch(`${base}/api/state`, { headers: h })).json()).name).toBe("demo");
      const img = (p: string, from = "scenario") => fetch(`${base}/api/image?from=${from}&path=${encodeURIComponent(p)}`, { headers: h });
      expect((await img("ok.png")).status).toBe(200);
      expect((await img(path.join(outside, "private.png"))).status).toBe(404);
      expect((await img("../secret.txt")).status).toBe(404);
      const up = await fetch(`${base}/api/upload`, { method: "POST", headers: { ...h, "x-filename": "Brand BG.png" }, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]) });
      const { path: saved } = (await up.json()) as { path: string };
      expect(saved.split(path.sep).join("/")).toMatch(/videos\/screenplay-assets\/Brand-BG-[0-9a-f]{6}\.png$/);
      expect((await fetch(`${base}/api/upload`, { method: "POST", headers: { ...h, "x-filename": "x.txt" }, body: "hello" })).status).toBe(400);
      expect((await fetch(`${base}/api/render`, { method: "POST", headers: h })).status).toBe(409);
    } finally {
      await ed.close();
    }
  });
});

describe("default viewport", () => {
  it("has the video's shape, so the page fills the frame with no padding", async () => {
    const { defaultViewport } = await import("../src/drivers/web.js");
    expect(defaultViewport()).toEqual({ width: 1440, height: 810 });
    expect(defaultViewport({ width: 1080, height: 1080 })).toEqual({ width: 1440, height: 1440 });
    expect(defaultViewport({ width: 1920, height: 1200 })).toEqual({ width: 1440, height: 900 });
  });
});

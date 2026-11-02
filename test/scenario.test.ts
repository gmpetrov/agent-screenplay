import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScenario, parseScenario, slugify, substituteEnv } from "../src/scenario/load.js";
import { describeStep, stepKind } from "../src/scenario/schema.js";
import { captureInputs } from "../src/scenario/fingerprint.js";

describe("scenario", () => {
  it("accepts a minimal web scenario", () => {
    const s = parseScenario({ url: "https://example.com", steps: [{ click: "text=Go" }] });
    expect(stepKind(s.steps[0])).toBe("click");
  });

  it("needs either a url, or an app and/or the whole screen", () => {
    expect(() => parseScenario({ steps: [{ pause: 1 }] })).toThrow(/either `url`/);
    expect(() => parseScenario({ url: "x", app: "y", steps: [{ pause: 1 }] })).toThrow(/either `url`/);
    expect(() => parseScenario({ url: "x", screen: true, steps: [{ pause: 1 }] })).toThrow(/either `url`/);
    expect(parseScenario({ screen: true, steps: [{ open: "Finder" }, { click: "text=Go", app: "Finder", surface: "menubar" }] }).screen).toBe(true);
    expect(parseScenario({ screen: true, app: "Finder", hideOthers: true, steps: [{ pause: 1 }] }).app).toBe("Finder");
  });

  it("keeps desktop-only step fields out of website scenarios", () => {
    expect(() => parseScenario({ url: "x", steps: [{ open: "Finder" }] })).toThrow(/desktop recordings/);
    expect(() => parseScenario({ url: "x", steps: [{ click: "text=Go", app: "Finder" }] })).toThrow(/desktop recordings/);
  });

  it("does not change the fingerprint of window recordings", () => {
    const window = captureInputs(parseScenario({ app: "Notes", steps: [{ click: "text=Go" }] }));
    const screen = captureInputs(parseScenario({ app: "Notes", screen: true, steps: [{ click: "text=Go" }] }));
    // The setup hash of a window recording is what it was before screen mode existed, so its takes still re-render.
    const old = JSON.stringify([null, "Notes", null, null, null, null, null, null, null]);
    expect(window.setup).toBe(crypto.createHash("sha1").update(old).digest("hex").slice(0, 12));
    expect(screen.setup).not.toBe(window.setup);
  });

  it("rejects unknown keys with the path in the message", () => {
    expect(() => parseScenario({ url: "x", steps: [{ clik: "text=Go" }] })).toThrow(/steps\.0/);
  });

  it("substitutes environment variables and names missing ones", () => {
    expect(substituteEnv({ a: ["${X}-y"] }, { X: "1" })).toEqual({ a: ["1-y"] });
    expect(() => substituteEnv("${NOPE}", {})).toThrow(/NOPE/);
  });

  it("masks secret typing in descriptions", () => {
    const s = parseScenario({ url: "x", steps: [{ type: "hunter2", into: "label=Password", secret: true }] });
    expect(describeStep(s.steps[0])).not.toContain("hunter2");
  });

  it("resolves a relative url to a local file and names outputs after the scenario", () => {
    // Paths are real paths: on macOS the temp folder is a symlink into /private.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sp-")));
    const file = path.join(dir, "My Démo.json");
    fs.writeFileSync(file, JSON.stringify({ url: "app/index.html", steps: [{ pause: 1 }] }));
    const l = loadScenario(file);
    expect(l.scenario.url).toMatch(/^file:\/\/.*\/app\/index\.html$/);
    expect(l.outputs.mp4).toBe(path.join(dir, "my-demo.mp4"));
    expect(l.takeDir).toBe(path.join(dir, ".screenplay", "takes", "my-demo"));
  });

  it("loads a scenario reached through a symlink as the same scenario", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sp-")));
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ url: "app/index.html", steps: [{ pause: 1 }] }));
    const link = `${dir}-link`;
    fs.symlinkSync(dir, link);
    try {
      expect(loadScenario(path.join(link, "a.json")).scenario.url).toBe(loadScenario(path.join(dir, "a.json")).scenario.url);
    } finally {
      fs.unlinkSync(link);
    }
  });

  it("slugifies names", () => {
    expect(slugify("Handoff — démo #2")).toBe("handoff-demo-2");
  });
});

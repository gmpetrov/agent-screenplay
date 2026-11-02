import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScenario, parseScenario, slugify, substituteEnv } from "../src/scenario/load.js";
import { describeStep, stepKind } from "../src/scenario/schema.js";

describe("scenario", () => {
  it("accepts a minimal web scenario", () => {
    const s = parseScenario({ url: "https://example.com", steps: [{ click: "text=Go" }] });
    expect(stepKind(s.steps[0])).toBe("click");
  });

  it("needs exactly one of url or app", () => {
    expect(() => parseScenario({ steps: [{ pause: 1 }] })).toThrow(/exactly one of `url`/);
    expect(() => parseScenario({ url: "x", app: "y", steps: [{ pause: 1 }] })).toThrow(/exactly one/);
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-"));
    const file = path.join(dir, "My Démo.json");
    fs.writeFileSync(file, JSON.stringify({ url: "app/index.html", steps: [{ pause: 1 }] }));
    const l = loadScenario(file);
    expect(l.scenario.url).toMatch(/^file:\/\/.*\/app\/index\.html$/);
    expect(l.outputs.mp4).toBe(path.join(dir, "my-demo.mp4"));
    expect(l.takeDir).toBe(path.join(dir, ".screenplay", "takes", "my-demo"));
  });

  it("slugifies names", () => {
    expect(slugify("Handoff — démo #2")).toBe("handoff-demo-2");
  });
});

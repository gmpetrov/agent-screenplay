import { describe, expect, it } from "vitest";
import { autoZoom, cursorAt, locate, planTake } from "../src/direct/plan.js";
import { parseScenario } from "../src/scenario/load.js";
import type { Take } from "../src/take.js";

const scenario = parseScenario({
  url: "https://example.com",
  steps: [{ title: "Hello" }, { click: "text=A", say: "Click A" }, { wait: "text=Done" }, { click: "text=B", zoom: false }],
});

function take(): Take {
  return {
    version: 1,
    name: "t",
    recordedAt: "",
    platform: "linux",
    target: { kind: "web", url: "https://example.com" },
    width: 1440,
    height: 900,
    scale: 2,
    duration: 14,
    cursorStart: { x: 900, y: 600 },
    source: { kind: "frames", dir: "frames", frames: [[0, "f1.jpg"]] },
    steps: [
      { index: 0, kind: "title", label: "title", start: 0.6, end: 0.6, waits: [], card: { kind: "title", title: "Hello", duration: 2 } },
      { index: 1, kind: "click", label: "click A", start: 0.6, end: 2.5, travelStart: 0.6, actionAt: 1.2, point: { x: 100, y: 100 }, box: { x: 60, y: 90, width: 80, height: 20 }, waits: [] },
      { index: 2, kind: "wait", label: "wait", start: 2.5, end: 10.5, waits: [[2.5, 10.5]] },
      { index: 3, kind: "click", label: "click B", start: 10.5, end: 12, travelStart: 10.5, actionAt: 11, point: { x: 1300, y: 800 }, box: { x: 1260, y: 790, width: 80, height: 20 }, waits: [] },
    ],
  };
}

describe("planTake", () => {
  const t = take();
  const plan = planTake(t, scenario, { fps: 30, audio: new Map(), autoZoom: true, maxZoom: 1.9, captions: true });

  it("opens on the title card, without the recorded lead-in", () => {
    expect(plan.pieces[0]).toMatchObject({ kind: "card", o0: 0, o1: 2 });
  });

  it("speeds up long waits", () => {
    const wait = plan.stepTimes[2];
    expect(wait.o1 - wait.o0).toBeLessThanOrEqual(2.4 + 1e-6);
    expect(plan.duration).toBeLessThan(t.duration - 0.6 + 2 - 5);
  });

  it("zooms in on a click and back out for a step with zoom: false", () => {
    const atClick = plan.cameras[Math.round((plan.stepTimes[1].oAction! + 0.9) * 30)];
    expect(atClick.z).toBeGreaterThan(1.5);
    const last = plan.cameras[plan.cameras.length - 1];
    expect(last.z).toBeLessThan(1.05);
  });

  it("keeps the camera inside the page", () => {
    for (const c of plan.cameras) {
      const halfW = 1440 / (2 * c.z);
      expect(c.cx).toBeGreaterThanOrEqual(halfW - 1e-6);
      expect(c.cx).toBeLessThanOrEqual(1440 - halfW + 1e-6);
    }
  });

  it("shows the narration as a caption", () => {
    expect(plan.captions.map((c) => c.text)).toEqual(["Click A"]);
  });

  it("moves the cursor from its start to the click point", () => {
    expect(cursorAt(plan.movements, t.cursorStart, 0)).toEqual(t.cursorStart);
    expect(cursorAt(plan.movements, t.cursorStart, 1.2)).toEqual({ x: 100, y: 100 });
    const mid = cursorAt(plan.movements, t.cursorStart, 0.9);
    expect(mid.x).toBeLessThan(900);
    expect(mid.x).toBeGreaterThan(100);
  });

  it("maps output time back to recording time", () => {
    const at = locate(plan, plan.stepTimes[1].oAction!);
    expect(at.piece.kind).toBe("capture");
    expect(at.s).toBeCloseTo(1.2, 2);
  });

  it("holds the image when narration is longer than the step", () => {
    const audio = new Map([[1, { file: "x.wav", duration: 6 }]]);
    const p = planTake(take(), scenario, { fps: 30, audio, autoZoom: true, maxZoom: 1.9, captions: true });
    const s = p.stepTimes[1];
    expect(s.o1 - s.o0).toBeGreaterThanOrEqual(6.3);
    expect(p.voice).toHaveLength(1);
  });
});

describe("autoZoom", () => {
  it("never zooms past the maximum, nor below 1", () => {
    expect(autoZoom({ x: 0, y: 0, width: 10, height: 10 }, 1440, 900, 1.9)).toBeCloseTo(1.9);
    expect(autoZoom({ x: 0, y: 0, width: 1400, height: 800 }, 1440, 900, 1.9)).toBe(1);
  });
});

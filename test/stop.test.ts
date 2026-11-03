import { afterEach, describe, expect, it, vi } from "vitest";

const pill = vi.hoisted(() => ({ stop: () => {}, closed: false }));
vi.mock("../src/drivers/indicator.js", () => ({
  showIndicator: (_label: string, stop: () => void) => {
    pill.stop = stop;
    pill.closed = false;
    return {
      close() {
        pill.closed = true;
      },
    };
  },
}));

import { AgentDesktop, checkDesktop, createStopper } from "../src/drivers/desktop.js";
import { parseScenario } from "../src/scenario/load.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** A desktop check against a fake agent-desktop; `hook` runs on each call before the fake answer. */
function run(steps: unknown[], hook: (args: string[]) => Promise<void> | void = () => {}) {
  const calls: string[][] = [];
  vi.stubEnv("DISPLAY", ":99");
  vi.spyOn(AgentDesktop, "locate").mockReturnValue("/unused");
  vi.spyOn(AgentDesktop.prototype, "invoke").mockImplementation(async (args: string[]) => {
    calls.push(args);
    await hook(args);
    let data: unknown = {};
    if (args[0] === "session") data = { session_id: "test" };
    if (args[0] === "list-apps") data = { apps: [{ name: "Notes" }] };
    if (args[0] === "list-windows") data = [{ id: "w1", bounds: { x: 0, y: 0, width: 600, height: 500 }, visible: true }];
    if (args[0] === "list-displays") data = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 1, is_primary: true }];
    if (args[0] === "find") data = { match: { ref_id: "send", bounds: { x: 200, y: 200, width: 200, height: 50 } } };
    if (args[0] === "get") data = { value: { x: 200, y: 200, width: 200, height: 50 } };
    return { ok: true, data };
  });
  const scenario = parseScenario({ app: "Notes", screen: true, steps });
  const done = checkDesktop({ scenario, takeDir: "/unused" } as never, {}).then(
    () => "finished",
    (e: Error) => e.message,
  );
  return { calls, done };
}

describe("Stop on the recording pill", () => {
  it("sends no click once Stop is pressed while the target is being resolved", async () => {
    const { calls, done } = run([{ click: "role=button" }], (args) => {
      if (args[0] === "get") pill.stop();
    });
    expect(await done).toMatch(/^Stopped:/);
    expect(calls.some((c) => c.includes("click"))).toBe(false);
    expect(calls.at(-1)?.slice(0, 2)).toEqual(["session", "end"]);
  });

  it("stops typing at the key being pressed: no further keys, no Return", async () => {
    const { calls, done } = run([{ type: "abc", submit: true }], (args) => {
      if (args[0] === "press" && args.at(-1) === "a") pill.stop();
    });
    expect(await done).toMatch(/^Stopped:/);
    expect(calls.filter((c) => c[0] === "press").map((c) => c.at(-1))).toEqual(["a"]);
  });

  it("ends a pending target wait at once and closes the pill", async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const blocked = new Promise<void>((r) => (release = r));
    const { done } = run([{ wait: "role=button", timeout: 120 }], async (args) => {
      if (args[0] === "find") {
        entered();
        await blocked;
      }
    });
    await ready;
    pill.stop();
    expect(await done).toMatch(/^Stopped:/);
    expect(pill.closed).toBe(true);
    release();
  });

  it("ends pauses at once and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const s = createStopper();
    const p = s.pause(120);
    expect(vi.getTimerCount()).toBe(1);
    s.stop();
    await p;
    expect(vi.getTimerCount()).toBe(0);
    expect(() => s.check()).toThrow(/^Stopped:/);
    await expect(s.signal).rejects.toThrow(/^Stopped:/);
  });

  it("refuses agent-desktop calls after Stop, except ending the session", async () => {
    vi.spyOn(AgentDesktop, "locate").mockReturnValue("/unused");
    const invoke = vi.spyOn(AgentDesktop.prototype, "invoke").mockResolvedValue({ ok: true, data: {} });
    const ad = new AgentDesktop();
    ad.stop();
    await expect(ad.call(["click", "x"])).rejects.toThrow(/^Stopped:/);
    await expect(ad.call(["session", "end", "s"])).resolves.toMatchObject({ ok: true });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

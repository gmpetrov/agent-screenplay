import { afterEach, expect, it, vi } from "vitest";
import { AgentDesktop, checkDesktop } from "../src/drivers/desktop.js";
import { parseScenario } from "../src/scenario/load.js";

// Plays a whole-screen scenario against a fake agent-desktop and returns the commands it received.
// (From Cody's review of PR #2.)
afterEach(() => vi.restoreAllMocks());

async function replay(steps: unknown[]) {
  const calls: string[][] = [];
  vi.spyOn(AgentDesktop, "locate").mockReturnValue("/unused");
  vi.spyOn(AgentDesktop.prototype, "call").mockImplementation(async (args: string[]) => {
    calls.push(args);
    let data: unknown = {};
    if (args[0] === "session") data = { session_id: "test" };
    if (args[0] === "list-apps") data = { apps: [{ name: "Notes" }, { name: "TextEdit" }] };
    if (args[0] === "list-windows") {
      const app = args[args.indexOf("--app") + 1];
      data = [{ id: `${app}-window`, bounds: { x: 100, y: 100, width: 600, height: 500 }, visible: true }];
    }
    if (args[0] === "list-displays") data = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 1, is_primary: true }];
    if (args[0] === "find") data = { match: { ref_id: `${args[args.indexOf("--app") + 1]}-field`, bounds: { x: 200, y: 200, width: 200, height: 50 } } };
    if (args[0] === "get") data = { value: { x: 200, y: 200, width: 200, height: 50 } };
    return { ok: true, data };
  });
  const scenario = parseScenario({ app: "Notes", screen: true, steps });
  const report = await checkDesktop({ scenario, takeDir: "/unused" } as never, {});
  expect(report.ok).toBe(true);
  return calls;
}

it("does not type into the previous app's field after open", async () => {
  const calls = await replay([{ click: "role=textfield" }, { open: "TextEdit" }, { type: "new text" }]);
  expect(calls.filter((c) => c[0] === "type")).toEqual([]);
  expect(calls.filter((c) => c[0] === "press").map((c) => c.slice(0, 3))).toContainEqual(["press", "--app", "TextEdit"]);
});

it("does not type into the previous app's field when a step names another app", async () => {
  const calls = await replay([{ click: "role=textfield" }, { type: "new text", app: "TextEdit" }]);
  expect(calls.filter((c) => c[0] === "type")).toEqual([]);
});

it("brings a step's app to the front before acting in it", async () => {
  const calls = await replay([{ click: "role=textfield", app: "TextEdit" }]);
  const focus = calls.findIndex((c) => c.join(" ") === "--headed focus-window --window-id TextEdit-window");
  const click = calls.findIndex((c) => c.join(" ") === "click TextEdit-field");
  expect(focus).toBeGreaterThan(-1);
  expect(click).toBeGreaterThan(focus);
});

it("keeps typing into the clicked field in the same app", async () => {
  const calls = await replay([{ click: "role=textfield" }, { type: "hi" }]);
  expect(calls.filter((c) => c[0] === "type")).toEqual([["type", "Notes-field", "hi"]]);
});

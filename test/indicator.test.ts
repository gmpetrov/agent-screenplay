import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { STOP_CODE, indicatorCommand, showIndicator } from "../src/drivers/indicator.js";

/** Runs the pill in self-test mode: it shows, presses its own Stop button, and exits. */
function selftest(): Promise<number | null> {
  const [cmd, args] = indicatorCommand("Screenplay is recording")!;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, [...args, "selftest"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) => (code === STOP_CODE ? resolve(code) : reject(new Error(`exit ${code}: ${err}`))));
  });
}

describe("recording pill", () => {
  it("has a command on macOS and Windows only", () => {
    expect(indicatorCommand("x", "darwin")?.[0]).toBe("osascript");
    expect(indicatorCommand("x", "win32")?.[0]).toBe("powershell.exe");
    expect(indicatorCommand("x", "linux")).toBeUndefined();
  });

  it("can be turned off", () => {
    process.env.SCREENPLAY_INDICATOR = "0";
    try {
      expect(() => showIndicator("x", () => {}).close()).not.toThrow();
    } finally {
      delete process.env.SCREENPLAY_INDICATOR;
    }
  });

  it.runIf(process.platform === "darwin" || process.platform === "win32")("shows, and its Stop button ends it with the stop code", async () => {
    expect(await selftest()).toBe(STOP_CODE);
  }, 60_000);
});

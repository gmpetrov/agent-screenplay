import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright-core";

// login opens a visible browser; here the same code runs on a headless one, and the "person"
// closes the window from the test. That is how an agent-run login ends (no terminal to type in).
describe("login", () => {
  it("saves the session when the person closes the window", async () => {
    // The browser here is headless, but login checks for a screen first (Linux CI has none).
    vi.stubEnv("DISPLAY", process.env.DISPLAY || ":99");
    const real = await import("../src/drivers/browser.js");
    // The browser can take several seconds to start on CI machines: wait for it, not for a fixed time.
    let launched!: (b: Browser) => void;
    const ready = new Promise<Browser>((r) => (launched = r));
    vi.doMock("../src/drivers/browser.js", () => ({
      ...real,
      launchBrowser: async () => {
        const b = await real.launchBrowser({ headless: true });
        launched(b);
        return b;
      },
    }));
    const { login } = await import("../src/login.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-login-"));
    const out = path.join(dir, "auth.json");
    const page = `data:text/html,<script>document.cookie="seen=1";localStorage.setItem("k","v")</script>ok`;
    const done = login(page, out);
    const opened = await Promise.race([ready, done.then(() => Promise.reject(new Error("login ended before its window opened")))]);
    while (!opened.contexts()[0]?.pages().length) await new Promise((r) => setTimeout(r, 50));
    // Close the window like a person would.
    await opened.contexts()[0].pages()[0].close();
    expect(await done).toBe(out);
    // Closed even before the page had loaded: still saved, and the command still ends.
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toHaveProperty("cookies");
    fs.rmSync(dir, { recursive: true, force: true });
    vi.doUnmock("../src/drivers/browser.js");
    vi.unstubAllEnvs();
  }, 90_000);
});

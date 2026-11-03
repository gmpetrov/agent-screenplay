import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright-core";

// login opens a visible browser; here the same code runs on a headless one, and the "person"
// closes the window from the test. That is how an agent-run login ends (no terminal to type in).
describe("login", () => {
  it("saves the session when the person closes the window", async () => {
    const real = await import("../src/drivers/browser.js");
    let opened: Browser | undefined;
    vi.doMock("../src/drivers/browser.js", () => ({
      ...real,
      launchBrowser: async () => (opened = await real.launchBrowser({ headless: true })),
    }));
    const { login } = await import("../src/login.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-login-"));
    const out = path.join(dir, "auth.json");
    const page = `data:text/html,<script>document.cookie="seen=1";localStorage.setItem("k","v")</script>ok`;
    const done = login(page, out);
    // Wait for the window, then close it like a person would.
    for (let i = 0; i < 50 && !opened?.contexts()[0]?.pages().length; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 500));
    await opened!.contexts()[0].pages()[0].close();
    expect(await done).toBe(out);
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toHaveProperty("cookies");
    fs.rmSync(dir, { recursive: true, force: true });
    vi.doUnmock("../src/drivers/browser.js");
  }, 30_000);
});

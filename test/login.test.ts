import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// login's logic with a stand-in browser: the window can be closed at any moment, as a person
// would, and the command must save the session and end. (A real browser is not needed for that,
// and real ones start too slowly and unevenly on CI machines.)
class FakePage extends EventEmitter {
  closed = false;
  constructor(private ctx: FakeContext, private gotoMs: number) {
    super();
  }
  async goto() {
    await new Promise((r) => setTimeout(r, this.gotoMs));
    if (this.closed) throw new Error("Target closed");
    this.emit("load");
  }
  async close() {
    this.closed = true;
    this.ctx.list = this.ctx.list.filter((p) => p !== this);
    this.emit("close");
  }
}
class FakeContext extends EventEmitter {
  list: FakePage[] = [];
  constructor(private gotoMs: number) {
    super();
  }
  async newPage() {
    const p = new FakePage(this, this.gotoMs);
    this.list.push(p);
    return p;
  }
  pages() {
    return this.list;
  }
  async storageState() {
    return { cookies: [{ name: "cf_clearance", value: "x" }], origins: [] };
  }
}
class FakeBrowser extends EventEmitter {
  context: FakeContext;
  constructor(gotoMs: number) {
    super();
    this.context = new FakeContext(gotoMs);
  }
  async newContext() {
    return this.context;
  }
  async close() {}
}

afterEach(() => {
  vi.doUnmock("../src/drivers/browser.js");
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function run(gotoMs: number, closeAfterMs: number) {
  vi.stubEnv("DISPLAY", process.env.DISPLAY || ":99"); // login checks for a screen first
  const browser = new FakeBrowser(gotoMs);
  vi.doMock("../src/drivers/browser.js", () => ({ launchBrowser: async () => browser }));
  const { login } = await import("../src/login.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-login-"));
  const out = path.join(dir, "auth.json");
  const done = login("https://example.com", out);
  while (!browser.context.list.length) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, closeAfterMs));
  await browser.context.list[0].close();
  expect(await done).toBe(out);
  expect(JSON.parse(fs.readFileSync(out, "utf8")).cookies[0].name).toBe("cf_clearance");
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("login", () => {
  it("saves the session and ends when the person closes the window", () => run(10, 100));
  it("ends even when the window is closed while the page is still loading", () => run(500, 20));
});

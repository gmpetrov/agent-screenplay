import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { launchBrowser } from "./drivers/browser.js";

/**
 * Open a visible browser on `url` for a person to sign in or pass a bot check (Cloudflare's
 * "Verify you are human"), and save the session for scenarios (`auth.storageState`).
 *
 * The session is written to the file every few seconds while the window is open, so it is saved
 * however the person finishes: closing the window or the tab, pressing Enter in the terminal, or
 * the command being stopped. Agents run this command without a terminal a person can type in, so
 * closing the window is the way that always works.
 */
export async function login(url: string, out: string, log: (msg: string) => void = () => {}): Promise<string> {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error(
      "`login` opens a visible browser, and this machine has no screen. Log in with steps in the scenario instead (type ${EMAIL} / ${PASSWORD} with secret: true), or run login on a computer with a screen and copy the session file.",
    );
  }
  const file = path.resolve(out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const browser = await launchBrowser({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  let saved = false;
  const save = async () => {
    try {
      const state = await context.storageState();
      fs.writeFileSync(`${file}.part`, JSON.stringify(state, null, 2), { mode: 0o600 });
      fs.renameSync(`${file}.part`, file);
      saved = true;
    } catch {
      /* the window is closing: keep the last saved state */
    }
  };

  // Watch for the end before anything else, so a window closed early still ends the command.
  let rl: readline.Interface | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const done = () => {
    rl?.close();
    finish();
  };
  // Enter in the terminal, when there is a person at it.
  if (process.stdin.isTTY) {
    rl = readline.createInterface({ input: process.stdin });
    rl.once("line", done);
  }
  // Closing the window: on macOS the browser keeps running with no window, so watch the pages too.
  browser.once("disconnected", done);
  context.on("close", done);
  const watch = (p: typeof page) => {
    // Save as soon as a page loads (the check passed, the sign-in redirected), not only on the timer.
    p.on("load", () => void save());
    p.once("close", () => {
      if (context.pages().length === 0) done();
    });
  };
  watch(page);
  context.on("page", watch);
  process.once("SIGINT", done);
  process.once("SIGTERM", done);

  await page.goto(url).catch(() => {});
  log("In the browser window: sign in, or pass the check if the site asks for one. Then close the window (or press Enter here).");
  await save();
  const poll = setInterval(save, 2000);
  if (context.pages().length === 0) done();
  await finished;
  clearInterval(poll);
  await save();
  await browser.close().catch(() => {});
  if (!saved || !fs.existsSync(file)) throw new Error("No session was captured.");
  return file;
}

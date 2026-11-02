import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { launchBrowser } from "./drivers/browser.js";

/** Open a visible browser on `url`, let a person sign in, and save the session for scenarios (`auth.storageState`). */
export async function login(url: string, out: string, log: (msg: string) => void = () => {}): Promise<string> {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error(
      "`screenplay login` opens a visible browser, and this machine has no screen. Log in with steps in the scenario instead (type ${EMAIL} / ${PASSWORD} with secret: true), or run login on a computer with a screen and copy the session file.",
    );
  }
  const file = path.resolve(out);
  const browser = await launchBrowser({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(url);
  log(`Sign in in the browser window, then press Enter here (or close the window).`);
  let last: Awaited<ReturnType<typeof context.storageState>> | undefined;
  const poll = setInterval(async () => {
    try {
      last = await context.storageState();
    } catch {
      /* closing */
    }
  }, 1500);
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once("line", () => {
      rl.close();
      resolve();
    });
    browser.once("disconnected", () => {
      rl.close();
      resolve();
    });
  });
  clearInterval(poll);
  try {
    last = await context.storageState();
  } catch {
    /* the window was closed: keep the last saved state */
  }
  await browser.close().catch(() => {});
  if (!last) throw new Error("No session was captured.");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(last, null, 2), { mode: 0o600 });
  return file;
}

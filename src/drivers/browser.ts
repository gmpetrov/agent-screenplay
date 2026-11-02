import fs from "node:fs";
import { chromium, type Browser } from "playwright-core";

export class BrowserNotFoundError extends Error {
  constructor() {
    super(
      "No Chromium found for Screenplay. Run `npx agent-screenplay init` (or `npx playwright install chromium`), or set SCREENPLAY_CHROME to a Chrome/Chromium executable.",
    );
  }
}

/** Launch Chromium: SCREENPLAY_CHROME, then Playwright's Chromium, then an installed Google Chrome. */
export async function launchBrowser(opts: { headless?: boolean } = {}): Promise<Browser> {
  const headless = opts.headless ?? true;
  const args = ["--hide-scrollbars", "--disable-features=Translate", "--force-color-profile=srgb"];
  const explicit = process.env.SCREENPLAY_CHROME;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`SCREENPLAY_CHROME points to a missing file: ${explicit}`);
    return chromium.launch({ headless, executablePath: explicit, args });
  }
  const attempts: Array<() => Promise<Browser>> = [
    // Full Chromium in new headless mode renders exactly like a headed browser.
    () => chromium.launch({ headless, channel: "chromium", args }),
    () => chromium.launch({ headless, args }),
    () => chromium.launch({ headless, channel: "chrome", args }),
  ];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      const msg = String((e as Error).message);
      if (!/Executable doesn't exist|executable|not found|ENOENT|Chromium distribution/i.test(msg)) throw e;
    }
  }
  throw new BrowserNotFoundError();
}

export function isChromiumInstalled(): boolean {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

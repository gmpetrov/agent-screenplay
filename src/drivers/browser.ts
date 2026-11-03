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
  // Without the automation flag, pages see an ordinary browser (navigator.webdriver is false).
  const args = ["--hide-scrollbars", "--disable-features=Translate", "--force-color-profile=srgb", "--disable-blink-features=AutomationControlled"];
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

const userAgents = new WeakMap<Browser, string>();

/**
 * The browser's user agent as a visible Chrome would send it. Headless Chromium announces itself
 * as "HeadlessChrome", which bot checks such as Cloudflare's stop at once; the same browser with
 * the ordinary name passes the checks that need no person (jeuxvideo.com, for one), and keeps a
 * session saved by `login` (a visible browser) valid.
 */
export async function realUserAgent(browser: Browser): Promise<string> {
  const cached = userAgents.get(browser);
  if (cached) return cached;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const ua = (await page.evaluate(() => navigator.userAgent)).replace(/HeadlessChrome/g, "Chrome");
    userAgents.set(browser, ua);
    return ua;
  } finally {
    await context.close();
  }
}

/**
 * A bot check that blocks the page (Cloudflare's "Just a moment…"), or undefined. Only a page
 * that is the check itself counts: a Turnstile widget inside a usable page (a contact or sign-up
 * form) does not block anything.
 */
export async function botCheck(page: import("playwright-core").Page): Promise<string | undefined> {
  const title = await page.title().catch(() => "");
  if (/^(just a moment|un instant|attention required|checking your browser|verify you are human)/i.test(title)) return title;
  const blocked = await page
    .evaluate(() => {
      // Cloudflare's interstitial page.
      if (document.querySelector("#challenge-form, #cf-challenge-running, #challenge-stage, #challenge-body-text")) return true;
      // A visible challenge frame on a page with almost nothing else to read.
      const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src*="challenges.cloudflare.com"]')).find((f) => {
        const r = f.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(f).visibility !== "hidden";
      });
      return Boolean(frame) && (document.body?.innerText ?? "").trim().length < 200;
    })
    .catch(() => false);
  return blocked ? title || "Cloudflare check" : undefined;
}

export function isChromiumInstalled(): boolean {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

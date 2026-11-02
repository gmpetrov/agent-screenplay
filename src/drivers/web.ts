import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, CDPSession, Locator, Page } from "playwright-core";
import type { LoadedScenario } from "../scenario/load.js";
import { describeStep, stepKind, type Step } from "../scenario/schema.js";
import { parseTarget } from "../scenario/target.js";
import type { Box, Point, Take, TakeStep } from "../take.js";
import { launchBrowser } from "./browser.js";
import { cardDuration, travelDuration, typingDelays } from "./pace.js";

export interface WebRunOptions {
  mode: "record" | "check";
  /** Minimum duration of each step (seconds), from narration. */
  minDurations?: number[];
  log?: (msg: string) => void;
}

export interface CheckStepResult {
  index: number;
  step: string;
  ok: boolean;
  error?: string;
  /** Visible elements an agent could target instead, when a target was not found. */
  candidates?: string[];
}

export interface CheckReport {
  ok: boolean;
  steps: CheckStepResult[];
  /** Screenshot of the page where the check stopped. */
  screenshot?: string;
  url?: string;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const ACTION_TIMEOUT_MS = 15_000;

export class StepError extends Error {
  constructor(
    public index: number,
    public step: string,
    message: string,
    public candidates?: string[],
  ) {
    super(`Step ${index + 1} (${step}) failed: ${message}`);
  }
}

export async function runWeb(loaded: LoadedScenario, opts: WebRunOptions): Promise<{ take?: Take; check?: CheckReport }> {
  const { scenario } = loaded;
  const record = opts.mode === "record";
  const log = opts.log ?? (() => {});
  const viewport = scenario.viewport ?? DEFAULT_VIEWPORT;
  const scale = record ? (scenario.scale ?? 2) : 1;
  const baseUrl = scenario.url!;

  const browser = await launchBrowser();
  let context: BrowserContext | undefined;
  const takeDir = loaded.takeDir;
  const framesDir = path.join(takeDir, "frames");
  if (record) {
    fs.rmSync(takeDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
  }

  try {
    const storageState = scenario.auth?.storageState ? path.resolve(loaded.dir, scenario.auth.storageState) : undefined;
    if (storageState && !fs.existsSync(storageState)) {
      throw new Error(`Session file not found: ${storageState}. Run \`screenplay login <url>\` to create it.`);
    }
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      colorScheme: scenario.colorScheme,
      locale: scenario.locale,
      storageState,
    });
    if (scenario.hideScrollbars !== false) {
      await context.addInitScript(() => {
        const css = "::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}";
        const add = () => {
          const style = document.createElement("style");
          style.setAttribute("data-screenplay", "");
          style.textContent = css;
          (document.head ?? document.documentElement).appendChild(style);
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
        else add();
      });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);

    log(`Opening ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: "load", timeout: 60_000 });
    await settle(page);

    // ---- capture -------------------------------------------------------
    const t0 = Date.now() / 1000;
    const now = () => Date.now() / 1000 - t0;
    const frames: Array<[number, string]> = [];
    let cdp: CDPSession | undefined;
    const writes: Promise<void>[] = [];
    let firstFrame: Promise<void> | undefined;
    if (record) {
      cdp = await context.newCDPSession(page);
      let frameNo = 0;
      let resolveFirst!: () => void;
      firstFrame = new Promise<void>((r) => (resolveFirst = r));
      cdp.on("Page.screencastFrame", (ev: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
        const t = (ev.metadata.timestamp ?? Date.now() / 1000) - t0;
        const name = `f${String(++frameNo).padStart(6, "0")}.jpg`;
        frames.push([Math.max(0, t), name]);
        writes.push(fs.promises.writeFile(path.join(framesDir, name), Buffer.from(ev.data, "base64")));
        cdp!.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
        resolveFirst();
      });
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 92,
        maxWidth: Math.round(viewport.width * scale),
        maxHeight: Math.round(viewport.height * scale),
        everyNthFrame: 1,
      });
      // Nudge the compositor so a static page still produces its first frame.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      await Promise.race([firstFrame, sleep(3000)]);
    }

    const sleepIf = (s: number) => (record && s > 0 ? sleep(s * 1000) : Promise.resolve());
    let navigated = false;
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) navigated = true;
    });

    let cursor: Point = { x: viewport.width * 0.62, y: viewport.height * 0.7 };
    const cursorStart = { ...cursor };
    const steps: TakeStep[] = [];
    const checks: CheckStepResult[] = [];
    await sleepIf(0.6);

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const kind = stepKind(step);
      const label = describeStep(step);
      log(`${record ? "▶" : "✓?"} ${i + 1}/${scenario.steps.length} ${label}`);
      navigated = false;
      const ts: TakeStep = { index: i, kind, label, start: now(), end: 0, waits: [] };
      const minDuration = opts.minDurations?.[i] ?? 0;
      try {
        cursor = await runStep(page, step, ts, cursor, {
          record,
          now,
          baseUrl,
          sleepIf,
          minDuration,
          typingSpeed: scenario.typingSpeed ?? 1,
          seed: i + 1,
        });
      } catch (e) {
        const err = e instanceof StepError ? e : new StepError(i, label, (e as Error).message);
        if (!record) {
          checks.push({ index: i, step: label, ok: false, error: err.message, candidates: err.candidates });
          const shot = path.join(loaded.workDir, "check-failed.png");
          fs.mkdirSync(loaded.workDir, { recursive: true });
          await page.screenshot({ path: shot }).catch(() => {});
          for (let j = i + 1; j < scenario.steps.length; j++) {
            checks.push({ index: j, step: describeStep(scenario.steps[j]), ok: false, error: "not reached" });
          }
          return { check: { ok: false, steps: checks, screenshot: shot, url: page.url() } };
        }
        throw err;
      }
      if (navigated) ts.navigated = true;
      if (!ts.card && record) {
        // Let the result of the action show, and give the narration time to finish.
        const hold = ("hold" in step && step.hold ? step.hold : 0) + (isAction(kind) ? 0.7 : 0.2);
        await sleepIf(hold);
        const elapsed = now() - ts.start;
        if (elapsed < minDuration) await sleepIf(minDuration - elapsed);
      }
      ts.end = ts.card ? ts.start : now();
      steps.push(ts);
      checks.push({ index: i, step: label, ok: true });
    }

    if (!record) return { check: { ok: true, steps: checks, url: page.url() } };

    await sleepIf(1.0);
    const duration = now();
    await cdp!.send("Page.stopScreencast").catch(() => {});
    await Promise.all(writes);
    frames.sort((a, b) => a[0] - b[0]);
    if (frames.length === 0) throw new Error("The browser produced no frames. Is the page blank?");

    const take: Take = {
      version: 1,
      name: loaded.name,
      recordedAt: new Date().toISOString(),
      platform: process.platform,
      target: { kind: "web", url: baseUrl },
      width: viewport.width,
      height: viewport.height,
      scale,
      duration,
      cursorStart,
      source: { kind: "frames", dir: "frames", frames },
      steps,
    };
    return { take };
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function isAction(kind: string): boolean {
  return ["click", "type", "press", "hover", "select", "scroll", "goto"].includes(kind);
}

interface StepCtx {
  record: boolean;
  now: () => number;
  baseUrl: string;
  sleepIf: (s: number) => Promise<void>;
  minDuration: number;
  typingSpeed: number;
  seed: number;
}

async function runStep(page: Page, step: Step, ts: TakeStep, cursor: Point, ctx: StepCtx): Promise<Point> {
  const { now, sleepIf, record } = ctx;

  const travelTo = async (box: Box, target?: Point): Promise<Point> => {
    const point = target ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    ts.travelStart = now();
    await sleepIf(travelDuration(cursor, point));
    await page.mouse.move(point.x, point.y);
    ts.point = point;
    ts.box = box;
    return point;
  };

  const resolve = async (target: string): Promise<{ locator?: Locator; box: Box; point?: Point }> => {
    const parsed = parseTarget(target);
    if (parsed.kind === "at") {
      return { box: { x: parsed.x - 12, y: parsed.y - 12, width: 24, height: 24 }, point: { x: parsed.x, y: parsed.y } };
    }
    const waitStart = now();
    const locator = await findLocator(page, target, ts.index);
    const waited = now() - waitStart;
    if (waited > 0.4) ts.waits.push([waitStart, now()]);
    // Bring it into view smoothly when it is off screen.
    const inView = await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
    });
    if (!inView) {
      const s0 = now();
      await locator.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }));
      await (record ? sleep(750) : sleep(50));
      (ts.scrolls ??= []).push([s0, now()]);
    }
    const bb = await locator.boundingBox();
    if (!bb) throw new StepError(ts.index, ts.label, `"${target}" is not visible.`);
    return { locator, box: bb };
  };

  const s = step as Record<string, any>;
  switch (ts.kind) {
    case "title":
    case "end": {
      ts.card = {
        kind: ts.kind,
        title: s[ts.kind],
        subtitle: s.subtitle,
        duration: Math.max(s.duration ?? cardDuration(s[ts.kind], s.subtitle), ctx.minDuration),
      };
      return cursor;
    }
    case "goto": {
      const url = new URL(s.goto, ctx.baseUrl).toString();
      const w0 = now();
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      await settle(page);
      ts.waits.push([w0, now()]);
      return cursor;
    }
    case "click": {
      const { box, point } = await resolve(s.click);
      const p = await travelTo(box, point);
      ts.actionAt = now();
      await page.mouse.click(p.x, p.y, { button: s.button ?? "left", clickCount: s.double ? 2 : 1 });
      await settleAfterAction(page, ts, now, record);
      return p;
    }
    case "hover": {
      const { box, point } = await resolve(s.hover);
      const p = await travelTo(box, point);
      ts.actionAt = now();
      return p;
    }
    case "select": {
      const { locator, box, point } = await resolve(s.select);
      const p = await travelTo(box, point);
      ts.actionAt = now();
      if (!locator) throw new StepError(ts.index, ts.label, "select needs an element, not coordinates.");
      await locator.selectOption({ label: s.option }).catch(() => locator.selectOption(s.option));
      return p;
    }
    case "type": {
      let p = cursor;
      if (s.into) {
        const { locator, box, point } = await resolve(s.into);
        p = await travelTo(box, point ?? { x: box.x + Math.min(box.width / 2, 48), y: box.y + box.height / 2 });
        ts.actionAt = now();
        await page.mouse.click(p.x, p.y);
        if (s.clear && locator) await locator.fill("");
        await sleepIf(0.15);
      } else {
        ts.actionAt = now();
      }
      const text: string = s.type;
      ts.typed = s.secret ? "•".repeat(text.length) : text;
      if (record) {
        const delays = typingDelays(text, ctx.typingSpeed, ctx.seed);
        for (let k = 0; k < text.length; k++) {
          await page.keyboard.type(text[k]);
          await sleep(delays[k] * 1000);
        }
      } else {
        await page.keyboard.type(text);
      }
      ts.actionEnd = now();
      if (s.submit) {
        await sleepIf(0.25);
        await page.keyboard.press("Enter");
        await settleAfterAction(page, ts, now, record);
      }
      return p;
    }
    case "press": {
      ts.actionAt = now();
      await page.keyboard.press(s.press);
      await settleAfterAction(page, ts, now, record);
      return cursor;
    }
    case "scroll": {
      const v = s.scroll as string;
      if (["down", "up", "top", "bottom"].includes(v)) {
        const s0 = now();
        const vh = page.viewportSize()?.height ?? 900;
        const delta = v === "down" ? vh * 0.75 : v === "up" ? -vh * 0.75 : v === "top" ? -1e6 : 1e6;
        await page.mouse.move(cursor.x, cursor.y);
        if (record && Math.abs(delta) < 1e5) {
          const n = 18;
          for (let k = 0; k < n; k++) {
            const e0 = easeInOut(k / n);
            const e1 = easeInOut((k + 1) / n);
            await page.mouse.wheel(0, delta * (e1 - e0));
            await sleep(32);
          }
        } else {
          await page.mouse.wheel(0, delta);
        }
        await sleepIf(0.3);
        (ts.scrolls ??= []).push([s0, now()]);
        return cursor;
      }
      await resolve(v);
      return cursor;
    }
    case "wait": {
      const w0 = now();
      if (typeof s.wait === "number") {
        await sleepIf(s.wait);
      } else {
        const timeout = (s.timeout ?? 30) * 1000;
        await findLocator(page, s.wait, ts.index, timeout);
      }
      ts.waits.push([w0, now()]);
      return cursor;
    }
    case "pause": {
      await sleepIf(s.pause);
      return cursor;
    }
    case "callout":
    case "highlight":
    case "zoomTo": {
      const { box } = await resolve(s[ts.kind]);
      ts.box = box;
      ts.actionAt = now();
      const d = Math.max(s.duration ?? (ts.kind === "zoomTo" ? 2 : 3), ctx.minDuration);
      await sleepIf(d);
      return cursor;
    }
  }
  return cursor;
}

/** After a click or a key: wait for a navigation or network burst, and mark the time as waiting. */
async function settleAfterAction(page: Page, ts: TakeStep, now: () => number, record: boolean) {
  const w0 = now();
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: record ? 4_000 : 1_500 }).catch(() => {});
  const waited = now() - w0;
  if (waited > 0.6) ts.waits.push([w0, now()]);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(250);
}

/** Find a visible element for a target, trying exact matches first. */
export async function findLocator(page: Page, target: string, index: number, timeout = ACTION_TIMEOUT_MS): Promise<Locator> {
  const parsed = parseTarget(target);
  const candidates: Locator[] = [];
  switch (parsed.kind) {
    case "text":
      candidates.push(page.getByText(parsed.text, { exact: true }), page.getByText(parsed.text));
      break;
    case "role":
      if (parsed.name !== undefined) {
        candidates.push(
          page.getByRole(parsed.role as any, { name: parsed.name, exact: true }),
          page.getByRole(parsed.role as any, { name: parsed.name }),
        );
      } else candidates.push(page.getByRole(parsed.role as any));
      break;
    case "label":
      candidates.push(page.getByLabel(parsed.text, { exact: true }), page.getByLabel(parsed.text));
      break;
    case "placeholder":
      candidates.push(page.getByPlaceholder(parsed.text, { exact: true }), page.getByPlaceholder(parsed.text));
      break;
    case "testid":
      candidates.push(page.getByTestId(parsed.id));
      break;
    case "css":
      candidates.push(page.locator(parsed.selector));
      break;
    case "at":
      throw new Error("Coordinates have no element.");
  }
  const deadline = Date.now() + timeout;
  while (true) {
    for (const c of candidates) {
      const visible = c.filter({ visible: true });
      if ((await visible.count()) > 0) return visible.first();
    }
    if (Date.now() > deadline) break;
    await sleep(150);
  }
  throw new StepError(index, target, `nothing visible matches "${target}".`, await listCandidates(page));
}

/** Visible interactive elements, as targets an agent can copy. */
async function listCandidates(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const out: string[] = [];
      const seen = new Set<string>();
      const els = document.querySelectorAll<HTMLElement>(
        "button, a[href], input, textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch]",
      );
      for (const el of Array.from(els)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        const tag = el.tagName.toLowerCase();
        const role =
          el.getAttribute("role") ??
          (tag === "a" ? "link" : tag === "button" ? "button" : tag === "select" ? "combobox" : "textbox");
        const label =
          el.getAttribute("aria-label") ??
          (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ??
          el.getAttribute("placeholder") ??
          el.textContent?.trim() ??
          "";
        const name = label.replace(/\s+/g, " ").slice(0, 60);
        if (!name) continue;
        const t = `role=${role}[name='${name.replace(/'/g, "\\'")}']`;
        if (!seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
        if (out.length >= 40) break;
      }
      return out;
    })
    .catch(() => []);
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

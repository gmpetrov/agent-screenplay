import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import type { LoadedScenario } from "../scenario/load.js";
import { describeStep, stepKind, SURFACES, type Step } from "../scenario/schema.js";
import { parseTarget } from "../scenario/target.js";
import type { Box, Point, Take, TakeStep } from "../take.js";
import { captureFfmpegPath } from "../ffmpeg.js";
import { cardDuration, travelDuration, typingDelays } from "./pace.js";
import { showIndicator, type Indicator } from "./indicator.js";
import { StepError, sleep, type CheckReport, type CheckStepResult } from "./web.js";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * Desktop apps: agent-desktop plays the steps through the OS accessibility
 * APIs (no real pointer moves), ffmpeg films the window without the system
 * cursor, and the shared editing step draws the cursor and zooms.
 */

export interface DesktopRunOptions {
  mode: "record";
  minDurations?: number[];
  log?: (msg: string) => void;
}

interface Envelope<T = any> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

interface Win {
  id: string;
  title: string;
  app_name: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export class AgentDesktop {
  private bin: string;
  private session?: string;

  constructor() {
    this.bin = AgentDesktop.locate();
  }

  static locate(): string {
    if (process.env.SCREENPLAY_AGENT_DESKTOP) return process.env.SCREENPLAY_AGENT_DESKTOP;
    try {
      const pkg = require.resolve("agent-desktop/package.json");
      const dir = path.dirname(pkg);
      const meta = JSON.parse(fs.readFileSync(pkg, "utf8")) as { bin?: string | Record<string, string> };
      const rel = typeof meta.bin === "string" ? meta.bin : meta.bin?.["agent-desktop"];
      if (rel) return path.join(dir, rel);
    } catch {
      /* not installed as a dependency */
    }
    const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["agent-desktop"], { encoding: "utf8" });
    if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim();
    throw new Error("Desktop recording needs agent-desktop: run `npm install -g agent-desktop` (https://github.com/vercel-labs/agent-desktop).");
  }

  async call<T = any>(args: string[], opts: { allowFail?: boolean } = {}): Promise<Envelope<T>> {
    const env = { ...process.env, ...(this.session ? { AGENT_DESKTOP_SESSION: this.session } : {}) };
    const isJs = this.bin.endsWith(".js");
    const cmd = isJs ? process.execPath : this.bin;
    const argv = isJs ? [this.bin, ...args] : args;
    let stdout = "";
    try {
      const r = await run(cmd, argv, { env, maxBuffer: 32 * 1024 * 1024 });
      stdout = r.stdout;
    } catch (e) {
      stdout = (e as { stdout?: string }).stdout ?? "";
      if (!stdout) throw new Error(`agent-desktop ${args[0]} failed: ${(e as Error).message}`);
    }
    const env2 = JSON.parse(stdout.trim().split("\n").pop() || "{}") as Envelope<T>;
    if (!env2.ok && !opts.allowFail) {
      throw new Error(`agent-desktop ${args[0]}: ${env2.error?.code ?? "ERROR"} ${env2.error?.message ?? ""}`.trim());
    }
    return env2;
  }

  async startSession() {
    const r = await this.call<{ session_id: string }>(["session", "start", "--name", "screenplay", "--no-trace"]);
    this.session = r.data!.session_id;
  }

  async endSession() {
    if (this.session) await this.call(["session", "end", this.session], { allowFail: true }).catch(() => {});
  }
}

/** The role/name part of an `agent-desktop find` query for a scenario target. */
export function findQuery(target: string): string[] {
  const t = parseTarget(target);
  switch (t.kind) {
    case "role":
      return ["--role", t.role, ...(t.name ? ["--name", t.name, "--exact"] : []), "--first"];
    case "text":
      return ["--name", t.text, "--first"];
    case "label":
    case "placeholder":
      return ["--name", t.text, "--first"];
    case "testid":
      return ["--name", t.id, "--first"];
    case "css":
      throw new Error(`css= targets work on websites only, not in desktop apps ("${target}").`);
    case "at":
      throw new Error("Coordinates have no element.");
  }
}

/**
 * Translate a scenario target into `agent-desktop find` arguments. With a window id, the search
 * stays in that window, so another window of the same app is never clicked or typed into.
 */
export function findArgs(app: string, target: string, windowId?: string): string[] {
  return ["find", "--app", app, ...(windowId ? ["--window-id", windowId] : []), ...findQuery(target)];
}

interface Resolved {
  ref?: string;
  /** Box in the filmed area's coordinates. */
  box: Box;
}

type Surface = (typeof SURFACES)[number];

/** Where a step acts: an app (default: the current one) and a surface (default: its front window). */
export interface Where {
  app?: string;
  surface?: Surface;
}

type Bounds = Win["bounds"];

interface Display {
  bounds: Bounds;
  scale: number;
  is_primary: boolean;
}

class DesktopSession {
  ad = new AgentDesktop();
  /** The app steps act in when they name none. With `screen`, `open` and a step's `app` change it. */
  app?: string;
  /** The filmed area in screen coordinates: the app's window, or the whole main display. */
  frame!: Bounds;
  /** Window recordings: the filmed window. */
  win?: Win;
  scale = 1;

  constructor(
    app: string | undefined,
    readonly screen: boolean,
  ) {
    this.app = app;
  }

  async open(log: (m: string) => void, opts: { hideOthers?: boolean } = {}) {
    if (process.platform === "linux" && !process.env.DISPLAY) {
      throw new Error(
        process.env.WAYLAND_DISPLAY
          ? "Desktop recording on Linux needs an X11 session (Wayland blocks screen capture and input by design). Log in with an X11 session, or record a website instead."
          : "No display: desktop recording needs a graphical session (DISPLAY is not set).",
      );
    }
    await this.ad.startSession();
    if (this.app) await this.activate(this.app, log);
    const displays = (await this.ad.call<Display[]>(["list-displays"])).data ?? [];
    if (this.screen) {
      const disp = displays.find((d) => d.is_primary) ?? displays[0];
      if (!disp) throw new Error("No display found to film.");
      this.frame = disp.bounds;
      this.scale = disp.scale ?? 1;
      if (opts.hideOthers) {
        if (process.platform !== "darwin") log("hideOthers works on macOS only: other windows stay visible.");
        else if (!this.app) throw new Error('hideOthers needs `app`: the app to keep (Hide Others is run from it).');
        else {
          await this.ad.call(["press", "--app", this.app, "cmd+alt+h"]);
          await sleep(500);
        }
      }
    } else {
      this.win = await this.frontWindow(this.app!);
      this.frame = this.win.bounds;
      const b = this.frame;
      const disp = displays.find((d) => b.x >= d.bounds.x && b.x < d.bounds.x + d.bounds.width) ?? displays[0];
      this.scale = disp?.scale ?? 1;
    }
  }

  /** Launch the app, or bring it to the front; it becomes the app the next steps act in. */
  async activate(app: string, log: (m: string) => void) {
    const apps = await this.ad.call<{ apps: Array<{ name: string }> }>(["list-apps"]);
    const match = apps.data!.apps.find((a) => a.name.toLowerCase() === app.toLowerCase());
    if (!match) {
      log(`Launching ${app}`);
      await this.ad.call(["launch", app, "--activate"]);
      await sleep(1500);
      this.app = app;
    } else this.app = match.name;
    const win = await this.frontWindow(this.app).catch(() => undefined);
    if (win) await this.ad.call(["--headed", "focus-window", "--window-id", win.id], { allowFail: true });
    else if (match) await this.ad.call(["launch", this.app, "--activate"], { allowFail: true });
  }

  async frontWindow(app: string): Promise<Win> {
    const wins = await this.ad.call<Win[]>(["list-windows", "--app", app]);
    const list = (wins.data ?? []).filter((w) => {
      const f = w as unknown as { visible?: boolean; minimized?: boolean };
      return f.visible !== false && !f.minimized;
    });
    if (!list.length) throw new Error(`${app} has no visible window.`);
    return list.find((w) => (w as unknown as { is_focused?: boolean }).is_focused) ?? list[0];
  }

  /** The app a step acts in. */
  appFor(where: Where): string {
    const app = where.app ?? this.app;
    if (!app) throw new Error('Name the app this step acts in: add "app" to the step, or "open" it first.');
    if (!this.screen && app.toLowerCase() !== this.app!.toLowerCase()) {
      throw new Error(`This recording films ${this.app}'s window only. To act in ${app} too, film the whole screen with "screen": true.`);
    }
    return app;
  }

  /** `find` arguments that limit the search to where the step acts. */
  async scope(where: Where): Promise<string[]> {
    const app = this.appFor(where);
    const surface = where.surface ?? "window";
    if (surface !== "window") return ["--app", app, "--surface", surface];
    const id = this.screen ? (await this.frontWindow(app)).id : this.win!.id;
    return ["--app", app, "--window-id", id];
  }

  async resolve(target: string, where: Where = {}, timeoutMs = 15_000): Promise<Resolved> {
    const t = parseTarget(target);
    if (t.kind === "at") return { box: { x: t.x - 12, y: t.y - 12, width: 24, height: 24 } };
    const query = findQuery(target);
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (true) {
      let r: Envelope<{ match?: { ref_id: string | null; bounds?: Bounds } }>;
      try {
        r = await this.ad.call(["find", ...(await this.scope(where)), ...query], { allowFail: true });
      } catch (e) {
        // The app may still be opening its window.
        if (!/has no visible window/.test((e as Error).message) || Date.now() > deadline) throw e;
        await sleep(250);
        continue;
      }
      const m = r.ok ? r.data?.match : undefined;
      if (m) {
        let b = m.bounds;
        if (m.ref_id) {
          const g = await this.ad.call<{ value: Bounds | null }>(["get", m.ref_id, "--property", "bounds"], { allowFail: true });
          b = g.data?.value ?? b;
        }
        if (b) {
          return {
            ref: m.ref_id ?? undefined,
            box: { x: b.x - this.frame.x, y: b.y - this.frame.y, width: b.width, height: b.height },
          };
        }
      }
      last = r.error?.message ?? "not found";
      if (Date.now() > deadline) break;
      await sleep(250);
    }
    const app = this.appFor(where);
    const place = where.surface && where.surface !== "window" ? `${app}'s ${where.surface}` : app;
    throw new StepError(-1, target, `nothing in ${place} matches "${target}" (${last}).`, await this.candidates(where));
  }

  async candidates(where: Where = {}): Promise<string[]> {
    const out: string[] = [];
    const scope = await this.scope(where).catch(() => undefined);
    if (!scope) return out;
    for (const role of ["button", "textfield", "link", "checkbox", "tab", "menuitem"]) {
      const r = await this.ad.call<{ matches?: Array<{ name?: string; role: string }> }>(["find", ...scope, "--role", role, "--limit", "15"], {
        allowFail: true,
      });
      for (const m of r.data?.matches ?? []) if (m.name) out.push(`role=${m.role}[name='${m.name.replace(/'/g, "\\'")}']`);
    }
    return out.slice(0, 40);
  }

  async clickAt(res: Resolved, opts: { double?: boolean; right?: boolean } = {}) {
    if (res.ref) {
      const cmd = opts.right ? "right-click" : opts.double ? "double-click" : "click";
      const headed = cmd === "double-click" || cmd === "right-click" ? ["--headed"] : [];
      const r = await this.ad.call([...headed, cmd, res.ref], { allowFail: !headed.length });
      // Some elements (a text area on macOS) have no click action: click them with the real pointer.
      // The system cursor is not filmed, so this does not show in the video.
      if (!r.ok) {
        if (r.error?.code !== "POLICY_DENIED") throw new Error(`agent-desktop ${cmd}: ${r.error?.code ?? "ERROR"} ${r.error?.message ?? ""}`.trim());
        await this.ad.call(["--headed", cmd, res.ref]);
      }
    } else {
      const x = Math.round(this.frame.x + res.box.x + res.box.width / 2);
      const y = Math.round(this.frame.y + res.box.y + res.box.height / 2);
      await this.ad.call(["--headed", "mouse-click", "--xy", `${x},${y}`]);
    }
  }

  async press(combo: string, where: Where = {}) {
    await this.ad.call(["press", "--app", this.appFor(where), normalizeCombo(combo)]);
  }
}

export function normalizeCombo(combo: string): string {
  const mac = process.platform === "darwin";
  return combo
    .split("+")
    .map((k) => {
      const l = k.trim().toLowerCase();
      if (l === "meta" || l === "command" || l === "cmd") return mac ? "cmd" : "super";
      if (l === "control") return "ctrl";
      if (l === "enter") return "return";
      if (l === "esc") return "escape";
      if (l === " ") return "space";
      return l;
    })
    .join("+");
}

/** Films a screen region with ffmpeg, without the system cursor. */
class Recorder {
  private proc?: ChildProcessWithoutNullStreams;
  startedAt = 0;
  readonly fps = 30;
  crop = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private file: string) {}

  async start(area: Bounds, scale: number, t0: number) {
    const bin = captureFfmpegPath();
    const W = Math.round(area.width * scale) & ~1;
    const H = Math.round(area.height * scale) & ~1;
    let input: string[];
    if (process.platform === "linux") {
      const x = Math.round(area.x * scale);
      const y = Math.round(area.y * scale);
      input = ["-f", "x11grab", "-draw_mouse", "0", "-framerate", String(this.fps), "-video_size", `${W}x${H}`, "-i", `${process.env.DISPLAY}+${x},${y}`];
      this.crop = { x: 0, y: 0, width: W, height: H };
    } else if (process.platform === "win32") {
      input = [
        "-f",
        "gdigrab",
        "-draw_mouse",
        "0",
        "-framerate",
        String(this.fps),
        "-offset_x",
        String(Math.round(area.x * scale)),
        "-offset_y",
        String(Math.round(area.y * scale)),
        "-video_size",
        `${W}x${H}`,
        "-i",
        "desktop",
      ];
      this.crop = { x: 0, y: 0, width: W, height: H };
    } else if (process.platform === "darwin") {
      const screen = macScreenIndex(bin);
      input = ["-f", "avfoundation", "-capture_cursor", "0", "-framerate", String(this.fps), "-i", `${screen}:none`];
      this.crop = { x: Math.round(area.x * scale), y: Math.round(area.y * scale), width: W, height: H };
    } else {
      throw new Error(`Desktop recording is not supported on ${process.platform}.`);
    }
    this.proc = spawn(bin, ["-hide_banner", "-y", ...input, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv444p", this.file]);
    let err = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Screen capture did not start: ${err.slice(-800)}`)), 10_000);
      this.proc!.stderr.on("data", (d: Buffer) => {
        err += d.toString();
        if (!this.startedAt && /frame=\s*\d+/.test(err)) {
          // ffmpeg prints its first progress line about half a second after the first frame.
          this.startedAt = Date.now() / 1000 - t0 - 0.5;
          clearTimeout(timer);
          resolve();
        }
      });
      this.proc!.on("close", (code) => {
        clearTimeout(timer);
        if (!this.startedAt) reject(new Error(`Screen capture failed (${code}): ${err.slice(-800)}`));
      });
    });
    if (process.platform === "darwin" && /permission|not authorized|denied/i.test(err)) {
      throw new Error("macOS refused screen capture: allow your terminal in System Settings → Privacy & Security → Screen Recording.");
    }
  }

  async stop() {
    if (!this.proc) return;
    const p = this.proc;
    await new Promise<void>((resolve) => {
      p.on("close", () => resolve());
      p.stdin.write("q");
      setTimeout(() => p.kill("SIGINT"), 5000);
    });
  }
}

function macScreenIndex(bin: string): string {
  const r = spawnSync(bin, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""], { encoding: "utf8" });
  const m = /\[(\d+)\] Capture screen 0/.exec(r.stderr ?? "");
  return m ? m[1] : "1";
}

export async function runDesktop(loaded: LoadedScenario, opts: DesktopRunOptions): Promise<Take> {
  const res = await play(loaded, { record: true, minDurations: opts.minDurations, log: opts.log ?? (() => {}) });
  return res.take!;
}

export async function checkDesktop(loaded: LoadedScenario, opts: { log?: (msg: string) => void }): Promise<CheckReport> {
  const res = await play(loaded, { record: false, log: opts.log ?? (() => {}) });
  return res.check!;
}

async function play(
  loaded: LoadedScenario,
  opts: { record: boolean; minDurations?: number[]; log: (m: string) => void },
): Promise<{ take?: Take; check?: CheckReport }> {
  const { scenario } = loaded;
  const record = opts.record;
  const ds = new DesktopSession(scenario.app, Boolean(scenario.screen));
  const takeDir = loaded.takeDir;
  if (record) {
    fs.rmSync(takeDir, { recursive: true, force: true });
    fs.mkdirSync(takeDir, { recursive: true });
  }
  const t0 = Date.now() / 1000;
  const now = () => Date.now() / 1000 - t0;
  // Stop on the pill ends the run: waits end at once, and the next step does not start.
  let stopped = false;
  let onStop!: () => void;
  const stopSignal = new Promise<void>((r) => (onStop = r));
  const stopIfAsked = () => {
    if (stopped) throw new Error("Stopped: the person at the computer pressed Stop on the Screenplay pill. Nothing was recorded.");
  };
  const sleepIf = (s: number) => (record && s > 0 ? Promise.race([sleep(s * 1000), stopSignal]) : Promise.resolve());
  let recorder: Recorder | undefined;
  let pill: Indicator | undefined;
  const checks: CheckStepResult[] = [];
  try {
    await ds.open(opts.log, { hideOthers: scenario.hideOthers });
    if (ds.screen && record) opts.log("Filming the whole screen: notifications and every visible window will be in the video.");
    pill = showIndicator(record ? "Screenplay is recording" : "Screenplay is rehearsing", () => {
      stopped = true;
      onStop();
    });
    const W = ds.frame.width;
    const H = ds.frame.height;
    if (record) {
      recorder = new Recorder(path.join(takeDir, "capture.mp4"));
      await recorder.start(ds.frame, ds.scale, t0);
      await sleep(600);
    }
    let cursor: Point = { x: W * 0.62, y: H * 0.7 };
    const cursorStart = { ...cursor };
    let lastField: string | undefined;
    const steps: TakeStep[] = [];

    for (let i = 0; i < scenario.steps.length; i++) {
      stopIfAsked();
      const step = scenario.steps[i] as Step & Record<string, any>;
      const kind = stepKind(step);
      const label = describeStep(step);
      opts.log(`${record ? "▶" : "·"} ${i + 1}/${scenario.steps.length} ${label}`);
      const ts: TakeStep = { index: i, kind, label, start: now(), end: 0, waits: [] };
      const where: Where = { app: step.app, surface: step.surface };
      const minDuration = opts.minDurations?.[i] ?? 0;
      const travelTo = async (box: Box) => {
        const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        ts.travelStart = now();
        await sleepIf(travelDuration(cursor, p));
        ts.point = p;
        ts.box = box;
        cursor = p;
      };
      const resolve = async (target: string) => {
        const w0 = now();
        try {
          const r = await ds.resolve(target, where);
          if (now() - w0 > 0.5) ts.waits.push([w0, now()]);
          return r;
        } catch (e) {
          if (e instanceof StepError) throw new StepError(i, label, e.message.replace(/^Step 0 \(.*?\) failed: /, ""), e.candidates);
          throw e;
        }
      };
      try {
        // On a whole-screen recording, naming another app brings it to the front (an element of a
        // background app would be acted on out of sight) and makes it the one the next steps act in.
        if (ds.screen && step.app && step.app.toLowerCase() !== ds.app?.toLowerCase()) {
          const w0 = now();
          await ds.activate(step.app, opts.log);
          await sleepIf(0.6);
          ts.waits.push([w0, now()]);
          lastField = undefined; // the focused field belonged to the previous app
        }
        switch (kind) {
          case "title":
          case "end":
            ts.card = {
              kind,
              title: step[kind],
              subtitle: step.subtitle,
              duration: Math.max(step.duration ?? cardDuration(step[kind], step.subtitle), minDuration),
            };
            break;
          case "goto":
            throw new StepError(i, label, "goto works on websites only; desktop scenarios start with the app already open.");
          case "open": {
            if (!ds.screen) throw new StepError(i, label, 'open needs "screen": true: a window recording films one app.');
            const w0 = now();
            await ds.activate(step.open, opts.log);
            lastField = undefined; // the focused field belonged to the previous app
            await sleepIf(0.6); // let the window come to the front
            ts.waits.push([w0, now()]);
            break;
          }
          case "click":
          case "select": {
            const r = await resolve(step[kind]);
            await travelTo(r.box);
            ts.actionAt = now();
            if (kind === "select") {
              if (!r.ref) throw new StepError(i, label, "select needs an element.");
              await ds.ad.call(["select", r.ref, step.option]);
            } else await ds.clickAt(r, { double: step.double, right: step.button === "right" });
            if (r.ref && parseTarget(step[kind]).kind !== "at") lastField = r.ref;
            break;
          }
          case "hover": {
            // Hover moves the real pointer (menus and tooltips need it); it is not filmed, the drawn cursor is.
            const r = await resolve(step.hover);
            await travelTo(r.box);
            ts.actionAt = now();
            if (r.ref) await ds.ad.call(["--headed", "hover", r.ref]);
            else {
              const x = Math.round(ds.frame.x + r.box.x + r.box.width / 2);
              const y = Math.round(ds.frame.y + r.box.y + r.box.height / 2);
              await ds.ad.call(["--headed", "mouse-move", "--xy", `${x},${y}`]);
            }
            break;
          }
          case "type": {
            let ref = lastField;
            if (step.into) {
              const r = await resolve(step.into);
              await travelTo(r.box);
              ts.actionAt = now();
              await ds.clickAt(r);
              ref = r.ref;
              lastField = r.ref;
              if (step.clear && ref) await ds.ad.call(["clear", ref], { allowFail: true });
              await sleepIf(0.15);
            } else ts.actionAt = now();
            const text: string = step.type;
            ts.typed = step.secret ? "•".repeat(text.length) : text;
            const delays = typingDelays(text, scenario.typingSpeed ?? 1, i + 1);
            if (!record) {
              if (ref) await ds.ad.call(["type", ref, text]);
              else for (const ch of text) await ds.press(ch === " " ? "space" : ch, where);
            } else {
              // Type in small chunks so the text appears progressively, like a person typing.
              for (let k = 0; k < text.length; k++) {
                stopIfAsked();
                const ch = text[k];
                const t1 = Date.now();
                if (ref) await ds.ad.call(["type", ref, ch]);
                else await ds.press(ch === " " ? "space" : ch, where);
                const spent = (Date.now() - t1) / 1000;
                await sleepIf(Math.max(0, delays[k] - spent));
              }
            }
            ts.actionEnd = now();
            if (step.submit) {
              await sleepIf(0.25);
              await ds.press("return", where);
            }
            break;
          }
          case "press":
            ts.actionAt = now();
            await ds.press(step.press, where);
            break;
          case "scroll": {
            const v = step.scroll as string;
            const s0 = now();
            if (["down", "up"].includes(v)) {
              const r = await ds.ad.call<{ match?: { ref_id: string } }>(["find", ...(await ds.scope(where)), "--role", "scrollarea", "--first"], { allowFail: true });
              const ref = r.data?.match?.ref_id;
              if (!ref) throw new StepError(i, label, "no scrollable area found in the app.");
              await ds.ad.call(["scroll", ref, "--direction", v, "--amount", "5"]);
            } else if (["top", "bottom"].includes(v)) {
              await ds.press(v === "top" ? "home" : "end", where);
            } else {
              const r = await resolve(v);
              if (r.ref) await ds.ad.call(["scroll-to", r.ref], { allowFail: true });
            }
            await sleepIf(0.5);
            (ts.scrolls ??= []).push([s0, now()]);
            break;
          }
          case "wait": {
            const w0 = now();
            if (typeof step.wait === "number") await sleepIf(step.wait);
            else await ds.resolve(step.wait, where, (step.timeout ?? 30) * 1000);
            ts.waits.push([w0, now()]);
            break;
          }
          case "pause":
            await sleepIf(step.pause);
            break;
          case "callout":
          case "highlight":
          case "zoomTo": {
            const r = await resolve(step[kind]);
            ts.box = r.box;
            ts.actionAt = now();
            const d = Math.max(step.duration ?? (kind === "zoomTo" ? 2 : 3), minDuration);
            await sleepIf(d + (kind === "zoomTo" ? 0 : 0.55));
            break;
          }
        }
      } catch (e) {
        stopIfAsked();
        const err = e instanceof StepError ? e : new StepError(i, label, (e as Error).message);
        if (!record) {
          checks.push({ index: i, step: label, ok: false, error: err.message, candidates: err.candidates });
          for (let j = i + 1; j < scenario.steps.length; j++) checks.push({ index: j, step: describeStep(scenario.steps[j]), ok: false, error: "not reached" });
          return { check: { ok: false, steps: checks } };
        }
        throw err;
      }
      if (!ts.card && record) {
        const isAction = ["click", "type", "press", "hover", "select", "scroll"].includes(kind);
        await sleepIf((step.hold ?? 0) + (isAction ? 0.7 : 0.2));
        const elapsed = now() - ts.start;
        if (elapsed < minDuration) await sleepIf(minDuration - elapsed);
      }
      ts.end = ts.card ? ts.start : now();
      steps.push(ts);
      checks.push({ index: i, step: label, ok: true });
    }
    stopIfAsked();
    if (!record) return { check: { ok: true, steps: checks } };

    await sleep(1000);
    const duration = now();
    const rec = recorder!;
    await rec.stop();
    recorder = undefined;
    const take: Take = {
      version: 1,
      name: loaded.name,
      recordedAt: new Date().toISOString(),
      platform: process.platform,
      target: { kind: "desktop", app: scenario.app ?? "", ...(ds.screen ? { screen: true } : {}) },
      width: W,
      height: H,
      scale: ds.scale,
      duration,
      cursorStart,
      source: { kind: "video", file: "capture.mp4", fps: rec.fps, offset: rec.startedAt, crop: rec.crop },
      steps,
    };
    return { take };
  } finally {
    pill?.close();
    await recorder?.stop().catch(() => {});
    await ds.ad.endSession();
  }
}

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import type { LoadedScenario } from "../scenario/load.js";
import { describeStep, stepKind, type Step } from "../scenario/schema.js";
import { parseTarget } from "../scenario/target.js";
import type { Box, Point, Take, TakeStep } from "../take.js";
import { captureFfmpegPath } from "../ffmpeg.js";
import { cardDuration, travelDuration, typingDelays } from "./pace.js";
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

/**
 * Translate a scenario target into `agent-desktop find` arguments. With a window id, the search
 * stays in the filmed window, so another window of the same app is never clicked or typed into.
 */
export function findArgs(app: string, target: string, windowId?: string): string[] {
  const base = ["find", "--app", app, ...(windowId ? ["--window-id", windowId] : [])];
  const t = parseTarget(target);
  switch (t.kind) {
    case "role":
      return [...base, "--role", t.role, ...(t.name ? ["--name", t.name, "--exact"] : []), "--first"];
    case "text":
      return [...base, "--name", t.text, "--first"];
    case "label":
    case "placeholder":
      return [...base, "--name", t.text, "--first"];
    case "testid":
      return [...base, "--name", t.id, "--first"];
    case "css":
      throw new Error(`css= targets work on websites only, not in desktop apps ("${target}").`);
    case "at":
      throw new Error("Coordinates have no element.");
  }
}

interface Resolved {
  ref?: string;
  /** Box in window coordinates. */
  box: Box;
}

class DesktopSession {
  ad = new AgentDesktop();
  app: string;
  win!: Win;
  scale = 1;

  constructor(app: string) {
    this.app = app;
  }

  async open(log: (m: string) => void) {
    if (process.platform === "linux" && !process.env.DISPLAY) {
      throw new Error(
        process.env.WAYLAND_DISPLAY
          ? "Desktop recording on Linux needs an X11 session (Wayland blocks screen capture and input by design). Log in with an X11 session, or record a website instead."
          : "No display: desktop recording needs a graphical session (DISPLAY is not set).",
      );
    }
    await this.ad.startSession();
    const apps = await this.ad.call<{ apps: Array<{ name: string }> }>(["list-apps"]);
    const match = apps.data!.apps.find((a) => a.name.toLowerCase() === this.app.toLowerCase());
    if (!match) {
      log(`Launching ${this.app}`);
      await this.ad.call(["launch", this.app, "--activate"]);
      await sleep(1500);
    } else this.app = match.name;
    const wins = await this.ad.call<Win[]>(["list-windows", "--app", this.app]);
    const list = (wins.data ?? []).filter((w) => (w as unknown as { visible?: boolean }).visible !== false);
    if (!list.length) throw new Error(`${this.app} has no visible window.`);
    this.win = list.find((w) => (w as unknown as { is_focused?: boolean }).is_focused) ?? list[0];
    await this.ad.call(["--headed", "focus-window", "--window-id", this.win.id], { allowFail: true });
    const displays = await this.ad.call<Array<{ bounds: Win["bounds"]; scale: number; is_primary: boolean }>>(["list-displays"]);
    const disp =
      displays.data?.find((d) => this.win.bounds.x >= d.bounds.x && this.win.bounds.x < d.bounds.x + d.bounds.width) ?? displays.data?.[0];
    this.scale = disp?.scale ?? 1;
  }

  async resolve(target: string, timeoutMs = 15_000): Promise<Resolved> {
    const t = parseTarget(target);
    if (t.kind === "at") return { box: { x: t.x - 12, y: t.y - 12, width: 24, height: 24 } };
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (true) {
      const r = await this.ad.call<{ match?: { ref_id: string | null; bounds?: Win["bounds"] } }>(findArgs(this.app, target, this.win.id), { allowFail: true });
      const m = r.ok ? r.data?.match : undefined;
      if (m) {
        let b = m.bounds;
        if (m.ref_id) {
          const g = await this.ad.call<{ value: Win["bounds"] | null }>(["get", m.ref_id, "--property", "bounds"], { allowFail: true });
          b = g.data?.value ?? b;
        }
        if (b) {
          return {
            ref: m.ref_id ?? undefined,
            box: { x: b.x - this.win.bounds.x, y: b.y - this.win.bounds.y, width: b.width, height: b.height },
          };
        }
      }
      last = r.error?.message ?? "not found";
      if (Date.now() > deadline) break;
      await sleep(250);
    }
    throw new StepError(-1, target, `nothing in ${this.app} matches "${target}" (${last}).`, await this.candidates());
  }

  async candidates(): Promise<string[]> {
    const out: string[] = [];
    for (const role of ["button", "textfield", "link", "checkbox", "tab", "menuitem"]) {
      const r = await this.ad.call<{ matches?: Array<{ name?: string; role: string }> }>(["find", "--app", this.app, "--window-id", this.win.id, "--role", role, "--limit", "15"], {
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
      const x = Math.round(this.win.bounds.x + res.box.x + res.box.width / 2);
      const y = Math.round(this.win.bounds.y + res.box.y + res.box.height / 2);
      await this.ad.call(["--headed", "mouse-click", "--xy", `${x},${y}`]);
    }
  }

  async press(combo: string) {
    await this.ad.call(["press", "--app", this.app, normalizeCombo(combo)]);
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

  async start(win: Win, scale: number, t0: number) {
    const bin = captureFfmpegPath();
    const W = Math.round(win.bounds.width * scale) & ~1;
    const H = Math.round(win.bounds.height * scale) & ~1;
    let input: string[];
    if (process.platform === "linux") {
      const x = Math.round(win.bounds.x * scale);
      const y = Math.round(win.bounds.y * scale);
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
        String(Math.round(win.bounds.x * scale)),
        "-offset_y",
        String(Math.round(win.bounds.y * scale)),
        "-video_size",
        `${W}x${H}`,
        "-i",
        "desktop",
      ];
      this.crop = { x: 0, y: 0, width: W, height: H };
    } else if (process.platform === "darwin") {
      const screen = macScreenIndex(bin);
      input = ["-f", "avfoundation", "-capture_cursor", "0", "-framerate", String(this.fps), "-i", `${screen}:none`];
      this.crop = { x: Math.round(win.bounds.x * scale), y: Math.round(win.bounds.y * scale), width: W, height: H };
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
  const ds = new DesktopSession(scenario.app!);
  const takeDir = loaded.takeDir;
  if (record) {
    fs.rmSync(takeDir, { recursive: true, force: true });
    fs.mkdirSync(takeDir, { recursive: true });
  }
  const t0 = Date.now() / 1000;
  const now = () => Date.now() / 1000 - t0;
  const sleepIf = (s: number) => (record && s > 0 ? sleep(s * 1000) : Promise.resolve());
  let recorder: Recorder | undefined;
  const checks: CheckStepResult[] = [];
  try {
    await ds.open(opts.log);
    const W = ds.win.bounds.width;
    const H = ds.win.bounds.height;
    if (record) {
      recorder = new Recorder(path.join(takeDir, "capture.mp4"));
      await recorder.start(ds.win, ds.scale, t0);
      await sleep(600);
    }
    let cursor: Point = { x: W * 0.62, y: H * 0.7 };
    const cursorStart = { ...cursor };
    let lastField: string | undefined;
    const steps: TakeStep[] = [];

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i] as Step & Record<string, any>;
      const kind = stepKind(step);
      const label = describeStep(step);
      opts.log(`${record ? "▶" : "·"} ${i + 1}/${scenario.steps.length} ${label}`);
      const ts: TakeStep = { index: i, kind, label, start: now(), end: 0, waits: [] };
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
          const r = await ds.resolve(target);
          if (now() - w0 > 0.5) ts.waits.push([w0, now()]);
          return r;
        } catch (e) {
          if (e instanceof StepError) throw new StepError(i, label, e.message.replace(/^Step 0 \(.*?\) failed: /, ""), e.candidates);
          throw e;
        }
      };
      try {
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
              const x = Math.round(ds.win.bounds.x + r.box.x + r.box.width / 2);
              const y = Math.round(ds.win.bounds.y + r.box.y + r.box.height / 2);
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
              else for (const ch of text) await ds.press(ch === " " ? "space" : ch);
            } else {
              // Type in small chunks so the text appears progressively, like a person typing.
              for (let k = 0; k < text.length; k++) {
                const ch = text[k];
                const t1 = Date.now();
                if (ref) await ds.ad.call(["type", ref, ch]);
                else await ds.press(ch === " " ? "space" : ch);
                const spent = (Date.now() - t1) / 1000;
                await sleep(Math.max(0, delays[k] - spent) * 1000);
              }
            }
            ts.actionEnd = now();
            if (step.submit) {
              await sleepIf(0.25);
              await ds.press("return");
            }
            break;
          }
          case "press":
            ts.actionAt = now();
            await ds.press(step.press);
            break;
          case "scroll": {
            const v = step.scroll as string;
            const s0 = now();
            if (["down", "up"].includes(v)) {
              const r = await ds.ad.call<{ match?: { ref_id: string } }>(["find", "--app", ds.app, "--window-id", ds.win.id, "--role", "scrollarea", "--first"], { allowFail: true });
              const ref = r.data?.match?.ref_id;
              if (!ref) throw new StepError(i, label, "no scrollable area found in the app.");
              await ds.ad.call(["scroll", ref, "--direction", v, "--amount", "5"]);
            } else if (["top", "bottom"].includes(v)) {
              await ds.press(v === "top" ? "home" : "end");
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
            else await ds.resolve(step.wait, (step.timeout ?? 30) * 1000);
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
      target: { kind: "desktop", app: ds.app },
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
    await recorder?.stop().catch(() => {});
    await ds.ad.endSession();
  }
}

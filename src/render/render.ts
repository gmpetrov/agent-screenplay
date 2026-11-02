import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { LoadedScenario } from "../scenario/load.js";
import { stepKind } from "../scenario/schema.js";
import type { Take } from "../take.js";
import { cursorAt, locate, planTake, type Plan } from "../direct/plan.js";
import { ffmpegPath, runFfmpeg } from "../ffmpeg.js";
import { buildStaticLayer, clamp01, computeLayout, drawCapture, drawCard, type FrameState } from "./compose.js";
import { openSource } from "./sources.js";
import { loadFonts, paintBackground, resolveStyle, FONT } from "./style.js";

export interface RenderOptions {
  audio: Map<number, { file: string; duration: number }>;
  gif?: boolean;
  log?: (msg: string) => void;
}

export interface RenderResult {
  mp4: string;
  gif?: string;
  storyboard: string;
  duration: number;
  frames: number;
  seconds: number;
}

const FADE = 0.4;

export async function renderTake(loaded: LoadedScenario, take: Take, opts: RenderOptions): Promise<RenderResult> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const { scenario } = loaded;
  checkStepsMatch(loaded, take);
  loadFonts();
  const style = await resolveStyle(scenario.style, loaded.dir);
  const OW = scenario.output?.width ?? 1920;
  const OH = scenario.output?.height ?? 1080;
  const fps = scenario.output?.fps ?? 30;
  const plan = planTake(take, scenario, {
    fps,
    audio: opts.audio,
    autoZoom: style.autoZoom,
    maxZoom: style.maxZoom,
    captions: style.captions,
  });
  const layout = computeLayout(OW, OH, take.width, take.height, style);
  const staticLayer = buildStaticLayer(layout, style, take.target.kind === "web" ? take.target.url : undefined);
  const bgLayer = createCanvas(OW, OH);
  paintBackground(bgLayer.getContext("2d"), style.background, OW, OH);

  fs.mkdirSync(path.dirname(loaded.outputs.mp4), { recursive: true });
  const voiceFile = plan.voice.length ? await buildVoiceTrack(plan, loaded.takeDir) : undefined;

  const canvas = createCanvas(OW, OH);
  const ctx = canvas.getContext("2d");
  const source = openSource(take, loaded.takeDir);
  const keyframes = pickStoryboardTimes(plan, take);
  const thumbs: Array<{ canvas: Canvas; label: string; o: number }> = [];

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${OW}x${OH}`,
    "-framerate",
    String(fps),
    "-i",
    "pipe:0",
  ];
  if (voiceFile) args.push("-i", voiceFile);
  args.push("-map", "0:v");
  if (voiceFile) args.push("-map", "1:a", "-c:a", "aac", "-b:a", "192k");
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "17",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-t",
    plan.duration.toFixed(3),
    loaded.outputs.mp4,
  );
  const enc = spawn(ffmpegPath(), args);
  let encErr = "";
  enc.stderr.on("data", (d) => (encErr += d.toString()));
  const encDone = new Promise<void>((resolve, reject) => {
    enc.on("error", reject);
    enc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg encoding failed: ${encErr.slice(-1500)}`))));
  });

  try {
    let lastLog = 0;
    for (let f = 0; f < plan.frameCount; f++) {
      const o = f / fps;
      const loc = locate(plan, o);
      const prev = plan.pieces[loc.index - 1];
      const next = plan.pieces[loc.index + 1];
      if (loc.piece.kind === "card") {
        const card = loc.piece.step.card!;
        const u = o - loc.piece.o0;
        if (u < FADE && prev?.kind === "capture") {
          await drawCaptureAt(prev.s1, o, f);
          drawCard(ctx, layout, style, bgLayer, card, u, clamp01(u / FADE));
        } else drawCard(ctx, layout, style, bgLayer, card, u);
      } else {
        await drawCaptureAt(loc.s!, o, f);
        const u = o - loc.piece.o0;
        if (u < FADE && prev?.kind === "card") {
          drawCard(ctx, layout, style, bgLayer, prev.step.card!, prev.o1 - prev.o0 + u, 1 - clamp01(u / FADE));
        }
        void next;
      }

      for (const kf of keyframes) {
        if (Math.round(kf.o * fps) === f) {
          const t = createCanvas(480, Math.round((480 * OH) / OW));
          t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
          thumbs.push({ canvas: t, label: kf.label, o });
        }
      }

      const data = canvas.data();
      if (!enc.stdin.write(data)) await new Promise<void>((r) => enc.stdin.once("drain", () => r()));
      if (Date.now() - lastLog > 3000) {
        lastLog = Date.now();
        log(`Rendering ${Math.round((100 * f) / plan.frameCount)}%`);
      }
    }
    enc.stdin.end();
    await encDone;
  } finally {
    source.close();
    if (!enc.killed && enc.exitCode === null) enc.stdin.end();
  }

  const storyboard = writeStoryboard(thumbs, loaded.outputs.storyboard, loaded.name, plan.duration);
  let gif: string | undefined;
  if (opts.gif || scenario.output?.gif) {
    log("Writing GIF");
    gif = loaded.outputs.gif;
    await runFfmpeg([
      "-i",
      loaded.outputs.mp4,
      "-vf",
      "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
      gif,
    ]);
  }
  return {
    mp4: loaded.outputs.mp4,
    gif,
    storyboard,
    duration: plan.duration,
    frames: plan.frameCount,
    seconds: (Date.now() - started) / 1000,
  };

  async function drawCaptureAt(s: number, o: number, f: number) {
    const frame = await source.frameAt(s);
    const camera = plan.cameras[Math.min(f, plan.cameras.length - 1)];
    const st: FrameState = { o, camera, ripples: [], annotations: [] };
    // Cursor: hidden while typing, like the system pointer.
    let alpha = 1;
    for (const [a, b] of plan.typing) {
      if (o > a + 0.15 && o < b + 0.6) alpha = Math.min(alpha, 1 - clamp01((o - a - 0.15) / 0.2) + clamp01((o - b) / 0.6));
    }
    let press = 1;
    for (const c of plan.clicks) {
      const d = o - c;
      if (d > -0.08 && d < 0.3) press = Math.min(press, 1 - 0.16 * Math.sin(Math.PI * clamp01((d + 0.08) / 0.38)));
      if (d >= 0 && d < 0.55) st.ripples.push({ p: cursorAt(plan.movements, take.cursorStart, s), u: d / 0.55 });
    }
    st.cursor = { p: cursorAt(plan.movements, take.cursorStart, s), alpha: clamp01(alpha), press };
    for (const a of plan.annotations) {
      if (o >= a.o0 && o < a.o1 + 0.3) st.annotations.push({ a, inU: clamp01((o - a.o0) / 0.35), outU: clamp01((o - a.o1) / 0.3) });
    }
    for (const c of plan.captions) {
      if (o >= c.o0 && o < c.o1 + 0.25) {
        st.caption = { c, alpha: Math.min(clamp01((o - c.o0) / 0.2), 1 - clamp01((o - c.o1) / 0.25)) };
      }
    }
    drawCapture(ctx, layout, style, staticLayer, frame, take.width, take.height, st);
  }
}

/** The take must come from the same steps (same kinds, same order) as the scenario. */
function checkStepsMatch(loaded: LoadedScenario, take: Take) {
  const kinds = loaded.scenario.steps.map(stepKind);
  const takeKinds = take.steps.map((s) => s.kind);
  if (kinds.length !== takeKinds.length || kinds.some((k, i) => k !== takeKinds[i])) {
    throw new Error(
      "The scenario's steps changed since the last recording (only text, narration, style and zoom can change without filming again). Run `screenplay record` again.",
    );
  }
}

function pickStoryboardTimes(plan: Plan, take: Take): Array<{ o: number; label: string }> {
  const out: Array<{ o: number; label: string }> = [];
  for (const st of take.steps) {
    const t = plan.stepTimes[st.index];
    if (!t) continue;
    let o: number;
    if (st.card) o = t.o0 + Math.min(1.2, (t.o1 - t.o0) / 2);
    else if (t.oAction !== undefined) o = Math.min(t.o1 - 0.05, t.oAction + (st.kind === "type" ? 0.9 : 0.35));
    else o = (t.o0 + t.o1) / 2;
    out.push({ o: Math.max(0, Math.min(plan.duration - 1 / plan.fps, o)), label: `${st.index + 1} · ${st.label}` });
  }
  if (out.length <= 16) return out;
  const step = out.length / 16;
  return Array.from({ length: 16 }, (_, i) => out[Math.floor(i * step)]);
}

function writeStoryboard(thumbs: Array<{ canvas: Canvas; label: string; o: number }>, file: string, name: string, duration: number) {
  const cols = Math.min(4, Math.max(1, thumbs.length));
  const rows = Math.max(1, Math.ceil(thumbs.length / cols));
  const tw = 480;
  const th = thumbs[0]?.canvas.height ?? 270;
  const gap = 16;
  const labelH = 44;
  const headH = 56;
  const W = cols * tw + (cols + 1) * gap;
  const H = headH + rows * (th + labelH) + (rows + 1) * gap;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#111114";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 22px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(`${name} — ${fmtTime(duration)} — storyboard`, gap, headH / 2 + 4);
  thumbs.forEach((t, i) => {
    const x = gap + (i % cols) * (tw + gap);
    const y = headH + gap + Math.floor(i / cols) * (th + labelH + gap);
    ctx.drawImage(t.canvas, x, y);
    ctx.fillStyle = "#d4d4d8";
    ctx.font = `500 15px ${FONT}`;
    ctx.fillText(`${fmtTime(t.o)}  ${t.label}`.slice(0, 62), x + 2, y + th + 22, tw - 4);
  });
  fs.writeFileSync(file, c.toBuffer("image/png"));
  return file;
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
}

async function buildVoiceTrack(plan: Plan, takeDir: string): Promise<string> {
  const out = path.join(takeDir, "voice.wav");
  const inputs: string[] = [];
  const filters: string[] = [];
  plan.voice.forEach((v, i) => {
    inputs.push("-i", v.file);
    const ms = Math.round(v.at * 1000);
    filters.push(`[${i}:a]aresample=48000,adelay=${ms}|${ms}[a${i}]`);
  });
  const mix = plan.voice.map((_, i) => `[a${i}]`).join("");
  filters.push(`${mix}amix=inputs=${plan.voice.length}:normalize=0:dropout_transition=0,apad,atrim=0:${plan.duration.toFixed(3)}[out]`);
  await runFfmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-ac", "2", "-ar", "48000", out]);
  return out;
}

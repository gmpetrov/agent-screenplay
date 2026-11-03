import type { Scenario, Step } from "../scenario/schema.js";
import type { Box, Point, Take, TakeStep } from "../take.js";
import { cardDuration } from "../drivers/pace.js";

/**
 * The edit of a take: how output time maps to recording time, where the
 * camera looks, where the cursor is, and which overlays show when.
 * Pure data, computed once, then drawn frame by frame by the compositor.
 */

export type Piece =
  | { kind: "capture"; o0: number; o1: number; s0: number; s1: number }
  | { kind: "card"; o0: number; o1: number; step: TakeStep; card: CardContent };

export interface CardContent {
  kind: "title" | "end";
  title: string;
  subtitle?: string;
}

export interface Camera {
  z: number;
  cx: number;
  cy: number;
}

export interface Caption {
  o0: number;
  o1: number;
  text: string;
}

export interface Annotation {
  kind: "callout" | "highlight";
  o0: number;
  o1: number;
  box: Box;
  text?: string;
}

export interface VoiceClip {
  file: string;
  at: number;
  duration: number;
}

export interface Plan {
  fps: number;
  duration: number;
  frameCount: number;
  pieces: Piece[];
  /** Camera state for each output frame. */
  cameras: Camera[];
  captions: Caption[];
  annotations: Annotation[];
  /** Output times of clicks. */
  clicks: number[];
  voice: VoiceClip[];
  /** Output time span of each step. */
  stepTimes: Array<{ o0: number; o1: number; oAction?: number }>;
  movements: Movement[];
  typing: Array<[number, number]>;
  width: number;
  height: number;
}

export interface Movement {
  s0: number;
  s1: number;
  from: Point;
  to: Point;
  /** Side of the arc (+1/-1). */
  bend: number;
}

export interface PlanOptions {
  fps: number;
  audio: Map<number, { file: string; duration: number }>;
  autoZoom: boolean;
  maxZoom: number;
  captions: boolean;
  /** Show the title and end cards (style.cards). When false they are left out of the video. */
  cards?: boolean;
}

const WAIT_KEEP = 0.9; // seconds of a wait shown at normal speed
const WAIT_RATE = 8; // the rest of the wait plays this many times faster
const WAIT_MAX = 2.4; // a wait never lasts longer than this in the video
export const OVERLAY_DELAY = 0.55; // callouts and highlights appear after the camera framed them

export function planTake(take: Take, scenario: Scenario, opts: PlanOptions): Plan {
  const steps = take.steps;
  const pieces: Piece[] = [];
  let op = 0; // output pointer
  let sp = 0; // source pointer

  const emitCapture = (sEnd: number) => {
    if (sEnd <= sp + 1e-6) return;
    const waits = mergeSpans(steps.flatMap((s) => s.waits)).filter(([a, b]) => b > sp && a < sEnd);
    let cur = sp;
    for (const [a0, b0] of waits) {
      const a = Math.max(a0, cur);
      const b = Math.min(b0, sEnd);
      if (a > cur) {
        pieces.push({ kind: "capture", o0: op, o1: op + (a - cur), s0: cur, s1: a });
        op += a - cur;
      }
      if (b > a) {
        const len = b - a;
        const out = len <= WAIT_KEEP ? len : Math.min(WAIT_MAX, WAIT_KEEP + (len - WAIT_KEEP) / WAIT_RATE);
        pieces.push({ kind: "capture", o0: op, o1: op + out, s0: a, s1: b });
        op += out;
      }
      cur = Math.max(cur, b);
    }
    if (sEnd > cur) {
      pieces.push({ kind: "capture", o0: op, o1: op + (sEnd - cur), s0: cur, s1: sEnd });
      op += sEnd - cur;
    }
    sp = sEnd;
  };

  const srcToOut = (s: number): number => {
    for (const p of pieces) {
      if (p.kind === "capture" && s >= p.s0 - 1e-9 && s <= p.s1 + 1e-9) {
        if (p.s1 === p.s0) return p.o0;
        return p.o0 + ((s - p.s0) / (p.s1 - p.s0)) * (p.o1 - p.o0);
      }
    }
    return op;
  };

  const stepTimes: Plan["stepTimes"] = [];
  const voice: VoiceClip[] = [];
  for (const st of steps) {
    const audio = opts.audio.get(st.index);
    if (st.card && opts.cards === false) {
      // Cards are off: the step takes no time in the video. A video that started with one
      // still drops the still lead-in recorded before it.
      if (pieces.length === 0) sp = st.start;
      emitCapture(st.start);
      continue;
    }
    if (st.card) {
      // An opening card starts the video: drop the still lead-in recorded before it.
      if (pieces.length === 0) sp = st.start;
      emitCapture(st.start);
      // Card text and length come from the scenario as it is now: they can change without filming again.
      const sc = scenario.steps[st.index] as { title?: string; end?: string; subtitle?: string; duration?: number };
      const title = (st.card.kind === "title" ? sc.title : sc.end) ?? st.card.title;
      const base = sc.duration ?? cardDuration(title, sc.subtitle);
      const dur = Math.max(base, audio ? audio.duration + 0.6 : 0);
      pieces.push({ kind: "card", o0: op, o1: op + dur, step: st, card: { kind: st.card.kind, title, subtitle: sc.subtitle } });
      stepTimes[st.index] = { o0: op, o1: op + dur };
      if (audio) voice.push({ file: audio.file, at: op + 0.25, duration: audio.duration });
      op += dur;
      continue;
    }
    emitCapture(st.start);
    const o0 = op;
    emitCapture(st.end);
    // Narration longer than the step: hold the last image until it ends.
    if (audio && op - o0 < audio.duration + 0.35) {
      const extra = audio.duration + 0.35 - (op - o0);
      pieces.push({ kind: "capture", o0: op, o1: op + extra, s0: st.end, s1: st.end });
      op += extra;
    }
    stepTimes[st.index] = { o0, o1: op, oAction: st.actionAt !== undefined ? srcToOut(st.actionAt) : undefined };
    if (audio) voice.push({ file: audio.file, at: o0 + 0.05, duration: audio.duration });
  }
  emitCapture(take.duration);
  const duration = op;
  const frameCount = Math.max(1, Math.ceil(duration * opts.fps));

  // ---- cursor movements (recording time) ---------------------------------
  const movements: Movement[] = [];
  let prev = take.cursorStart;
  let bend = 1;
  for (const st of steps) {
    if (!st.point) continue;
    const s0 = st.travelStart ?? st.actionAt ?? st.start;
    const s1 = st.actionAt ?? s0 + 0.5;
    if (Math.hypot(st.point.x - prev.x, st.point.y - prev.y) > 2) {
      movements.push({ s0, s1: Math.max(s1, s0 + 0.05), from: prev, to: st.point, bend });
      bend = -bend;
    }
    prev = st.point;
  }

  const clicks = steps
    .filter((s) => s.actionAt !== undefined && (s.kind === "click" || s.kind === "select" || (s.kind === "type" && s.point)))
    .map((s) => srcToOut(s.actionAt!));
  const typing = steps
    .filter((s) => s.kind === "type" && s.actionAt !== undefined && s.actionEnd !== undefined)
    .map((s) => [srcToOut(s.actionAt!), srcToOut(s.actionEnd!)] as [number, number]);

  // ---- overlays -----------------------------------------------------------
  const captions: Caption[] = [];
  const annotations: Annotation[] = [];
  for (const st of steps) {
    const sc = scenario.steps[st.index] as Step & { say?: string; text?: string };
    const t = stepTimes[st.index];
    if (!t) continue;
    if (opts.captions && sc.say && !st.card) {
      const audio = opts.audio.get(st.index);
      captions.push({ o0: t.o0 + 0.05, o1: Math.max(t.o1, t.o0 + (audio?.duration ?? 0) + 0.2), text: sc.say });
    }
    if ((st.kind === "callout" || st.kind === "highlight") && st.box) {
      // Appear once the camera has had time to frame the element.
      annotations.push({ kind: st.kind, o0: Math.min(t.o0 + OVERLAY_DELAY, t.o1 - 0.5), o1: t.o1, box: st.box, text: sc.text });
    }
  }

  // ---- camera -------------------------------------------------------------
  const W = take.width;
  const H = take.height;
  const shots = buildShots(take, scenario, stepTimes, srcToOut, opts);
  const cameras = simulateCamera(shots, frameCount, opts.fps, W, H);

  return {
    fps: opts.fps,
    duration,
    frameCount,
    pieces,
    cameras,
    captions,
    annotations,
    clicks,
    voice,
    stepTimes,
    movements,
    typing,
    width: W,
    height: H,
  };
}

interface Shot {
  o0: number;
  o1: number;
  z: number;
  cx: number;
  cy: number;
}

function buildShots(
  take: Take,
  scenario: Scenario,
  stepTimes: Plan["stepTimes"],
  srcToOut: (s: number) => number,
  opts: PlanOptions,
): Shot[] {
  const W = take.width;
  const H = take.height;
  const shots: Shot[] = [];
  for (const st of take.steps) {
    if (!st.box || st.card) continue;
    const sc = scenario.steps[st.index] as { zoom?: boolean | number };
    if (sc.zoom === false) continue;
    const forced = typeof sc.zoom === "number" ? sc.zoom : undefined;
    const isOverlay = st.kind === "callout" || st.kind === "highlight" || st.kind === "zoomTo";
    if (forced === undefined && !opts.autoZoom && st.kind !== "zoomTo") continue;
    // Typing happens at the start of a field: frame that part rather than a very wide input.
    const box =
      st.kind === "type" && st.typed !== undefined && st.box.width > W / 3
        ? { ...st.box, width: Math.min(st.box.width, Math.max(260, st.typed.length * 7.5 + 60)) }
        : st.box;
    let z = forced ?? autoZoom(box, W, H, isOverlay ? Math.min(opts.maxZoom, 1.6) : opts.maxZoom);
    if (st.kind === "zoomTo" && forced === undefined) z = autoZoom(box, W, H, opts.maxZoom);
    if (z <= 1.02) continue;
    const t = stepTimes[st.index];
    const begin = isOverlay ? t.o0 - 0.1 : srcToOut(st.travelStart ?? st.actionAt ?? st.start) - 0.12;
    let end = t.o1;
    if (st.navigated && st.actionAt !== undefined) end = Math.min(end, srcToOut(st.actionAt) + 0.45);
    shots.push({ o0: Math.max(0, begin), o1: end, z, cx: box.x + box.width / 2, cy: box.y + box.height / 2 });
  }
  // Stay zoomed between close shots instead of bouncing out and back in.
  for (let i = 0; i + 1 < shots.length; i++) {
    if (shots[i + 1].o0 - shots[i].o1 < 1.3) shots[i].o1 = shots[i + 1].o0;
  }
  return shots;
}

/** Zoom that frames a box with comfortable context. */
export function autoZoom(box: Box, W: number, H: number, maxZoom: number): number {
  const wantW = Math.max(box.width * 2.4, W / maxZoom);
  const wantH = Math.max(box.height * 3.2, H / maxZoom);
  return clampNum(Math.min(W / wantW, H / wantH), 1, maxZoom);
}

/** Critically damped spring on log(zoom) and the center: smooth starts, no overshoot. */
function simulateCamera(shots: Shot[], frameCount: number, fps: number, W: number, H: number): Camera[] {
  const omega = 5.2;
  const sub = 4;
  const dt = 1 / fps / sub;
  let lz = 0,
    vz = 0,
    cx = W / 2,
    vx = 0,
    cy = H / 2,
    vy = 0;
  const out: Camera[] = [];
  let si = 0;
  for (let f = 0; f < frameCount; f++) {
    const o = f / fps;
    while (si < shots.length && shots[si].o1 < o) si++;
    const shot = si < shots.length && shots[si].o0 <= o ? shots[si] : undefined;
    const tz = shot ? Math.log(shot.z) : 0;
    const z = Math.exp(tz);
    const tx = shot ? clampCenter(shot.cx, W, z) : W / 2;
    const ty = shot ? clampCenter(shot.cy, H, z) : H / 2;
    for (let k = 0; k < sub; k++) {
      vz += (omega * omega * (tz - lz) - 2 * omega * vz) * dt;
      lz += vz * dt;
      vx += (omega * omega * (tx - cx) - 2 * omega * vx) * dt;
      cx += vx * dt;
      vy += (omega * omega * (ty - cy) - 2 * omega * vy) * dt;
      cy += vy * dt;
    }
    const zz = Math.max(1, Math.exp(lz));
    out.push({ z: zz, cx: clampCenter(cx, W, zz), cy: clampCenter(cy, H, zz) });
  }
  return out;
}

function clampCenter(c: number, size: number, z: number) {
  const half = size / (2 * z);
  return clampNum(c, half, size - half);
}

function clampNum(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Where the cursor is at recording time s (minimum-jerk motion along a gentle arc). */
export function cursorAt(movements: Movement[], start: Point, s: number): Point {
  let pos = start;
  for (const m of movements) {
    if (s < m.s0) break;
    if (s >= m.s1) {
      pos = m.to;
      continue;
    }
    const u = (s - m.s0) / (m.s1 - m.s0);
    const e = u * u * u * (10 - 15 * u + 6 * u * u);
    const dx = m.to.x - m.from.x;
    const dy = m.to.y - m.from.y;
    const len = Math.hypot(dx, dy) || 1;
    const arc = Math.min(80, len * 0.12) * m.bend;
    const ctrl = { x: (m.from.x + m.to.x) / 2 - (dy / len) * arc, y: (m.from.y + m.to.y) / 2 + (dx / len) * arc };
    const a = 1 - e;
    return {
      x: a * a * m.from.x + 2 * a * e * ctrl.x + e * e * m.to.x,
      y: a * a * m.from.y + 2 * a * e * ctrl.y + e * e * m.to.y,
    };
  }
  return pos;
}

/** Locate output time o: the piece, and the recording time when it is a capture. */
export function locate(plan: Plan, o: number): { piece: Piece; index: number; s?: number } {
  const { pieces } = plan;
  let i = pieces.findIndex((p) => o >= p.o0 && o < p.o1);
  if (i < 0) i = pieces.length - 1;
  const piece = pieces[i];
  if (piece.kind === "capture") {
    const u = piece.o1 > piece.o0 ? (o - piece.o0) / (piece.o1 - piece.o0) : 0;
    return { piece, index: i, s: piece.s0 + Math.min(1, Math.max(0, u)) * (piece.s1 - piece.s0) };
  }
  return { piece, index: i };
}

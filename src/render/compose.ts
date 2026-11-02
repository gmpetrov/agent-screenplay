import { createCanvas, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { Annotation, Camera, Caption } from "../direct/plan.js";
import type { Box, Point } from "../take.js";
import { FONT, paintBackground, roundRect, type ResolvedStyle } from "./style.js";

export interface Layout {
  OW: number;
  OH: number;
  /** Unit for sizes: 1 at 1080p. */
  k: number;
  window: { x: number; y: number; w: number; h: number };
  content: { x: number; y: number; w: number; h: number };
  barH: number;
}

export function computeLayout(OW: number, OH: number, W: number, H: number, style: ResolvedStyle): Layout {
  const k = OH / 1080;
  const pad = style.padding * k;
  const barH = style.frame === "browser" ? Math.round(40 * k) : 0;
  const availW = OW - 2 * pad;
  const availH = OH - 2 * pad - barH;
  const s = Math.min(availW / W, availH / H);
  const cw = Math.round(W * s);
  const ch = Math.round(H * s);
  const wx = Math.round((OW - cw) / 2);
  const wy = Math.round((OH - ch - barH) / 2);
  return {
    OW,
    OH,
    k,
    window: { x: wx, y: wy, w: cw, h: ch + barH },
    content: { x: wx, y: wy + barH, w: cw, h: ch },
    barH,
  };
}

/** Background, shadow and window chrome: drawn once, reused for every frame. */
export function buildStaticLayer(layout: Layout, style: ResolvedStyle, url?: string): Canvas {
  const c = createCanvas(layout.OW, layout.OH);
  const ctx = c.getContext("2d");
  paintBackground(ctx, style.background, layout.OW, layout.OH);
  const { x, y, w, h } = layout.window;
  const r = style.radius * layout.k;
  if (style.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 60 * layout.k;
    ctx.shadowOffsetY = 24 * layout.k;
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 8 * layout.k;
    ctx.shadowOffsetY = 2 * layout.k;
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }
  if (layout.barH > 0) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(x, y, w, layout.barH);
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(x, y + layout.barH - 1, w, 1);
    const dots = ["#ff5f57", "#febc2e", "#28c840"];
    dots.forEach((col, i) => {
      ctx.beginPath();
      ctx.arc(x + 22 * layout.k + i * 20 * layout.k, y + layout.barH / 2, 6 * layout.k, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    });
    if (url) {
      const bw = Math.min(w * 0.5, 620 * layout.k);
      const bx = x + (w - bw) / 2;
      const bh = 24 * layout.k;
      roundRect(ctx, bx, y + (layout.barH - bh) / 2, bw, bh, 7 * layout.k);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.fillStyle = "#6b7280";
      ctx.font = `500 ${13 * layout.k}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(shortUrl(url), bx + bw / 2, y + layout.barH / 2, bw - 20 * layout.k);
    }
    ctx.restore();
  }
  return c;
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}

export interface CaptureFrame {
  image: Image | Canvas;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface FrameState {
  o: number;
  camera: Camera;
  cursor?: { p: Point; alpha: number; press: number };
  ripples: Array<{ p: Point; u: number }>;
  annotations: Array<{ a: Annotation; inU: number; outU: number }>;
  caption?: { c: Caption; alpha: number };
}

/** Draw one recorded frame with the camera, overlays and cursor. */
export function drawCapture(
  ctx: SKRSContext2D,
  layout: Layout,
  style: ResolvedStyle,
  staticLayer: Canvas,
  frame: CaptureFrame,
  W: number,
  H: number,
  st: FrameState,
) {
  const { content, window: win, k } = layout;
  ctx.drawImage(staticLayer, 0, 0);
  const { z, cx, cy } = st.camera;
  const vw = W / z;
  const vh = H / z;
  const left = cx - vw / 2;
  const top = cy - vh / 2;
  const kx = frame.sw / W;
  const ky = frame.sh / H;
  const toOut = (p: Point): Point => ({
    x: content.x + ((p.x - left) / vw) * content.w,
    y: content.y + ((p.y - top) / vh) * content.h,
  });
  const boxOut = (b: Box) => {
    const a = toOut({ x: b.x, y: b.y });
    const c = toOut({ x: b.x + b.width, y: b.y + b.height });
    return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
  };

  ctx.save();
  roundRect(ctx, win.x, win.y, win.w, win.h, style.radius * k);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    frame.image as Image,
    frame.sx + left * kx,
    frame.sy + top * ky,
    vw * kx,
    vh * ky,
    content.x,
    content.y,
    content.w,
    content.h,
  );

  // Spotlight: dim everything but the highlighted element.
  for (const { a, inU, outU } of st.annotations) {
    if (a.kind !== "highlight") continue;
    const alpha = easeOut(inU) * (1 - outU);
    const b = boxOut(pad(a.box, 8));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(content.x, content.y, content.w, content.h);
    roundRect(ctx, b.x, b.y, b.w, b.h, 10 * k, false);
    ctx.fillStyle = "rgba(8,10,20,0.55)";
    ctx.fill("evenodd");
    ctx.restore();
  }
  ctx.restore();

  // Rings and bubbles pointing at elements.
  for (const { a, inU, outU } of st.annotations) {
    const alpha = easeOut(inU) * (1 - outU);
    const b = boxOut(pad(a.box, 6));
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRect(ctx, b.x, b.y, b.w, b.h, 10 * k);
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = style.accent;
    ctx.stroke();
    ctx.restore();
    if (a.text) drawBubble(ctx, layout, style, a.text, b, inU, outU);
  }

  // Click ripples.
  for (const r of st.ripples) {
    const q = toOut(r.p);
    const rad = (8 + 30 * easeOut(r.u)) * k * (0.8 + 0.2 * z);
    ctx.save();
    ctx.globalAlpha = 0.55 * (1 - r.u);
    ctx.beginPath();
    ctx.arc(q.x, q.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = hexA(style.accent, 0.25);
    ctx.fill();
    ctx.lineWidth = 2.5 * k;
    ctx.strokeStyle = style.accent;
    ctx.stroke();
    ctx.restore();
  }

  if (st.cursor && st.cursor.alpha > 0.01 && style.cursor !== "none") {
    const q = toOut(st.cursor.p);
    const size = k * style.cursorSize * (1 + 0.4 * (z - 1)) * st.cursor.press;
    drawCursor(ctx, style.cursor, q, size, st.cursor.alpha);
  }

  if (st.caption) {
    // Keep the caption away from where the action is: move it to the top when the cursor is low.
    const focus = st.cursor ? toOut(st.cursor.p) : undefined;
    const low = focus !== undefined && focus.y > win.y + win.h * 0.62;
    drawCaption(ctx, layout, st.caption.c.text, st.caption.alpha, low ? "top" : "bottom");
  }
}

function pad(b: Box, n: number): Box {
  return { x: b.x - n, y: b.y - n, width: b.width + 2 * n, height: b.height + 2 * n };
}

function drawBubble(
  ctx: SKRSContext2D,
  layout: Layout,
  style: ResolvedStyle,
  text: string,
  target: { x: number; y: number; w: number; h: number },
  inU: number,
  outU: number,
) {
  const { k, window: win } = layout;
  const fontSize = 26 * k;
  ctx.font = `600 ${fontSize}px ${FONT}`;
  const lines = wrap(ctx, text, 520 * k);
  const lh = fontSize * 1.3;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bw = tw + 40 * k;
  const bh = lines.length * lh + 26 * k;
  const gap = 18 * k;
  const above = target.y - bh - gap > win.y + 10 * k;
  let bx = target.x + target.w / 2 - bw / 2;
  bx = Math.max(win.x + 12 * k, Math.min(bx, win.x + win.w - bw - 12 * k));
  const by = above ? target.y - gap - bh : target.y + target.h + gap;
  const s = 0.9 + 0.1 * easeOutBack(Math.min(1, inU));
  const alpha = Math.min(1, inU * 1.6) * (1 - outU);
  const ax = Math.max(bx + 20 * k, Math.min(target.x + target.w / 2, bx + bw - 20 * k));
  const ay = above ? by + bh : by;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(ax, ay);
  ctx.scale(s, s);
  ctx.translate(-ax, -ay + (1 - easeOut(inU)) * (above ? 10 : -10) * k);
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 24 * k;
  ctx.shadowOffsetY = 8 * k;
  ctx.fillStyle = style.accent;
  roundRect(ctx, bx, by, bw, bh, 14 * k);
  ctx.fill();
  ctx.beginPath();
  const tri = 10 * k;
  if (above) {
    ctx.moveTo(ax - tri, by + bh - 1);
    ctx.lineTo(ax, by + bh + tri);
    ctx.lineTo(ax + tri, by + bh - 1);
  } else {
    ctx.moveTo(ax - tri, by + 1);
    ctx.lineTo(ax, by - tri);
    ctx.lineTo(ax + tri, by + 1);
  }
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, by + 13 * k + lh * (i + 0.5)));
  ctx.restore();
}

function drawCaption(ctx: SKRSContext2D, layout: Layout, text: string, alpha: number, where: "top" | "bottom") {
  const { k, window: win } = layout;
  const fontSize = 30 * k;
  ctx.save();
  ctx.font = `600 ${fontSize}px ${FONT}`;
  const lines = wrap(ctx, text, Math.min(win.w * 0.78, 1200 * k)).slice(0, 3);
  const lh = fontSize * 1.32;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bw = tw + 48 * k;
  const bh = lines.length * lh + 26 * k;
  const bx = win.x + (win.w - bw) / 2;
  const by = where === "bottom" ? win.y + win.h - bh - 34 * k : win.y + layout.barH + 34 * k;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(12,12,16,0.82)";
  roundRect(ctx, bx, by + (1 - alpha) * 8 * k, bw, bh, 14 * k);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, by + (1 - alpha) * 8 * k + 13 * k + lh * (i + 0.5)));
  ctx.restore();
}

/** Full-screen title or end card. `u` is the time since it appeared (seconds). */
export function drawCard(
  ctx: SKRSContext2D,
  layout: Layout,
  style: ResolvedStyle,
  bgLayer: Canvas,
  card: { kind: "title" | "end"; title: string; subtitle?: string },
  u: number,
  alpha = 1,
) {
  const { OW, OH, k } = layout;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(bgLayer, 0, 0);
  const color = style.darkBackground ? "#ffffff" : "#0b0b0f";
  const sub = style.darkBackground ? "rgba(255,255,255,0.78)" : "rgba(11,11,15,0.65)";
  const titleSize = (card.title.length > 40 ? 64 : 80) * k;
  ctx.font = `700 ${titleSize}px ${FONT}`;
  const lines = wrap(ctx, card.title, OW * 0.72);
  const lh = titleSize * 1.12;
  const subSize = 34 * k;
  const total = lines.length * lh + (card.subtitle ? subSize * 1.9 : 0);
  let y = OH / 2 - total / 2;
  const e1 = easeOut(clamp01(u / 0.7));
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.globalAlpha = alpha * e1;
  ctx.fillStyle = color;
  for (const l of lines) {
    ctx.fillText(l, OW / 2, y + (1 - e1) * 28 * k);
    y += lh;
  }
  if (card.subtitle) {
    const e2 = easeOut(clamp01((u - 0.18) / 0.7));
    ctx.globalAlpha = alpha * e2;
    ctx.font = `500 ${subSize}px ${FONT}`;
    ctx.fillStyle = sub;
    ctx.fillText(card.subtitle, OW / 2, y + subSize * 0.7 + (1 - e2) * 22 * k, OW * 0.8);
  }
  ctx.restore();
}

/** macOS-style arrow, or a soft dot. `size` is 1 at 1080p. */
export function drawCursor(ctx: SKRSContext2D, kind: "macos" | "dot", p: Point, size: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  if (kind === "dot") {
    ctx.beginPath();
    ctx.arc(0, 0, 13 * size, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20,20,24,0.55)";
    ctx.fill();
    ctx.lineWidth = 3 * size;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();
    return;
  }
  const s = 1.55 * size;
  ctx.scale(s, s);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 19.5);
  ctx.lineTo(4.6, 15.2);
  ctx.lineTo(7.6, 22.2);
  ctx.lineTo(11.0, 20.8);
  ctx.lineTo(8.1, 14.0);
  ctx.lineTo(14.2, 14.0);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.moveTo(1.6, 3.6);
  ctx.lineTo(1.6, 15.8);
  ctx.lineTo(5.0, 12.6);
  ctx.lineTo(8.3, 20.3);
  ctx.lineTo(9.6, 19.7);
  ctx.lineTo(6.4, 12.3);
  ctx.lineTo(10.6, 12.3);
  ctx.closePath();
  ctx.fillStyle = "#0a0a0a";
  ctx.fill();
  ctx.restore();
}

export function wrap(ctx: SKRSContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function easeOut(t: number) {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 3);
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function clamp01(t: number) {
  return Math.min(1, Math.max(0, t));
}

function hexA(hex: string, a: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

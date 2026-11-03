import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas, type SKRSContext2D, loadImage, type Image } from "@napi-rs/canvas";
import type { Style } from "../scenario/schema.js";
import { ALL_PRESETS, DEFAULT_BACKGROUND, NOISE_TILE, noiseValues, seeded, type Blob, type GlowPreset } from "./presets.js";

/** @deprecated kept for imports; see presets.ts. */
export const PRESETS = ALL_PRESETS;

export interface ResolvedStyle {
  background:
    | { kind: "gradient"; stops: string[]; angle: number }
    | { kind: "mesh"; base: string; blobs: Blob[]; grain: number }
    | { kind: "glow"; preset: GlowPreset }
    | { kind: "color"; color: string }
    | { kind: "image"; image: Image };
  darkBackground: boolean;
  padding: number;
  radius: number;
  shadow: boolean;
  cursor: "arrow" | "macos" | "dot" | "none";
  click: "ripple" | "rays" | "confetti" | "sparkle" | "none";
  cursorSize: number;
  maxZoom: number;
  autoZoom: boolean;
  captions: boolean;
  accent: string;
  frame: "none" | "browser";
  cards: boolean;
}

export async function resolveStyle(style: Style | undefined, baseDir: string): Promise<ResolvedStyle> {
  const s = style ?? {};
  const bg = s.background ?? DEFAULT_BACKGROUND;
  let background: ResolvedStyle["background"];
  let dark = true;
  if (typeof bg === "object") {
    background = { kind: "gradient", stops: bg.gradient, angle: bg.angle ?? 135 };
    dark = bg.gradient.filter(isDarkColor).length * 2 >= bg.gradient.length;
  } else if (ALL_PRESETS[bg]) {
    const p = ALL_PRESETS[bg];
    background =
      p.kind === "mesh"
        ? { kind: "mesh", base: p.base, blobs: p.blobs, grain: p.grain }
        : p.kind === "glow"
          ? { kind: "glow", preset: p }
          : { kind: "gradient", stops: p.stops, angle: p.angle };
    dark = p.dark;
  } else if (/^(#|rgb|hsl)/i.test(bg)) {
    background = { kind: "color", color: bg };
    dark = isDarkColor(bg);
  } else {
    const file = path.resolve(baseDir, bg);
    if (!fs.existsSync(file)) {
      throw new Error(`Background "${bg}" is not a preset (${Object.keys(ALL_PRESETS).join(", ")}), a color, or an existing image.`);
    }
    background = { kind: "image", image: await loadImage(fs.readFileSync(file)) };
  }
  return {
    background,
    darkBackground: dark,
    padding: s.padding ?? 72,
    radius: s.radius ?? 14,
    shadow: s.shadow ?? true,
    cursor: s.cursor ?? "arrow",
    click: s.click ?? "ripple",
    cursorSize: s.cursorSize ?? 1,
    maxZoom: s.maxZoom ?? 1.9,
    autoZoom: s.autoZoom ?? true,
    captions: s.captions ?? true,
    accent: s.accent ?? "#3b82f6",
    frame: s.frame ?? "none",
    cards: s.cards ?? false,
  };
}

export function isDarkColor(c: string): boolean {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  const hex = short ? short.slice(1).map((d) => d + d).join("") : /^#([0-9a-f]{6})$/i.exec(c)?.[1];
  if (!hex) return true;
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

export function paintBackground(ctx: SKRSContext2D, bg: ResolvedStyle["background"], w: number, h: number) {
  if (bg.kind === "color") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (bg.kind === "mesh") {
    paintMesh(ctx, bg, w, h);
    return;
  }
  if (bg.kind === "glow") {
    ctx.drawImage(glowImage(bg.preset, w, h), 0, 0);
    return;
  }
  if (bg.kind === "image") {
    const img = bg.image;
    const k = Math.max(w / img.width, h / img.height);
    const iw = img.width * k,
      ih = img.height * k;
    ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    return;
  }
  const a = (bg.angle * Math.PI) / 180;
  const r = Math.hypot(w, h) / 2;
  const cx = w / 2,
    cy = h / 2;
  // CSS convention: 0deg points up, 90deg points right.
  const dx = Math.sin(a) * r,
    dy = -Math.cos(a) * r;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  bg.stops.forEach((c, i) => g.addColorStop(i / Math.max(1, bg.stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // A soft light from the top left gives the flat gradient some depth.
  const glow = ctx.createRadialGradient(w * 0.2, h * 0.1, 0, w * 0.2, h * 0.1, Math.max(w, h) * 0.8);
  glow.addColorStop(0, "rgba(255,255,255,0.18)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

/**
 * A glow preset as an image: drawn small (soft by nature), then enlarged and grained. The style
 * editor shows the same images, made by this function on its server.
 */
export function glowImage(p: GlowPreset, W: number, H: number) {
  const r = seeded(p.seed);
  const w = 480;
  const h = Math.max(1, Math.round((480 * H) / W));
  const c = createCanvas(w, h);
  const x = c.getContext("2d");
  x.fillStyle = p.base;
  x.fillRect(0, 0, w, h);
  // Broad color fields.
  x.filter = `blur(${w * 0.08}px)`;
  for (let i = 0; i < 6; i++) {
    x.fillStyle = p.palette[i % p.palette.length];
    x.globalAlpha = 0.7 + r() * 0.3;
    x.beginPath();
    x.ellipse(r() * w, r() * h, w * (0.18 + r() * 0.35), h * (0.18 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2);
    x.fill();
  }
  // Long soft bands of light along one angle, like light smeared through glass.
  const s = createCanvas(w, h);
  const sx = s.getContext("2d");
  sx.translate(w / 2, h / 2);
  sx.rotate((p.angle * Math.PI) / 180);
  sx.filter = `blur(${w * 0.022}px)`;
  for (let i = 0; i < 9; i++) {
    sx.fillStyle = p.palette[Math.floor(r() * p.palette.length)];
    sx.globalAlpha = 0.25 + r() * 0.45;
    const y = (r() - 0.5) * h * 1.6;
    const len = w * (0.7 + r() * 1.0);
    const th = h * (0.03 + r() * 0.1);
    sx.beginPath();
    sx.ellipse((r() - 0.5) * w, y, len / 2, th, 0, 0, Math.PI * 2);
    sx.fill();
  }
  x.filter = `blur(${w * 0.006}px)`;
  x.globalAlpha = 0.9;
  x.globalCompositeOperation = "soft-light";
  x.drawImage(s, 0, 0);
  x.globalCompositeOperation = "source-over";
  x.globalAlpha = 0.45;
  x.drawImage(s, 0, 0);
  x.globalAlpha = 1;
  x.filter = "none";
  const out = createCanvas(W, H);
  const o = out.getContext("2d");
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = "high";
  o.filter = `blur(${W * 0.004}px)`;
  // Slightly larger than the frame, so the blur leaves no pale edge.
  o.drawImage(c, -W * 0.02, -H * 0.02, W * 1.04, H * 1.04);
  o.filter = "none";
  const img = o.getImageData(0, 0, W, H);
  const d = img.data;
  const g = seeded(7);
  for (let i = 0; i < d.length; i += 4) {
    const n = (g() - 0.5) * 9;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  o.putImageData(img, 0, 0);
  return out;
}

/** Color fields over a base color, then grain. The editor's preview draws the same thing in CSS. */
function paintMesh(ctx: SKRSContext2D, bg: { base: string; blobs: Blob[]; grain: number }, w: number, h: number) {
  ctx.fillStyle = bg.base;
  ctx.fillRect(0, 0, w, h);
  const side = Math.max(w, h);
  for (const b of bg.blobs) {
    const cx = b.x * w,
      cy = b.y * h,
      r = b.r * side;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(b.color, b.alpha));
    g.addColorStop(0.4, rgba(b.color, b.alpha * 0.6));
    g.addColorStop(1, rgba(b.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (bg.grain > 0) {
    const tile = createCanvas(NOISE_TILE, NOISE_TILE);
    const tctx = tile.getContext("2d");
    const img = tctx.createImageData(NOISE_TILE, NOISE_TILE);
    const v = noiseValues();
    for (let i = 0; i < v.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v[i];
      img.data[i * 4 + 3] = Math.round(bg.grain * 255);
    }
    tctx.putImageData(img, 0, 0);
    const k = Math.max(1, Math.round(h / 1080));
    for (let y = 0; y < h; y += NOISE_TILE * k) for (let x = 0; x < w; x += NOISE_TILE * k) ctx.drawImage(tile, x, y, NOISE_TILE * k, NOISE_TILE * k);
  }
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

let fontsLoaded = false;
export const FONT = "Inter";

export function loadFonts() {
  if (fontsLoaded) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = [path.resolve(here, "../../assets/fonts"), path.resolve(here, "../../../assets/fonts")].find((d) => fs.existsSync(d));
  if (dir) {
    for (const f of ["Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-SemiBold.ttf", "Inter-Bold.ttf"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, FONT);
    }
  }
  fontsLoaded = true;
}

export function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, newPath = true) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (newPath) ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

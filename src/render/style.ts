import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas, type SKRSContext2D, loadImage, type Image } from "@napi-rs/canvas";
import type { Style } from "../scenario/schema.js";
import { ALL_PRESETS, DEFAULT_BACKGROUND, NOISE_TILE, noiseValues, type Blob } from "./presets.js";

/** @deprecated kept for imports; see presets.ts. */
export const PRESETS = ALL_PRESETS;

export interface ResolvedStyle {
  background:
    | { kind: "gradient"; stops: string[]; angle: number }
    | { kind: "mesh"; base: string; blobs: Blob[]; grain: number }
    | { kind: "color"; color: string }
    | { kind: "image"; image: Image };
  darkBackground: boolean;
  padding: number;
  radius: number;
  shadow: boolean;
  cursor: "macos" | "dot" | "none";
  cursorSize: number;
  maxZoom: number;
  autoZoom: boolean;
  captions: boolean;
  accent: string;
  frame: "none" | "browser";
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
    background = p.kind === "mesh" ? { kind: "mesh", base: p.base, blobs: p.blobs, grain: p.grain } : { kind: "gradient", stops: p.stops, angle: p.angle };
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
    cursor: s.cursor ?? "macos",
    cursorSize: s.cursorSize ?? 1,
    maxZoom: s.maxZoom ?? 1.9,
    autoZoom: s.autoZoom ?? true,
    captions: s.captions ?? true,
    accent: s.accent ?? "#3b82f6",
    frame: s.frame ?? "none",
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

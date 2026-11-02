import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, type SKRSContext2D, loadImage, type Image } from "@napi-rs/canvas";
import type { Style } from "../scenario/schema.js";

export const PRESETS: Record<string, { stops: string[]; angle: number; dark: boolean }> = {
  sunset: { stops: ["#fb923c", "#f43f5e", "#a21caf"], angle: 135, dark: true },
  ocean: { stops: ["#22d3ee", "#3b82f6", "#4338ca"], angle: 135, dark: true },
  lavender: { stops: ["#e9d5ff", "#c4b5fd", "#f5d0fe"], angle: 135, dark: false },
  forest: { stops: ["#34d399", "#059669", "#064e3b"], angle: 135, dark: true },
  midnight: { stops: ["#1e1b4b", "#0f172a", "#020617"], angle: 160, dark: true },
  mono: { stops: ["#f4f4f5", "#d4d4d8"], angle: 160, dark: false },
  paper: { stops: ["#fbf8f3", "#eee7dc"], angle: 160, dark: false },
};

export interface ResolvedStyle {
  background: { kind: "gradient"; stops: string[]; angle: number } | { kind: "color"; color: string } | { kind: "image"; image: Image };
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
  const bg = s.background ?? "ocean";
  let background: ResolvedStyle["background"];
  let dark = true;
  if (typeof bg === "object") {
    background = { kind: "gradient", stops: bg.gradient, angle: bg.angle ?? 135 };
    dark = bg.gradient.filter(isDarkColor).length * 2 >= bg.gradient.length;
  } else if (PRESETS[bg]) {
    background = { kind: "gradient", stops: PRESETS[bg].stops, angle: PRESETS[bg].angle };
    dark = PRESETS[bg].dark;
  } else if (/^(#|rgb|hsl)/i.test(bg)) {
    background = { kind: "color", color: bg };
    dark = isDarkColor(bg);
  } else {
    const file = path.resolve(baseDir, bg);
    if (!fs.existsSync(file)) {
      throw new Error(`Background "${bg}" is not a preset (${Object.keys(PRESETS).join(", ")}), a color, or an existing image.`);
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

/**
 * Background presets. Current ones are mesh gradients: soft color fields over a base color,
 * with a fine grain so they never band. The renderer and the style editor draw them with the
 * same numbers (blob centers in fractions of the frame, radii in fractions of its longer side),
 * so the editor's preview matches the video.
 */

export interface Blob {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
}

export interface MeshPreset {
  kind: "mesh";
  base: string;
  blobs: Blob[];
  /** Grain strength, 0 to 1 (alpha of the noise). */
  grain: number;
  dark: boolean;
}

export interface LinearPreset {
  kind: "linear";
  stops: string[];
  angle: number;
  dark: boolean;
}

/**
 * Light smeared through glass: broad color fields, then long soft bands of light along one
 * angle, blurred and grained. Drawn from a seed, so a preset always looks the same.
 */
export interface GlowPreset {
  kind: "glow";
  base: string;
  palette: string[];
  /** Direction of the bands of light, in degrees. */
  angle: number;
  seed: number;
  dark: boolean;
}

export type Preset = MeshPreset | LinearPreset | GlowPreset;

const glow = (base: string, palette: string[], angle: number, seed: number): GlowPreset => ({ kind: "glow", base, palette, angle, seed, dark: true });

/** The presets offered, in the editor's order. White card text reads on all of them. */
export const GLOW_PRESETS: Record<string, GlowPreset> = {
  dawn: glow("#6d97ff", ["#3b78fc", "#ff9cc4", "#a9c9ff", "#ffd1e3"], -20, 8),
  iris: glow("#6f76ee", ["#7f6cf3", "#4672ef", "#c6a8ff", "#e3d6ff"], -55, 9),
  citrus: glow("#b993f2", ["#f9d443", "#9a6df0", "#f7e27a", "#e9a0dd"], -35, 3),
  apricot: glow("#f6b48c", ["#ffd65c", "#ff9db7", "#ffb56e", "#fff0c2"], -40, 2),
  coral: glow("#f2704a", ["#ff6a2c", "#ff9c7c", "#ffc7ad", "#f25a3a"], -15, 11),
  blaze: glow("#e9784e", ["#ff7a2f", "#3f78f0", "#ffb38f", "#6a95f5"], -30, 5),
  cloud: glow("#5b9bff", ["#2f78ff", "#a6d4ff", "#ffffff", "#c8b9ff"], -50, 4),
  glacier: glow("#78aef5", ["#3b82f6", "#eef5ff", "#93c5fd", "#2563eb"], -30, 13),
  tide: glow("#38a7d8", ["#2ec4b6", "#3a86ff", "#8ae3e8", "#5aa0ff"], -35, 7),
  meadow: glow("#44bf68", ["#2fbf63", "#9be27c", "#169e72", "#d2f59a"], -25, 6),
};

const b = (x: number, y: number, r: number, color: string, alpha = 0.9): Blob => ({ x, y, r, color, alpha });

/** The mesh presets of 0.1.1: still drawn for scenarios that name them, no longer offered. */
export const MESH_PRESETS: Record<string, MeshPreset> = {
  aurora: {
    kind: "mesh",
    base: "#070b1a",
    blobs: [b(0.12, 0.1, 0.55, "#2dd4bf", 0.75), b(0.85, 0.2, 0.6, "#6d28d9", 0.85), b(0.55, 1.05, 0.65, "#2563eb", 0.8), b(0.95, 0.95, 0.35, "#db2777", 0.45)],
    grain: 0.05,
    dark: true,
  },
  sky: {
    kind: "mesh",
    base: "#1e40af",
    blobs: [b(0.1, 0.0, 0.6, "#38bdf8", 0.9), b(0.9, 0.15, 0.55, "#818cf8", 0.85), b(0.5, 1.0, 0.6, "#1d4ed8", 0.9), b(0.0, 0.95, 0.4, "#22d3ee", 0.6)],
    grain: 0.04,
    dark: true,
  },
  dusk: {
    kind: "mesh",
    base: "#1a0b2e",
    blobs: [b(0.15, 0.95, 0.6, "#f97316", 0.7), b(0.85, 0.85, 0.55, "#e11d48", 0.75), b(0.6, 0.0, 0.6, "#7c3aed", 0.8), b(0.05, 0.1, 0.35, "#c026d3", 0.5)],
    grain: 0.05,
    dark: true,
  },
  ember: {
    kind: "mesh",
    base: "#140806",
    blobs: [b(0.9, 0.05, 0.6, "#ea580c", 0.75), b(0.1, 1.0, 0.6, "#be123c", 0.7), b(0.55, 0.55, 0.45, "#f59e0b", 0.35)],
    grain: 0.05,
    dark: true,
  },
  graphite: {
    kind: "mesh",
    base: "#09090b",
    blobs: [b(0.2, 0.0, 0.7, "#3f3f46", 0.7), b(0.9, 1.0, 0.6, "#27272a", 0.8), b(0.8, 0.1, 0.35, "#4f46e5", 0.25)],
    grain: 0.06,
    dark: true,
  },
  lagoon: {
    kind: "mesh",
    base: "#e0f2fe",
    blobs: [b(0.05, 0.1, 0.55, "#67e8f9", 0.75), b(0.95, 0.15, 0.55, "#a5b4fc", 0.75), b(0.6, 1.05, 0.6, "#f0abfc", 0.55), b(0.1, 1.0, 0.4, "#bae6fd", 0.8)],
    grain: 0.035,
    dark: false,
  },
  lilac: {
    kind: "mesh",
    base: "#f5f3ff",
    blobs: [b(0.9, 0.05, 0.6, "#c4b5fd", 0.8), b(0.05, 0.9, 0.55, "#f9a8d4", 0.65), b(0.5, 0.5, 0.4, "#e0e7ff", 0.7), b(0.0, 0.0, 0.35, "#a5f3fc", 0.5)],
    grain: 0.035,
    dark: false,
  },
  peach: {
    kind: "mesh",
    base: "#fff4ec",
    blobs: [b(0.1, 0.05, 0.55, "#fdba74", 0.7), b(0.95, 0.3, 0.55, "#fda4af", 0.7), b(0.45, 1.05, 0.6, "#fde68a", 0.75)],
    grain: 0.035,
    dark: false,
  },
  linen: {
    kind: "mesh",
    base: "#f4f1ea",
    blobs: [b(0.15, 0.1, 0.6, "#ffffff", 0.8), b(0.9, 0.95, 0.6, "#e7e0d3", 0.9)],
    grain: 0.04,
    dark: false,
  },
};

/** The first presets: still accepted so older scenarios render as they did, but no longer offered. */
export const LEGACY_PRESETS: Record<string, LinearPreset> = {
  sunset: { kind: "linear", stops: ["#fb923c", "#f43f5e", "#a21caf"], angle: 135, dark: true },
  ocean: { kind: "linear", stops: ["#22d3ee", "#3b82f6", "#4338ca"], angle: 135, dark: true },
  lavender: { kind: "linear", stops: ["#e9d5ff", "#c4b5fd", "#f5d0fe"], angle: 135, dark: false },
  forest: { kind: "linear", stops: ["#34d399", "#059669", "#064e3b"], angle: 135, dark: true },
  midnight: { kind: "linear", stops: ["#1e1b4b", "#0f172a", "#020617"], angle: 160, dark: true },
  mono: { kind: "linear", stops: ["#f4f4f5", "#d4d4d8"], angle: 160, dark: false },
  paper: { kind: "linear", stops: ["#fbf8f3", "#eee7dc"], angle: 160, dark: false },
};

export const ALL_PRESETS: Record<string, Preset> = { ...GLOW_PRESETS, ...MESH_PRESETS, ...LEGACY_PRESETS };
export const DEFAULT_BACKGROUND = "dawn";

/** Two colors that sum up a preset, to start a custom gradient from it. */
export function presetColors(p: Preset): [string, string] {
  if (p.kind === "linear") return [p.stops[0], p.stops[p.stops.length - 1]];
  if (p.kind === "glow") return [p.palette[0], p.palette[1]];
  const [first, second] = [...p.blobs].sort((a, c) => c.alpha * c.r - a.alpha * a.r);
  return [first.color, (second ?? first).color];
}

/**
 * The grain tile: NOISE_TILE x NOISE_TILE gray values from a fixed seed, so the video and the
 * editor draw the same grain. Repeated over the frame.
 */
export const NOISE_TILE = 128;

/** The seeded random numbers both the renderer and the editor's previews use (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function noiseValues(seed = 7): Uint8Array {
  let a = seed >>> 0;
  const out = new Uint8Array(NOISE_TILE * NOISE_TILE);
  for (let i = 0; i < out.length; i++) {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) % 256;
  }
  return out;
}

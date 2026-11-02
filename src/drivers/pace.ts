import type { Point } from "../take.js";

/** Seconds the drawn cursor takes to travel between two points: quick but readable. */
export function travelDuration(from: Point, to: Point): number {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 4) return 0.15;
  return clamp(0.38 + d / 1700, 0.42, 1.05);
}

/** Per-character delays (seconds) for human-looking typing, deterministic for a seed. */
export function typingDelays(text: string, speed: number, seed: number): number[] {
  const rand = mulberry32(seed * 7919 + text.length);
  const base = 0.072 / speed;
  return Array.from(text, (ch, i) => {
    let d = base * (0.65 + rand() * 0.7);
    if (ch === " ") d *= 1.5;
    if (/[.,!?;:]/.test(ch)) d *= 2.2;
    if (i > 0 && rand() < 0.04) d += 0.18 / speed; // a short hesitation now and then
    return d;
  });
}

/** How long a card stays on screen when no duration or narration says otherwise. */
export function cardDuration(title: string, subtitle?: string): number {
  return clamp(1.6 + readingTime(`${title} ${subtitle ?? ""}`), 2.4, 6);
}

/** Seconds to read a caption comfortably. */
export function readingTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return clamp(0.6 + words * 0.32, 1.4, 12);
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

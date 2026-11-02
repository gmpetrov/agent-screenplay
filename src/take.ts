import fs from "node:fs";
import path from "node:path";
import type { StepKind } from "./scenario/schema.js";

/** A rectangle in source coordinates (CSS pixels of the filmed viewport or window). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * What happened during one step of a take. Times are seconds since the start
 * of the take, on the same clock as the captured frames.
 */
export interface TakeStep {
  index: number;
  kind: StepKind;
  label: string;
  start: number;
  end: number;
  /** The cursor starts travelling towards `point`. */
  travelStart?: number;
  /** The click happens / typing starts. */
  actionAt?: number;
  /** Typing ends. */
  actionEnd?: number;
  /** Where the cursor goes. */
  point?: Point;
  /** The element's box at action time. */
  box?: Box;
  /** Spans spent waiting (page loads, slow elements): sped up in the video. */
  waits: Array<[number, number]>;
  /** Smooth scroll spans. */
  scrolls?: Array<[number, number]>;
  /** The page navigated during this step. */
  navigated?: boolean;
  /** A title or end card, inserted at `start` (it takes no recording time). */
  card?: { kind: "title" | "end"; title: string; subtitle?: string; duration: number };
  /** Typed characters (masked when secret). */
  typed?: string;
}

export interface FramesSource {
  kind: "frames";
  /** Directory of the frame images, relative to the take directory. */
  dir: string;
  /** [time, file name] sorted by time. */
  frames: Array<[number, string]>;
}

export interface VideoSource {
  kind: "video";
  /** Video file, relative to the take directory. */
  file: string;
  fps: number;
  /** Seconds between the take clock and the video's first frame (video time = take time - offset). */
  offset: number;
  /** Region of the video that holds the filmed window, in video pixels. */
  crop: { x: number; y: number; width: number; height: number };
}

export interface Take {
  version: 1;
  name: string;
  recordedAt: string;
  platform: NodeJS.Platform;
  target: { kind: "web"; url: string } | { kind: "desktop"; app: string };
  /** Size of the filmed area in source coordinates (CSS pixels / logical points). */
  width: number;
  height: number;
  /** Pixels per source unit in the captured images. */
  scale: number;
  duration: number;
  cursorStart: Point;
  source: FramesSource | VideoSource;
  steps: TakeStep[];
}

export function writeTake(dir: string, take: Take): string {
  const file = path.join(dir, "take.json");
  fs.writeFileSync(file, JSON.stringify(take, null, 2));
  return file;
}

export function readTake(dir: string): Take {
  const file = path.join(dir, "take.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No recording found in ${dir}. Run \`screenplay record\` first.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Take;
}

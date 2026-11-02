import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import type { Take } from "../take.js";
import { ffmpegPath } from "../ffmpeg.js";

/** Gives the captured image at a recording time. Calls must come in increasing time order for video sources. */
export interface FrameSource {
  /** Image plus the region of it that holds the filmed area. */
  frameAt(s: number): Promise<{ image: Image | Canvas; sx: number; sy: number; sw: number; sh: number }>;
  close(): void;
}

export function openSource(take: Take, takeDir: string): FrameSource {
  if (take.source.kind === "frames") return new FramesReader(take, takeDir);
  return new VideoReader(take, takeDir);
}

class FramesReader implements FrameSource {
  private frames: Array<[number, string]>;
  private dir: string;
  private cacheName = "";
  private cacheImage?: Image;
  private idx = 0;

  constructor(take: Take, takeDir: string) {
    if (take.source.kind !== "frames") throw new Error("not a frames source");
    this.frames = take.source.frames;
    this.dir = path.join(takeDir, take.source.dir);
  }

  async frameAt(s: number) {
    const fr = this.frames;
    // Search from the last index; jump back with a binary search when time goes backwards.
    if (this.idx >= fr.length || fr[this.idx][0] > s) this.idx = 0;
    let lo = this.idx,
      hi = fr.length - 1,
      best = 0;
    if (fr[0][0] > s) best = 0;
    else {
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fr[mid][0] <= s) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
    }
    this.idx = best;
    const name = fr[best][1];
    if (name !== this.cacheName || !this.cacheImage) {
      this.cacheImage = await loadImage(fs.readFileSync(path.join(this.dir, name)));
      this.cacheName = name;
    }
    const img = this.cacheImage;
    return { image: img, sx: 0, sy: 0, sw: img.width, sh: img.height };
  }

  close() {}
}

/** Decodes a captured video sequentially with ffmpeg, as raw RGBA frames. */
class VideoReader implements FrameSource {
  private proc?: ChildProcessWithoutNullStreams;
  private buf: Buffer[] = [];
  private bufLen = 0;
  private frameSize: number;
  private width: number;
  private height: number;
  private fps: number;
  private offset: number;
  private crop: { x: number; y: number; width: number; height: number };
  private current = -1;
  private canvas: Canvas;
  private ended = false;
  private waiters: Array<() => void> = [];

  constructor(take: Take, takeDir: string) {
    if (take.source.kind !== "video") throw new Error("not a video source");
    const src = take.source;
    this.fps = src.fps;
    this.offset = src.offset;
    this.crop = src.crop;
    this.width = src.crop.width;
    this.height = src.crop.height;
    this.frameSize = this.width * this.height * 4;
    this.canvas = createCanvas(this.width, this.height);
    const file = path.join(takeDir, src.file);
    this.proc = spawn(ffmpegPath(), [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      `crop=${this.width}:${this.height}:${this.crop.x}:${this.crop.y},fps=${this.fps}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "pipe:1",
    ]);
    this.proc.stdout.on("data", (d: Buffer) => {
      this.buf.push(d);
      this.bufLen += d.length;
      if (this.bufLen > this.frameSize * 4) this.proc?.stdout.pause();
      this.wake();
    });
    this.proc.stdout.on("end", () => {
      this.ended = true;
      this.wake();
    });
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  private async readFrame(): Promise<Buffer | undefined> {
    while (this.bufLen < this.frameSize) {
      if (this.ended) return undefined;
      this.proc?.stdout.resume();
      await new Promise<void>((r) => this.waiters.push(r));
    }
    const all = Buffer.concat(this.buf, this.bufLen);
    const frame = all.subarray(0, this.frameSize);
    const rest = all.subarray(this.frameSize);
    this.buf = rest.length ? [Buffer.from(rest)] : [];
    this.bufLen = rest.length;
    if (this.bufLen < this.frameSize * 2) this.proc?.stdout.resume();
    return Buffer.from(frame);
  }

  async frameAt(s: number) {
    const want = Math.max(0, Math.floor((s - this.offset) * this.fps));
    while (this.current < want) {
      const data = await this.readFrame();
      if (!data) break;
      this.current++;
      if (this.current >= want - 1 || this.current === 0) {
        const ctx = this.canvas.getContext("2d");
        const img = ctx.createImageData(this.width, this.height);
        img.data.set(data);
        ctx.putImageData(img, 0, 0);
      }
    }
    return { image: this.canvas, sx: 0, sy: 0, sw: this.width, sh: this.height };
  }

  close() {
    this.proc?.kill("SIGKILL");
  }
}

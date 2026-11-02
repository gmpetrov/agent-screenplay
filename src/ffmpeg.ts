import fs from "node:fs";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
let cached: string | undefined;

/** ffmpeg to use: SCREENPLAY_FFMPEG, then the bundled ffmpeg-static, then ffmpeg on the PATH. */
export function ffmpegPath(): string {
  if (cached) return cached;
  const env = process.env.SCREENPLAY_FFMPEG;
  if (env) return (cached = env);
  try {
    const p = require("ffmpeg-static") as string | null;
    if (p && fs.existsSync(p)) return (cached = p);
  } catch {
    /* not installed */
  }
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.status === 0) return (cached = "ffmpeg");
  throw new Error("ffmpeg not found. Reinstall screenplay, or set SCREENPLAY_FFMPEG to an ffmpeg executable.");
}

/** ffmpeg for screen capture: the system one first, since static builds may lack capture devices. */
export function captureFfmpegPath(): string {
  if (process.env.SCREENPLAY_FFMPEG) return process.env.SCREENPLAY_FFMPEG;
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.status === 0) return "ffmpeg";
  return ffmpegPath();
}

export function runFfmpeg(args: string[], bin = ffmpegPath()): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-2000)}`))));
  });
}

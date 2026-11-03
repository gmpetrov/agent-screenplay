import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runFfmpeg } from "../ffmpeg.js";
import { VoiceError, wavDuration, type Clip } from "./cartesia.js";

/**
 * Any audio file (MP3, WAV, M4A…) as a cached 44.1 kHz mono WAV clip with its duration: for
 * narration a person generated elsewhere and sent back, and for providers that answer in MP3.
 */
export async function toClip(input: string | Buffer, cacheDir: string, label: string): Promise<Clip> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const bytes = typeof input === "string" ? readAudio(input, label) : input;
  const hash = crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 16);
  const file = path.join(cacheDir, `${hash}.wav`);
  if (!fs.existsSync(file)) {
    const src = path.join(cacheDir, `${hash}.src`);
    fs.writeFileSync(src, bytes);
    try {
      await runFfmpeg(["-i", src, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", `${file}.part.wav`]);
    } catch (e) {
      throw new VoiceError(`${label} is not an audio file ffmpeg can read: ${(e as Error).message.slice(0, 300)}`);
    } finally {
      fs.rmSync(src, { force: true });
    }
    fs.renameSync(`${file}.part.wav`, file);
  }
  return { file, duration: wavDuration(fs.readFileSync(file)) };
}

function readAudio(p: string, label: string): Buffer {
  if (!fs.existsSync(p)) throw new VoiceError(`${label}: ${p} does not exist.`);
  return fs.readFileSync(p);
}

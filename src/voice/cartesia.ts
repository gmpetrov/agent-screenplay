import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Voice } from "../scenario/schema.js";

const API = "https://api.cartesia.ai";
const VERSION = "2026-08-14";
const DEFAULT_MODEL = "sonic-3.6";

/** Narration voices picked for clear product walkthroughs. Other languages use Cartesia's first voice for the language. */
const DEFAULT_VOICES: Record<string, string> = {
  en: "a33f7a4c-100f-41cf-a1fd-5822e8fc253f", // Lauren: expressive narration
  fr: "7c58f4a4-a72c-42fa-a503-41b9408820f3", // Inès: corporate narration
};

export class VoiceError extends Error {}

export interface Clip {
  file: string;
  duration: number;
}

export function voiceKey(): string | undefined {
  return process.env.CARTESIA_API_KEY || undefined;
}

/** Synthesize each text (cached on disk by content), and return the clip files with their durations. */
export async function synthesizeAll(texts: Map<number, string>, voice: Voice, cacheDir: string): Promise<Map<number, Clip>> {
  // The key is only needed for sentences not generated before (they are cached by content).
  const requireKey = (): string => {
    const key = voiceKey();
    if (!key) {
      throw new VoiceError(
        "Voice-over is enabled but CARTESIA_API_KEY is not set. Set it (https://play.cartesia.ai/keys), or remove `voice.enabled`, or pass --no-voice.",
      );
    }
    return key;
  };
  fs.mkdirSync(cacheDir, { recursive: true });
  const language = voice.language ?? "en";
  const base = language.split("-")[0].toLowerCase();
  const voiceId = voice.id ?? DEFAULT_VOICES[base] ?? (await defaultVoice(language, requireKey()));
  const model = voice.model ?? DEFAULT_MODEL;
  const out = new Map<number, Clip>();
  for (const [index, text] of texts) {
    const hash = crypto
      .createHash("sha1")
      .update(JSON.stringify([model, voiceId, language, voice.speed ?? 1, text]))
      .digest("hex")
      .slice(0, 16);
    const file = path.join(cacheDir, `${hash}.wav`);
    if (!fs.existsSync(file)) {
      const key = requireKey();
      const body = {
        model_id: model,
        transcript: text,
        voice: { id: voiceId },
        language,
        output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
        ...(voice.speed ? { generation_config: { speed: voice.speed } } : {}),
      };
      const res = await fetch(`${API}/tts/bytes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": VERSION, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 400);
        throw new VoiceError(`Cartesia refused the narration of step ${index + 1} (${res.status}): ${detail}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // Write then rename, so an interrupted download never leaves a broken cached clip.
      fs.writeFileSync(`${file}.part`, buf);
      fs.renameSync(`${file}.part`, file);
    }
    out.set(index, { file, duration: wavDuration(fs.readFileSync(file)) });
  }
  return out;
}

async function defaultVoice(language: string, key: string): Promise<string> {
  const base = language.split("-")[0].toLowerCase();
  if (DEFAULT_VOICES[base]) return DEFAULT_VOICES[base];
  const res = await fetch(`${API}/voices?language=${encodeURIComponent(base)}&limit=1`, {
    headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": VERSION },
  });
  if (res.ok) {
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const id = data.data?.[0]?.id;
    if (id) return id;
  }
  throw new VoiceError(`No Cartesia voice found for language "${language}". Set voice.id in the scenario.`);
}

/** Duration of a PCM WAV file, from its header. */
export function wavDuration(buf: Buffer): number {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new VoiceError("Narration audio is not a WAV file.");
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") {
      // Streaming WAVs may carry a placeholder size: fall back to the bytes present.
      const real = Math.min(size, buf.length - off - 8);
      return byteRate ? real / byteRate : 0;
    }
    off += 8 + size + (size % 2);
  }
  return 0;
}

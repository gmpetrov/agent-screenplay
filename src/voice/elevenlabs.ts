import type { Voice } from "../scenario/schema.js";
import { VoiceError } from "./cartesia.js";

const API = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_v2";
/** George, one of ElevenLabs' premade voices; the multilingual model speaks French, German… with it. */
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

export function elevenLabsKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY || undefined;
}

/** One sentence as MP3 bytes (every plan can get MP3; raw PCM needs a paid tier). */
export async function elevenLabsSpeak(text: string, voice: Voice, key: string, step: number): Promise<Buffer> {
  const id = voice.id ?? DEFAULT_VOICE;
  const body: Record<string, unknown> = { text, model_id: voice.model ?? DEFAULT_MODEL };
  if (voice.language) body.language_code = voice.language.split("-")[0].toLowerCase();
  if (voice.speed) body.voice_settings = { speed: Math.max(0.7, Math.min(1.2, voice.speed)) };
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    throw new VoiceError(`ElevenLabs refused the narration of step ${step} (${res.status}): ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export const ELEVENLABS_DEFAULTS = { model: DEFAULT_MODEL, voice: DEFAULT_VOICE };

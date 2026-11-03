import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LoadedScenario } from "../scenario/load.js";
import type { Voice } from "../scenario/schema.js";
import { toClip } from "./audio.js";
import { cartesiaCacheFile, synthesizeAll, voiceKey, VoiceError, type Clip } from "./cartesia.js";
import { ELEVENLABS_DEFAULTS, elevenLabsKey, elevenLabsSpeak } from "./elevenlabs.js";

export type Provider = "cartesia" | "elevenlabs";

/** The provider to speak with: the scenario's choice, else the one whose key is set (Cartesia first). */
export function pickProvider(voice: Voice, env: NodeJS.ProcessEnv = process.env): Provider {
  if (voice.provider) return voice.provider;
  if (env.CARTESIA_API_KEY) return "cartesia";
  if (env.ELEVENLABS_API_KEY) return "elevenlabs";
  throw new VoiceError(
    "Voice-over is enabled but no voice key is set. Set CARTESIA_API_KEY (https://play.cartesia.ai/keys) or ELEVENLABS_API_KEY (https://elevenlabs.io/app/settings/api-keys); or give each step an `audio` file you generated elsewhere; or remove `voice.enabled` (or pass --no-voice).",
  );
}

/**
 * The narration of each step: a step's own `audio` file when it has one (no key needed), else,
 * with `voice.enabled`, its `say` text spoken by Cartesia or ElevenLabs. Cached by content.
 */
export async function narrate(
  loaded: LoadedScenario,
  opts: { noVoice?: boolean; log?: (msg: string) => void } = {},
): Promise<Map<number, Clip>> {
  const out = new Map<number, Clip>();
  if (opts.noVoice) return out;
  const cacheDir = path.join(loaded.workDir, "cache", "voice");
  const voice = loaded.scenario.voice ?? {};
  // Title and end cards are left out of the video unless style.cards: so is their narration.
  const cards = loaded.scenario.style?.cards ?? false;
  const toSpeak = new Map<number, string>();
  for (const [i, s] of loaded.scenario.steps.entries()) {
    if (!cards && ("title" in s || "end" in s)) continue;
    const step = s as { say?: string; audio?: string };
    if (step.audio) out.set(i, await toClip(path.resolve(loaded.dir, step.audio), cacheDir, `The audio of step ${i + 1}`));
    else if (voice.enabled && step.say) toSpeak.set(i, step.say);
  }
  if (toSpeak.size === 0) return out;
  // Cached clips need no key: with no key set, use the provider whose cache already holds every
  // sentence (a re-render after a style change), and only ask for a key when something is missing.
  const texts = [...toSpeak.values()];
  const provider: Provider =
    voice.provider ??
    (voiceKey()
      ? "cartesia"
      : elevenLabsKey()
        ? "elevenlabs"
        : texts.every((t) => fs.existsSync(cartesiaCacheFile(t, voice, cacheDir) ?? ""))
          ? "cartesia"
          : texts.every((t) => fs.existsSync(elevenLabsCacheFile(t, voice, cacheDir)))
            ? "elevenlabs"
            : pickProvider(voice));
  opts.log?.(`Generating narration for ${toSpeak.size} step(s)`);
  if (provider === "cartesia") {
    for (const [i, clip] of await synthesizeAll(toSpeak, voice, cacheDir)) out.set(i, clip);
    return out;
  }
  for (const [i, text] of toSpeak) {
    const mp3 = elevenLabsCacheFile(text, voice, cacheDir);
    if (!fs.existsSync(mp3)) {
      const key = elevenLabsKey();
      if (!key) throw new VoiceError("voice.provider is elevenlabs but ELEVENLABS_API_KEY is not set (https://elevenlabs.io/app/settings/api-keys).");
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(`${mp3}.part`, await elevenLabsSpeak(text, voice, key, i + 1));
      fs.renameSync(`${mp3}.part`, mp3);
    }
    out.set(i, await toClip(mp3, cacheDir, `The narration of step ${i + 1}`));
  }
  return out;
}

/** Where a sentence's ElevenLabs audio is cached. */
export function elevenLabsCacheFile(text: string, voice: Voice, cacheDir: string): string {
  const id = crypto
    .createHash("sha1")
    .update(JSON.stringify(["elevenlabs", voice.id ?? ELEVENLABS_DEFAULTS.voice, voice.model ?? ELEVENLABS_DEFAULTS.model, voice.language ?? "", voice.speed ?? 1, text]))
    .digest("hex")
    .slice(0, 16);
  return path.join(cacheDir, `el-${id}.mp3`);
}

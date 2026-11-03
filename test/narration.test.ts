import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadScenario } from "../src/scenario/load.js";
import { narrate, pickProvider } from "../src/voice/narration.js";
import { runFfmpeg } from "../src/ffmpeg.js";

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function scenario(content: object) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sp-voice-")));
  dirs.push(dir);
  const file = path.join(dir, "v.json");
  fs.writeFileSync(file, JSON.stringify({ url: "https://example.com", ...content }));
  return { dir, loaded: loadScenario(file) };
}

describe("narration", () => {
  it("picks the provider whose key is set, Cartesia first", () => {
    expect(pickProvider({}, { CARTESIA_API_KEY: "x" })).toBe("cartesia");
    expect(pickProvider({}, { ELEVENLABS_API_KEY: "x" })).toBe("elevenlabs");
    expect(pickProvider({ provider: "elevenlabs" }, { CARTESIA_API_KEY: "x" })).toBe("elevenlabs");
    expect(() => pickProvider({}, {})).toThrow(/CARTESIA_API_KEY.*ELEVENLABS_API_KEY.*audio/s);
  });

  it("uses a step's own audio file, with no key and without voice.enabled", async () => {
    const { dir, loaded } = scenario({ steps: [{ pause: 1, say: "Hello", audio: "voice/01.mp3" }, { pause: 1 }] });
    fs.mkdirSync(path.join(dir, "voice"));
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", path.join(dir, "voice", "01.mp3")]);
    const clips = await narrate(loaded);
    expect([...clips.keys()]).toEqual([0]);
    expect(clips.get(0)!.duration).toBeGreaterThan(1.4);
    expect(clips.get(0)!.duration).toBeLessThan(1.7);
  });

  it("says which keys to set when nothing can speak", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const { loaded } = scenario({ voice: { enabled: true }, steps: [{ pause: 1, say: "Hello" }] });
    await expect(narrate(loaded)).rejects.toThrow(/ELEVENLABS_API_KEY/);
  });

  it("speaks with ElevenLabs when its key is set", async () => {
    vi.stubEnv("CARTESIA_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    const { dir, loaded } = scenario({ voice: { enabled: true, language: "fr" }, steps: [{ pause: 1, say: "Bonjour" }] });
    const mp3 = path.join(dir, "tone.mp3");
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", mp3]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(fs.readFileSync(mp3), { status: 200 }));
    const clips = await narrate(loaded);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/api\.elevenlabs\.io\/v1\/text-to-speech\/.+\?output_format=mp3_44100_128/);
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ text: "Bonjour", model_id: "eleven_multilingual_v2", language_code: "fr" });
    expect(clips.get(0)!.duration).toBeGreaterThan(0.9);
    // Cached: a second run makes no request.
    await narrate(loaded);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("cards", () => {
  it("are off by default and on with style.cards", async () => {
    const { resolveStyle } = await import("../src/render/style.js");
    expect((await resolveStyle(undefined, ".")).cards).toBe(false);
    expect((await resolveStyle({ cards: true }, ".")).cards).toBe(true);
  });
});

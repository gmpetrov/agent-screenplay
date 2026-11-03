// Regressions from Cody's review of PR #7.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadScenario } from "../src/scenario/load.js";
import { narrate } from "../src/voice/narration.js";
import { cartesiaCacheFile } from "../src/voice/cartesia.js";
import { botCheck, launchBrowser } from "../src/drivers/browser.js";

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});
function scenario(content: object) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sp-r7-")));
  dirs.push(dir);
  const file = path.join(dir, "v.json");
  fs.writeFileSync(file, JSON.stringify({ url: "https://example.com", ...content }));
  return loadScenario(file);
}
function tinyWav(): Buffer {
  const wav = Buffer.alloc(46);
  wav.write("RIFF");
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt32LE(88200, 28);
  wav.write("data", 36);
  wav.writeUInt32LE(2, 40);
  return wav;
}

it("re-renders cached narration with no key set", async () => {
  vi.stubEnv("CARTESIA_API_KEY", "");
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  const loaded = scenario({ voice: { enabled: true }, steps: [{ pause: 1, say: "Hello" }] });
  const cache = path.join(loaded.workDir, "cache", "voice");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(cartesiaCacheFile("Hello", { enabled: true }, cache)!, tinyWav());
  expect((await narrate(loaded)).size).toBe(1);
});

it("does not resolve the narration of cards that are off", async () => {
  vi.stubEnv("CARTESIA_API_KEY", "");
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  const loaded = scenario({
    voice: { enabled: true },
    steps: [{ title: "Intro", audio: "removed-intro.mp3" }, { end: "Bye", say: "Goodbye" }, { pause: 1 }],
  });
  expect((await narrate(loaded)).size).toBe(0);
  // With cards on, the missing file is an error again.
  const on = scenario({ style: { cards: true }, steps: [{ title: "Intro", audio: "removed-intro.mp3" }] });
  await expect(narrate(on)).rejects.toThrow(/does not exist/);
});

it("does not take a usable page with a Turnstile widget for a bot check", async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ body: "" }));
    await page.setContent(
      `<title>Contact us</title><h1>Normal page</h1><p>${"Write to us and we answer within a day. ".repeat(10)}</p><button>About</button><iframe src="https://challenges.cloudflare.com/turnstile/v0/test" width="300" height="65"></iframe>`,
    );
    expect(await botCheck(page)).toBeUndefined();
    await page.setContent(`<title>Just a moment...</title><div id="challenge-stage"></div>`);
    expect(await botCheck(page)).toBe("Just a moment...");
    await page.setContent(`<title>example.com</title><iframe src="https://challenges.cloudflare.com/turnstile/v0/x" width="300" height="65"></iframe>`);
    expect(await botCheck(page)).toBe("example.com");
  } finally {
    await browser.close();
  }
}, 30_000);

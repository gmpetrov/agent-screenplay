import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { Recorder } from "../../src/drivers/desktop.js";
import { showIndicator } from "../../src/drivers/indicator.js";
import { ffmpegPath } from "../../src/ffmpeg.js";
import { sleep } from "../../src/drivers/web.js";

// Films the top of the screen while the recording pill is up, and checks that the pill is not in
// the video. It needs a Mac whose terminal may record the screen, so it runs only when asked.
describe.runIf(process.platform === "darwin" && process.env.SCREENPLAY_E2E_DESKTOP === "1")("recording pill on macOS", () => {
  it("is left out of the video", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "screenplay-pill-"));
    const pill = showIndicator("Screenplay is recording", () => {});
    await sleep(1500);
    const t0 = Date.now() / 1000;
    const rec = new Recorder(dir);
    // The pill sits at the top centre of the main screen, 10 points under the menu bar.
    const screen = spawnSync("osascript", ["-l", "JavaScript", "-e", 'ObjC.import("Cocoa"); const f = $.NSScreen.mainScreen.frame.size; `${f.width} ${f.height}`'], { encoding: "utf8" });
    const [sw] = screen.stdout.trim().split(" ").map(Number);
    const area = { x: Math.round(sw / 2) - 200, y: 0, width: 400, height: 120 };
    try {
      await rec.start(area, 2, t0);
      await sleep(2000);
      await rec.stop();
    } finally {
      pill.close();
    }
    expect(path.basename(rec.file)).toBe("capture.mov");
    expect(rec.startedAt).toBeGreaterThan(0);
    expect(rec.startedAt).toBeLessThan(1.5);
    // Compare the video's last frame with a still of the same area once the pill is gone (macOS
    // stills always left it out): where the pill sits, they must match.
    const still = path.join(dir, "still.png");
    spawnSync("screencapture", ["-x", "-R", [area.x, area.y, area.width, area.height].join(","), still]);
    const { width, height } = rec.crop;
    const pixels = (args: string[], x = 0, y = 0) =>
      spawnSync(ffmpegPath(), ["-v", "error", ...args, "-frames:v", "1", "-vf", `crop=${width}:${height}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], {
        maxBuffer: 64 * 1024 * 1024,
      }).stdout as Buffer;
    const video = pixels(["-sseof", "-0.3", "-i", rec.file], rec.crop.x, rec.crop.y);
    const ref = pixels(["-i", still]);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(video.length).toBe(width * height);
    expect(ref.length).toBe(width * height);
    // The pill: 36 points high, 10 points under the menu bar (at most 40 points), centred.
    let changed = 0;
    let total = 0;
    for (let y = 2 * 45; y < Math.min(height, 2 * 90); y++)
      for (let x = 2 * 80; x < width - 2 * 80; x++) {
        total++;
        if (Math.abs(video[y * width + x] - ref[y * width + x]) > 40) changed++;
      }
    expect(changed / total).toBeLessThan(0.01);
  });
});

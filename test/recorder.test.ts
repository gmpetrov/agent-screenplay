import { describe, expect, it } from "vitest";
import { parseVideoInfo } from "../src/drivers/desktop.js";

describe("screen recorder", () => {
  it("reads a screencapture video's length and size from ffmpeg's description", () => {
    const text = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'capture.mov':
  Metadata:
    major_brand     : qt
    com.apple.quicktime.author: ReplayKitRecording
  Duration: 00:01:05.15, start: 0.000000, bitrate: 3241 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1600x1000, 3236 kb/s, 49.16 fps, 120 tbr, 600 tbn (default)`;
    expect(parseVideoInfo(text)).toEqual({ duration: 65.15, width: 1600, height: 1000 });
  });

  it("finds nothing in a file ffmpeg cannot read", () => {
    expect(parseVideoInfo("capture.mov: Invalid data found when processing input")).toBeUndefined();
  });
});

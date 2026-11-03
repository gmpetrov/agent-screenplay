import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseVideoInfo, stopChild } from "../src/drivers/desktop.js";

/** A child process that has not exited yet. */
function fakeChild() {
  return Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null });
}

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

  describe("stopping the capture", () => {
    afterEach(() => vi.useRealTimers());

    it("leaves no timer behind once the capture has stopped, so Screenplay can exit", async () => {
      vi.useFakeTimers();
      const child = fakeChild();
      const force = vi.fn();
      await stopChild(child, () => child.emit("exit", 0), force, 30_000);
      expect(vi.getTimerCount()).toBe(0);
      expect(force).not.toHaveBeenCalled();
    });

    it("forces a capture that does not stop when asked", async () => {
      vi.useFakeTimers();
      const child = fakeChild();
      const force = vi.fn(() => child.emit("exit", null));
      const done = stopChild(child, () => {}, force, 30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      await done;
      expect(force).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("returns at once when the capture has already ended", async () => {
      const child = Object.assign(fakeChild(), { exitCode: 0 });
      const ask = vi.fn();
      await stopChild(child, ask, () => {}, 30_000);
      expect(ask).not.toHaveBeenCalled();
    });
  });
});

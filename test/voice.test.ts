import { describe, expect, it } from "vitest";
import { wavDuration } from "../src/voice/cartesia.js";
import { typingDelays, travelDuration } from "../src/drivers/pace.js";

function wav(seconds: number, rate = 44100): Buffer {
  const data = Buffer.alloc(Math.round(seconds * rate) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("wavDuration", () => {
  it("reads the duration from the header", () => {
    expect(wavDuration(wav(1.5))).toBeCloseTo(1.5, 3);
  });
  it("copes with a streaming placeholder size", () => {
    const b = wav(0.5);
    b.writeUInt32LE(0xffffffff, 40);
    expect(wavDuration(b)).toBeCloseTo(0.5, 3);
  });
  it("rejects non-WAV audio", () => {
    expect(() => wavDuration(Buffer.from("ID3....."))).toThrow(/not a WAV/);
  });
});

describe("pace", () => {
  it("types deterministically, slower on spaces and punctuation", () => {
    const a = typingDelays("Hi there.", 1, 3);
    expect(a).toEqual(typingDelays("Hi there.", 1, 3));
    expect(a).toHaveLength(9);
    expect(Math.min(...a)).toBeGreaterThan(0.03);
  });
  it("travels longer distances a little slower, within bounds", () => {
    const near = travelDuration({ x: 0, y: 0 }, { x: 50, y: 0 });
    const far = travelDuration({ x: 0, y: 0 }, { x: 1400, y: 800 });
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(1.05);
  });
});

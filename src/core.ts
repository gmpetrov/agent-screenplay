import fs from "node:fs";
import path from "node:path";
import { loadScenario, type LoadedScenario } from "./scenario/load.js";
import { runWeb, type CheckReport } from "./drivers/web.js";
import { readingTime } from "./drivers/pace.js";
import { readTake, writeTake, type Take } from "./take.js";
import { captureInputs } from "./scenario/fingerprint.js";
import { renderTake, type RenderResult } from "./render/render.js";
import { synthesizeAll, type Clip } from "./voice/cartesia.js";

export interface RunOptions {
  /** Force the voice-over off (true) regardless of the scenario. */
  noVoice?: boolean;
  gif?: boolean;
  log?: (msg: string) => void;
}

export interface RecordResult extends RenderResult {
  take: string;
  steps: number;
}

async function narration(loaded: LoadedScenario, opts: RunOptions): Promise<Map<number, Clip>> {
  const voice = loaded.scenario.voice;
  if (!voice?.enabled || opts.noVoice) return new Map();
  const texts = new Map<number, string>();
  loaded.scenario.steps.forEach((s, i) => {
    const say = (s as { say?: string }).say;
    if (say) texts.set(i, say);
  });
  if (texts.size === 0) return new Map();
  opts.log?.(`Generating narration for ${texts.size} step(s)`);
  return synthesizeAll(texts, voice, path.join(loaded.workDir, "cache", "voice"));
}

/** How long each step must last so its narration or caption can be heard or read. */
function minDurations(loaded: LoadedScenario, audio: Map<number, Clip>): number[] {
  const captions = loaded.scenario.style?.captions ?? true;
  return loaded.scenario.steps.map((s, i) => {
    const a = audio.get(i);
    if (a) return a.duration + 0.35;
    const say = (s as { say?: string }).say;
    return say && captions ? readingTime(say) : 0;
  });
}

export async function record(file: string, opts: RunOptions = {}): Promise<RecordResult> {
  const loaded = loadScenario(file);
  const audio = await narration(loaded, opts);
  let take: Take;
  if (loaded.scenario.url) {
    const res = await runWeb(loaded, { mode: "record", minDurations: minDurations(loaded, audio), log: opts.log });
    take = res.take!;
  } else {
    const { runDesktop } = await import("./drivers/desktop.js");
    take = await runDesktop(loaded, { mode: "record", minDurations: minDurations(loaded, audio), log: opts.log });
  }
  take.inputs = captureInputs(loaded.scenario);
  const takeFile = writeTake(loaded.takeDir, take);
  opts.log?.("Editing the video");
  const result = await renderTake(loaded, take, { audio, gif: opts.gif, log: opts.log });
  return { ...result, take: takeFile, steps: take.steps.length };
}

export async function render(file: string, opts: RunOptions = {}): Promise<RenderResult> {
  const loaded = loadScenario(file);
  const take = readTake(loaded.takeDir);
  const audio = await narration(loaded, opts);
  return renderTake(loaded, take, { audio, gif: opts.gif, log: opts.log });
}

export async function check(file: string, opts: RunOptions = {}): Promise<CheckReport> {
  const loaded = loadScenario(file);
  if (loaded.scenario.url) {
    const res = await runWeb(loaded, { mode: "check", log: opts.log });
    return res.check!;
  }
  const { checkDesktop } = await import("./drivers/desktop.js");
  return checkDesktop(loaded, { log: opts.log });
}

export function takeExists(file: string): boolean {
  const loaded = loadScenario(file, { env: false });
  return fs.existsSync(path.join(loaded.takeDir, "take.json"));
}

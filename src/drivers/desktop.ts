import type { LoadedScenario } from "../scenario/load.js";
import type { Take } from "../take.js";
import type { CheckReport } from "./web.js";

export interface DesktopRunOptions {
  mode: "record";
  minDurations?: number[];
  log?: (msg: string) => void;
}

export async function runDesktop(_loaded: LoadedScenario, _opts: DesktopRunOptions): Promise<Take> {
  throw new Error("Desktop recording is not available yet in this build.");
}

export async function checkDesktop(_loaded: LoadedScenario, _opts: { log?: (msg: string) => void }): Promise<CheckReport> {
  throw new Error("Desktop recording is not available yet in this build.");
}

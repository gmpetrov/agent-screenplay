import crypto from "node:crypto";
import { describeStep, stepKind, type Scenario } from "./schema.js";

/**
 * What a recording depends on. Editing-only fields (narration, captions,
 * callout text, card text, zoom, style, voice, output) are left out, so they
 * can change and be re-rendered without filming again; anything else that
 * changes (a target, typed text, a wait, a hold) needs a new recording.
 */
const EDITORIAL_KEYS = new Set(["say", "zoom", "text"]);
const CARD_KEYS = new Set(["title", "end", "subtitle", "duration", "say"]);

export function captureInputs(scenario: Scenario): { setup: string; steps: string[] } {
  const setup = JSON.stringify([
    scenario.url ?? null,
    scenario.app ?? null,
    scenario.viewport ?? null,
    scenario.scale ?? null,
    scenario.colorScheme ?? null,
    scenario.locale ?? null,
    scenario.auth ?? null,
    scenario.hideScrollbars ?? null,
    scenario.typingSpeed ?? null,
    // Appended only when set, so takes recorded before these options existed keep their fingerprint.
    ...(scenario.screen || scenario.hideOthers ? [scenario.screen ?? null, scenario.hideOthers ?? null] : []),
  ]);
  const steps = scenario.steps.map((step) => {
    const kind = stepKind(step);
    const skip = kind === "title" || kind === "end" ? CARD_KEYS : EDITORIAL_KEYS;
    const kept = Object.entries(step)
      .filter(([k]) => !skip.has(k))
      .sort(([a], [b]) => a.localeCompare(b));
    return hash(JSON.stringify([kind, kept]));
  });
  return { setup: hash(setup), steps };
}

function hash(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

/** Why the scenario cannot be re-rendered from a take, or undefined when it can. */
export function captureMismatch(
  scenario: Scenario,
  recorded: { setup: string; steps: string[] } | undefined,
  recordedKinds: string[],
): string | undefined {
  const now = captureInputs(scenario);
  if (scenario.steps.length !== recordedKinds.length) {
    return `the scenario has ${scenario.steps.length} steps and the recording ${recordedKinds.length}`;
  }
  for (let i = 0; i < scenario.steps.length; i++) {
    if (stepKind(scenario.steps[i]) !== recordedKinds[i]) return `step ${i + 1} (${describeStep(scenario.steps[i])}) changed`;
  }
  if (!recorded) return undefined; // takes from before fingerprints: kinds are all we can compare
  if (recorded.setup !== now.setup) return "the page, app, screen mode, viewport, session or typing speed changed";
  for (let i = 0; i < now.steps.length; i++) {
    if (recorded.steps[i] !== now.steps[i]) return `step ${i + 1} (${describeStep(scenario.steps[i])}) changed`;
  }
  return undefined;
}

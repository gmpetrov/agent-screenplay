import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Scenario } from "./schema.js";

export interface LoadedScenario {
  scenario: Scenario;
  /** Absolute path of the scenario file. */
  file: string;
  /** Directory of the scenario file. */
  dir: string;
  /** Video name: scenario.name or the file name without extension. */
  name: string;
  /** Working directory for takes and caches: <dir>/.screenplay */
  workDir: string;
  /** Directory of the latest take of this scenario. */
  takeDir: string;
  outputs: { mp4: string; gif: string; storyboard: string };
}

export class ScenarioError extends Error {}

const ENV_RE = /\$\{([A-Z0-9_]+)\}/g;

/** Replace ${VAR} with environment values in every string of the scenario. */
export function substituteEnv<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === "string") {
    return value.replace(ENV_RE, (_, name: string) => {
      const v = env[name];
      if (v === undefined) throw new ScenarioError(`Environment variable ${name} is not set (used as \${${name}} in the scenario).`);
      return v;
    }) as T;
  }
  if (Array.isArray(value)) return value.map((v) => substituteEnv(v, env)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteEnv(v, env);
    return out as T;
  }
  return value;
}

export function formatZodError(err: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `- ${i.path.length ? i.path.map(String).join(".") : "(scenario)"}: ${i.message}`)
    .join("\n");
}

export function parseScenario(raw: unknown): Scenario {
  const result = Scenario.safeParse(raw);
  if (!result.success) {
    throw new ScenarioError(`The scenario is not valid:\n${formatZodError(result.error)}\nRun \`screenplay schema\` for the full format.`);
  }
  return result.data;
}

export function loadScenario(file: string, opts: { env?: boolean } = {}): LoadedScenario {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new ScenarioError(`Scenario not found: ${abs}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    throw new ScenarioError(`The scenario is not valid JSON: ${(e as Error).message}`);
  }
  let scenario = parseScenario(raw);
  if (opts.env !== false) scenario = substituteEnv(scenario);
  const dir = path.dirname(abs);
  // A url without a scheme is a local file, relative to the scenario.
  if (scenario.url && !/^[a-z][a-z0-9+.-]*:/i.test(scenario.url)) {
    scenario = { ...scenario, url: pathToFileURL(path.resolve(dir, scenario.url)).toString() };
  }
  const base = path.basename(abs).replace(/\.json$/i, "").replace(/\.screenplay$/i, "");
  const name = scenario.name ?? base;
  const slug = slugify(name);
  const workDir = path.join(dir, ".screenplay");
  const mp4 = scenario.output?.path ? path.resolve(dir, scenario.output.path) : path.join(dir, `${slug}.mp4`);
  const stem = mp4.replace(/\.mp4$/i, "");
  return {
    scenario,
    file: abs,
    dir,
    name,
    workDir,
    takeDir: path.join(workDir, "takes", slug),
    outputs: { mp4, gif: `${stem}.gif`, storyboard: `${stem}.storyboard.png` },
  };
}

export function slugify(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "screenplay"
  );
}

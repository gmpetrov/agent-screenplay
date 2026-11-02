import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Style } from "./schema.js";

/**
 * A project's shared settings: `screenplay.config.json`, found in the scenario's
 * directory or the nearest parent. Its style applies to every video below it; a
 * scenario's own `style` wins, setting by setting.
 */
export const CONFIG_FILE = "screenplay.config.json";

export const ProjectConfig = z
  .object({
    $schema: z.string().optional(),
    style: Style.optional(),
  })
  .strict();
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export function findProjectConfig(dir: string): string | undefined {
  let d = path.resolve(dir);
  while (true) {
    const f = path.join(d, CONFIG_FILE);
    if (fs.existsSync(f)) return f;
    const up = path.dirname(d);
    if (up === d) return undefined;
    d = up;
  }
}

export function readProjectConfig(file: string): ProjectConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${(e as Error).message}`);
  }
  const r = ProjectConfig.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `- ${i.path.map(String).join(".") || "(file)"}: ${i.message}`).join("\n");
    throw new Error(`${file} is not valid:\n${issues}`);
  }
  return r.data;
}

/** True when a background value names an image file rather than a preset or a color. */
export function isImagePath(bg: unknown, presets: readonly string[]): bg is string {
  return typeof bg === "string" && !presets.includes(bg) && !/^(#|rgb|hsl)/i.test(bg);
}

/** Make an image background absolute, so it still resolves once merged into a scenario elsewhere. */
export function absolutizeStyle(style: Style | undefined, baseDir: string, presets: readonly string[]): Style | undefined {
  if (!style) return style;
  if (isImagePath(style.background, presets) && !path.isAbsolute(style.background)) {
    return { ...style, background: path.resolve(baseDir, style.background) };
  }
  return style;
}

/** The project's style under the scenario's, setting by setting. */
export function mergeStyles(project: Style | undefined, scenario: Style | undefined): Style | undefined {
  if (!project) return scenario;
  if (!scenario) return project;
  const out: Record<string, unknown> = { ...project };
  for (const [k, v] of Object.entries(scenario)) if (v !== undefined) out[k] = v;
  return out as Style;
}

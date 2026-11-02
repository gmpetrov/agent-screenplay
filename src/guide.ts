import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The package root (works from src/ under tsx and from dist/). */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "skills"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Screenplay's package files are missing (skills/).");
}

export function skillFile(): string {
  return path.join(packageRoot(), "skills", "screenplay", "SKILL.md");
}

/** The agent guide: the skill without its front matter. */
export function guideText(): string {
  const raw = fs.readFileSync(skillFile(), "utf8");
  return raw.replace(/^---[\s\S]*?---\s*/, "");
}

export function schemaText(): string {
  return fs.readFileSync(path.join(packageRoot(), "schema", "scenario.schema.json"), "utf8");
}

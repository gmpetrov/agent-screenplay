import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("version", () => {
  it("matches package.json, which the release workflow checks against the tag", () => {
    expect(VERSION).toBe(JSON.parse(fs.readFileSync("package.json", "utf8")).version);
  });
});

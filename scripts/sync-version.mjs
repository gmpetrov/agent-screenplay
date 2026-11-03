// Run by `npm version`: writes the new version into src/version.ts, so the CLI and the
// package always say the same version.
import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const file = new URL("../src/version.ts", import.meta.url);
fs.writeFileSync(file, `export const VERSION = "${version}";\n`);
console.log(`src/version.ts -> ${version}`);

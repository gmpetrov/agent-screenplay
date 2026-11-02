// Writes schema/scenario.schema.json from the zod schema, for editors and agents.
import fs from "node:fs";
import { z } from "zod";
import { Scenario } from "../dist/scenario/schema.js";
const schema = z.toJSONSchema(Scenario, { target: "draft-7", unrepresentable: "any" });
schema.$id = "https://raw.githubusercontent.com/gmpetrov/agent-screenplay/main/schema/scenario.schema.json";
schema.title = "Screenplay scenario";
fs.mkdirSync("schema", { recursive: true });
fs.writeFileSync("schema/scenario.schema.json", JSON.stringify(schema, null, 2) + "\n");
console.log("schema/scenario.schema.json written");

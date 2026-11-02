import { describe, expect, it } from "vitest";
import { captureInputs, captureMismatch } from "../src/scenario/fingerprint.js";
import { parseScenario } from "../src/scenario/load.js";

const base = {
  url: "https://example.com",
  steps: [
    { title: "Old title", subtitle: "Old", duration: 3 },
    { click: "role=button[name='Save']", say: "Save it" },
    { callout: "text=Saved", text: "Done", duration: 2 },
    { end: "Bye" },
  ],
};
const kinds = ["title", "click", "callout", "end"];
const recorded = captureInputs(parseScenario(base));

function edit(fn: (s: any) => void) {
  const s = structuredClone(base);
  fn(s);
  return parseScenario(s);
}

describe("captureMismatch", () => {
  it("accepts editing-only changes", () => {
    const s = edit((s) => {
      s.steps[0].title = "New title";
      s.steps[0].subtitle = "New";
      s.steps[0].duration = 1;
      s.steps[1].say = "Now save";
      s.steps[1].zoom = false;
      s.steps[2].text = "All done";
      s.style = { background: "midnight" };
      s.voice = { enabled: true };
    });
    expect(captureMismatch(s, recorded, kinds)).toBeUndefined();
  });

  it("refuses a different target in the same kind of step", () => {
    const s = edit((s) => (s.steps[1].click = "role=button[name='Delete']"));
    expect(captureMismatch(s, recorded, kinds)).toMatch(/step 2/);
  });

  it("refuses a different recorded duration or page", () => {
    expect(captureMismatch(edit((s) => (s.steps[2].duration = 5)), recorded, kinds)).toMatch(/step 3/);
    expect(captureMismatch(edit((s) => (s.url = "https://other.example")), recorded, kinds)).toMatch(/page/);
  });

  it("refuses added or reordered steps, even for old takes without inputs", () => {
    expect(captureMismatch(edit((s) => s.steps.push({ pause: 1 })), undefined, kinds)).toMatch(/steps/);
    expect(captureMismatch(edit((s) => s.steps.reverse()), undefined, kinds)).toMatch(/step 1/);
  });
});

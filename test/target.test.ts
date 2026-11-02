import { describe, expect, it } from "vitest";
import { parseTarget } from "../src/scenario/target.js";
import { findArgs, normalizeCombo } from "../src/drivers/desktop.js";

describe("parseTarget", () => {
  it("reads every prefix", () => {
    expect(parseTarget("text=Save")).toEqual({ kind: "text", text: "Save" });
    expect(parseTarget("Save")).toEqual({ kind: "text", text: "Save" });
    expect(parseTarget("role=button[name='Take over']")).toEqual({ kind: "role", role: "button", name: "Take over" });
    expect(parseTarget('role=link[name="Pricing"]')).toEqual({ kind: "role", role: "link", name: "Pricing" });
    expect(parseTarget("role=textbox")).toEqual({ kind: "role", role: "textbox", name: undefined });
    expect(parseTarget("label=Email")).toEqual({ kind: "label", text: "Email" });
    expect(parseTarget("placeholder='Search'")).toEqual({ kind: "placeholder", text: "Search" });
    expect(parseTarget("testid=save")).toEqual({ kind: "testid", id: "save" });
    expect(parseTarget("css=.a > b")).toEqual({ kind: "css", selector: ".a > b" });
    expect(parseTarget("at=10, 20")).toEqual({ kind: "at", x: 10, y: 20 });
  });

  it("keeps an equals sign inside text", () => {
    expect(parseTarget("text=a=b")).toEqual({ kind: "text", text: "a=b" });
  });

  it("rejects malformed roles and coordinates", () => {
    expect(() => parseTarget("role=button[name=Save]")).toThrow(/Invalid role/);
    expect(() => parseTarget("at=1")).toThrow(/at=x,y/);
  });
});

describe("desktop translation", () => {
  it("maps targets to agent-desktop find", () => {
    expect(findArgs("Notes", "role=button[name='Save']")).toEqual(["find", "--app", "Notes", "--role", "button", "--name", "Save", "--exact", "--first"]);
    expect(findArgs("Notes", "text=Hello")).toEqual(["find", "--app", "Notes", "--name", "Hello", "--first"]);
    expect(() => findArgs("Notes", "css=.x")).toThrow(/websites only/);
  });

  it("normalizes key combos", () => {
    expect(normalizeCombo("Control+Enter")).toBe("ctrl+return");
    expect(normalizeCombo("Escape")).toBe("escape");
    expect(normalizeCombo("Meta+K")).toBe(process.platform === "darwin" ? "cmd+k" : "super+k");
  });
});

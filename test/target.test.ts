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
    expect(findArgs("Notes", "text=Hello", "w-42")).toEqual(["find", "--app", "Notes", "--window-id", "w-42", "--name", "Hello", "--first"]);
  });

  it("normalizes key combos", () => {
    expect(normalizeCombo("Control+Enter")).toBe("ctrl+return");
    expect(normalizeCombo("Escape")).toBe("escape");
    expect(normalizeCombo("Meta+K")).toBe(process.platform === "darwin" ? "cmd+k" : "super+k");
  });
});

describe("looseText", () => {
  it("matches whatever the apostrophes, quotes, dashes and spaces", async () => {
    const { looseText } = await import("../src/drivers/web.js");
    expect(looseText("J'accepte").test("J’accepte")).toBe(true);
    expect(looseText('Say "hi" — now').test("say «hi» -  now")).toBe(true);
    expect(looseText("a.b (c)").test("a.b (c)")).toBe(true);
    expect(looseText("a.b").test("axb")).toBe(false);
  });
});

describe("css targets copied from check", () => {
  it("drop the shown text", async () => {
    const { parseTarget } = await import("../src/scenario/target.js");
    expect(parseTarget(`css=button.cookies (shows "J'accepte")`)).toEqual({ kind: "css", selector: "button.cookies" });
  });
});

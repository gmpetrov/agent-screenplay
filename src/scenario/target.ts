export type ParsedTarget =
  | { kind: "text"; text: string }
  | { kind: "role"; role: string; name?: string }
  | { kind: "label"; text: string }
  | { kind: "placeholder"; text: string }
  | { kind: "testid"; id: string }
  | { kind: "css"; selector: string }
  | { kind: "at"; x: number; y: number };

const ROLE_RE = /^([a-z]+)(?:\[name=(['"])(.*)\2\])?$/i;

/** Parse "text=…", "role=button[name='…']", "label=…", "placeholder=…", "testid=…", "css=…", "at=x,y". */
export function parseTarget(input: string): ParsedTarget {
  const s = input.trim();
  const eq = s.indexOf("=");
  const prefix = eq > 0 ? s.slice(0, eq).toLowerCase() : "";
  const rest = eq > 0 ? s.slice(eq + 1).trim() : s;
  switch (prefix) {
    case "text":
      return { kind: "text", text: unquote(rest) };
    case "role": {
      const m = ROLE_RE.exec(rest);
      if (!m) throw new Error(`Invalid role target "${input}". Use role=button or role=button[name='Save'].`);
      return { kind: "role", role: m[1].toLowerCase(), name: m[3] };
    }
    case "label":
      return { kind: "label", text: unquote(rest) };
    case "placeholder":
      return { kind: "placeholder", text: unquote(rest) };
    case "testid":
      return { kind: "testid", id: unquote(rest) };
    case "css":
      return { kind: "css", selector: rest };
    case "at": {
      const [x, y] = rest.split(",").map((v) => Number(v.trim()));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Invalid target "${input}". Use at=x,y.`);
      return { kind: "at", x, y };
    }
    default:
      return { kind: "text", text: unquote(s) };
  }
}

function unquote(s: string): string {
  if (s.length >= 2 && (s[0] === "'" || s[0] === '"') && s[s.length - 1] === s[0]) return s.slice(1, -1);
  return s;
}

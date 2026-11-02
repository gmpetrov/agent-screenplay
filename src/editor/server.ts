import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { render } from "../core.js";
import { CONFIG_FILE, findProjectConfig, isImagePath, readProjectConfig } from "../scenario/config.js";
import { loadScenario } from "../scenario/load.js";
import { BACKGROUNDS, Style, type Style as StyleT } from "../scenario/schema.js";
import { readTake, type Take } from "../take.js";
import { openSource } from "../render/sources.js";
import { ALL_PRESETS, DEFAULT_BACKGROUND, MESH_PRESETS, presetColors } from "../render/presets.js";
import { defaultViewport } from "../drivers/web.js";

/**
 * `screenplay style`: a local page to set the look of the videos (background,
 * padding, corners, shadow) on a real frame of the recording, then save it to the
 * scenario or to the whole project, and render.
 */

/** The settings the editor changes; a style's other settings are kept as they are. */
export const EDITED = ["background", "padding", "radius", "shadow"] as const;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

export interface EditorOptions {
  port?: number;
  open?: boolean;
  log?: (msg: string) => void;
}

export interface EditorHandle {
  url: string;
  close(): Promise<void>;
}

export async function startStyleEditor(file: string, opts: EditorOptions = {}): Promise<EditorHandle> {
  const log = opts.log ?? (() => {});
  const scenarioFile = path.resolve(file);
  const loaded = loadScenario(scenarioFile, { env: false });
  const token = crypto.randomBytes(16).toString("hex");
  const page = fs.readFileSync(editorPage(), "utf8");
  let rendering: Promise<unknown> | undefined;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        if (url.searchParams.get("t") !== token) return send(res, 403, "text/plain", "Open the link printed by `screenplay style`.");
        return send(res, 200, "text/html; charset=utf-8", page.replace("__TOKEN__", token));
      }
      // Every other route needs the token, so another site open in the browser cannot read or write files.
      if (req.headers["x-token"] !== token && url.searchParams.get("t") !== token) return send(res, 403, "text/plain", "forbidden");

      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, state(scenarioFile));
      if (req.method === "GET" && url.pathname === "/api/frame") {
        const jpg = await previewFrame(scenarioFile);
        return jpg ? send(res, 200, "image/jpeg", jpg) : send(res, 404, "text/plain", "no recording yet");
      }
      if (req.method === "GET" && url.pathname === "/api/image") {
        const p = imagePathFor(scenarioFile, url.searchParams.get("path") ?? "", url.searchParams.get("from") ?? "scenario");
        if (!p) return send(res, 404, "text/plain", "not found");
        return send(res, 200, mime(p), fs.readFileSync(p));
      }
      if (req.method === "POST" && url.pathname === "/api/upload") {
        const name = String(req.headers["x-filename"] ?? "background.png");
        const body = await readBody(req, 30 * 1024 * 1024);
        return json(res, 200, saveUpload(scenarioFile, name, body));
      }
      if (req.method === "POST" && url.pathname === "/api/save") {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8")) as { target: "scenario" | "project"; style: StyleT };
        const saved = saveStyle(scenarioFile, body.target, body.style);
        log(`Saved the style to ${saved}`);
        return json(res, 200, { ok: true, file: saved, state: state(scenarioFile) });
      }
      if (req.method === "POST" && url.pathname === "/api/render") {
        if (!readTakeSafe(scenarioFile)) return json(res, 409, { ok: false, error: "Record the scenario first: `screenplay record`." });
        rendering ??= render(scenarioFile, { log }).finally(() => (rendering = undefined));
        const r = (await rendering) as { mp4: string; duration: number };
        return json(res, 200, { ok: true, mp4: r.mp4, duration: r.duration, at: Date.now() });
      }
      if (req.method === "GET" && url.pathname === "/api/video") {
        const mp4 = loadScenario(scenarioFile, { env: false }).outputs.mp4;
        if (!fs.existsSync(mp4)) return send(res, 404, "text/plain", "no video yet");
        return streamFile(req, res, mp4, "video/mp4");
      }
      send(res, 404, "text/plain", "not found");
    } catch (e) {
      json(res, 400, { ok: false, error: (e as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  log(`Style editor for ${loaded.name}: ${url}`);
  if (opts.open !== false) openBrowser(url);
  return {
    url,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** What the page needs: the styles as written, the video's size and the presets. */
export function state(scenarioFile: string) {
  const loaded = loadScenario(scenarioFile, { env: false });
  const raw = JSON.parse(fs.readFileSync(scenarioFile, "utf8")) as { style?: StyleT; output?: { width?: number; height?: number } };
  const configFile = findProjectConfig(path.dirname(scenarioFile));
  const project = configFile ? (readProjectConfig(configFile).style ?? {}) : {};
  const take = readTakeSafe(scenarioFile);
  return {
    name: loaded.name,
    scenarioFile,
    configFile: configFile ?? path.join(path.dirname(scenarioFile), CONFIG_FILE),
    configExists: Boolean(configFile),
    // Image backgrounds as absolute paths: each file's are relative to its own folder, and the
    // page may save one to the other file.
    scenarioStyle: absoluteImage(pick(raw.style ?? {}), path.dirname(scenarioFile)),
    projectStyle: absoluteImage(pick(project), configFile ? path.dirname(configFile) : path.dirname(scenarioFile)),
    /** Style settings that the editor does not change but that show in the preview. */
    frame: loaded.scenario.style?.frame ?? "none",
    url: loaded.scenario.url ?? null,
    output: { width: raw.output?.width ?? 1920, height: raw.output?.height ?? 1080 },
    defaultViewport: defaultViewport(loaded.scenario.output),
    capture: take ? { width: take.width, height: take.height } : loaded.scenario.url ? (loaded.scenario.viewport ?? defaultViewport(loaded.scenario.output)) : null,
    hasTake: Boolean(take),
    hasVideo: fs.existsSync(loaded.outputs.mp4),
    /** Every preset the page may have to draw, and the ones it offers. */
    presets: Object.fromEntries(Object.entries(ALL_PRESETS).map(([k, p]) => [k, { ...p, colors: presetColors(p) }])),
    offered: Object.keys(MESH_PRESETS),
    defaults: { background: DEFAULT_BACKGROUND, padding: 72, radius: 14, shadow: true },
  };
}

function pick(style: StyleT): Partial<StyleT> {
  const out: Record<string, unknown> = {};
  for (const k of EDITED) if ((style as Record<string, unknown>)[k] !== undefined) out[k] = (style as Record<string, unknown>)[k];
  return out as Partial<StyleT>;
}

/**
 * Write the edited settings (an image path in them is absolute, or relative to the scenario's
 * folder). To the scenario: into its `style`. To the project: into
 * screenplay.config.json, and out of this scenario's `style`, which would otherwise win
 * over the project's and hide the change in this video.
 */
export function saveStyle(scenarioFile: string, target: "scenario" | "project", edited: StyleT): string {
  const values = pick(edited);
  const check = Style.safeParse(values);
  if (!check.success) throw new Error(`Invalid style: ${check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const raw = JSON.parse(fs.readFileSync(scenarioFile, "utf8")) as Record<string, unknown> & { style?: Record<string, unknown> };
  const scenarioDir = path.dirname(scenarioFile);
  if (target === "scenario") {
    raw.style = { ...(raw.style ?? {}), ...relativeImage(values, scenarioDir, scenarioDir) };
    writeJson(scenarioFile, raw);
    return scenarioFile;
  }
  const configFile = findProjectConfig(scenarioDir) ?? path.join(scenarioDir, CONFIG_FILE);
  const config = fs.existsSync(configFile) ? (JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>) : {};
  config.style = { ...((config.style as Record<string, unknown>) ?? {}), ...relativeImage(values, scenarioDir, path.dirname(configFile)) };
  writeJson(configFile, config);
  if (raw.style) {
    for (const k of EDITED) delete raw.style[k];
    if (Object.keys(raw.style).length === 0) delete raw.style;
    writeJson(scenarioFile, raw);
  }
  return configFile;
}

function absoluteImage(style: Partial<StyleT>, dir: string): Partial<StyleT> {
  return isImagePath(style.background, BACKGROUNDS) ? { ...style, background: path.resolve(dir, style.background) } : style;
}

/**
 * Image paths are stored relative to the file that holds them, so the project can move.
 * `from` is the folder a relative path in `style` is relative to.
 */
function relativeImage(style: Partial<StyleT>, from: string, to: string): Partial<StyleT> {
  if (!isImagePath(style.background, BACKGROUNDS)) return style;
  const abs = path.resolve(from, style.background);
  return { ...style, background: path.relative(to, abs).split(path.sep).join("/") };
}

/** An uploaded background goes next to the scenario, in screenplay-assets/. */
export function saveUpload(scenarioFile: string, name: string, body: Buffer): { path: string } {
  const ext = (path.extname(name).toLowerCase().match(IMAGE_EXT) ? path.extname(name).toLowerCase() : "") || sniffExt(body);
  if (!ext) throw new Error("Use a PNG, JPEG or WebP image.");
  const base = path.basename(name, path.extname(name)).replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "background";
  const dir = path.join(path.dirname(scenarioFile), "screenplay-assets");
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash("sha1").update(body).digest("hex").slice(0, 6);
  const out = path.join(dir, `${base}-${hash}${ext}`);
  fs.writeFileSync(out, body);
  return { path: out };
}

function sniffExt(b: Buffer): string {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (b[0] === 0xff && b[1] === 0xd8) return ".jpg";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return ".webp";
  return "";
}

/**
 * The image a background names: only an image file inside the scenario's or the project's
 * folder, or the background the scenario or the project already sets. Never any other file.
 */
function imagePathFor(scenarioFile: string, p: string, from: string): string | undefined {
  if (!p || !IMAGE_EXT.test(p)) return undefined;
  const scenarioDir = path.dirname(scenarioFile);
  const configFile = findProjectConfig(scenarioDir);
  const projectDir = configFile ? path.dirname(configFile) : scenarioDir;
  const abs = path.resolve(from === "project" ? projectDir : scenarioDir, p);
  const inside = (dir: string) => abs === dir || abs.startsWith(dir + path.sep);
  const s = state(scenarioFile);
  const named = [s.scenarioStyle.background, s.projectStyle.background];
  if (!inside(scenarioDir) && !inside(projectDir) && !named.includes(abs)) return undefined;
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : undefined;
}

function readTakeSafe(scenarioFile: string): Take | undefined {
  try {
    return readTake(loadScenario(scenarioFile, { env: false }).takeDir);
  } catch {
    return undefined;
  }
}

/** A frame of the recording, as filmed (no background, no zoom), shortly after its first action. */
export async function previewFrame(scenarioFile: string): Promise<Buffer | undefined> {
  const loaded = loadScenario(scenarioFile, { env: false });
  const take = readTakeSafe(scenarioFile);
  if (!take) return undefined;
  const first = take.steps.find((s) => s.actionAt !== undefined && !s.card);
  const t = Math.min(take.duration, (first?.actionEnd ?? first?.actionAt ?? take.duration / 2) + 0.6);
  const src = openSource(take, loaded.takeDir);
  try {
    const f = await src.frameAt(t);
    const c = createCanvas(f.sw, f.sh);
    c.getContext("2d").drawImage(f.image, f.sx, f.sy, f.sw, f.sh, 0, 0, f.sw, f.sh);
    return c.encode("jpeg", 88);
  } finally {
    src.close();
  }
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function editorPage(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const p = [path.resolve(here, "../../assets/editor/index.html"), path.resolve(here, "../../../assets/editor/index.html")].find((f) => fs.existsSync(f));
  if (!p) throw new Error("The style editor page is missing from the package (assets/editor/index.html).");
  return p;
}

function mime(p: string) {
  return /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg";
}

function send(res: http.ServerResponse, code: number, type: string, body: string | Buffer) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  send(res, code, "application/json", JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > max) {
        reject(new Error("The file is too large."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Serve a file with Range support, so the browser can seek in the video. */
function streamFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, type: string) {
  const size = fs.statSync(file).size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": end - start + 1, "cache-control": "no-store" });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no browser: the link is printed */
  }
}

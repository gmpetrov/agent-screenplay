import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { z } from "zod";
import { check, record, render } from "../core.js";
import { guideText } from "../guide.js";
import { parseScenario } from "../scenario/load.js";
import { VERSION } from "../version.js";

const INSTRUCTIONS = `Screenplay makes Screen Studio-quality screen recordings (smooth cursor, auto-zoom, callouts, captions, optional voice-over) from a JSON scenario you write.
Before your first recording, call screenplay_guide and follow it: ask whether the person wants a voice-over, explore the app, write the scenario, screenplay_check until it plays to the end, screenplay_record, look at the returned storyboard, fix, and re-run (screenplay_render when only text/style/zoom changed).`;

const PathArg = z
  .string()
  .describe("Path of the scenario JSON file. Prefer an absolute path; a relative one is resolved from the server's working directory.");
const ScenarioArg = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Optional scenario object: validated, then written to `path` (overwriting that file), then used.");

const SIDE_EFFECTS =
  " It really performs the steps in the app (a click on Send sends, a click on Delete deletes): use a demo account or a staging environment.";

// One recording at a time: each one runs a browser and a video encoder.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

function resolvePath(p: string, scenario?: Record<string, unknown>): string {
  const abs = path.resolve(process.cwd(), p);
  if (scenario) {
    parseScenario(scenario); // never overwrite a file with an invalid scenario
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(scenario, null, 2) + "\n");
  }
  return abs;
}

async function imageContent(file: string, maxWidth = 1600) {
  const img = await loadImage(fs.readFileSync(file));
  const k = Math.min(1, maxWidth / img.width);
  const c = createCanvas(Math.round(img.width * k), Math.round(img.height * k));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const data = (await c.encode("jpeg", 82)).toString("base64");
  return { type: "image" as const, data, mimeType: "image/jpeg" };
}

function errorResult(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
}

type Extra = { _meta?: { progressToken?: string | number }; sendNotification: (n: any) => Promise<void> };

function progressLogger(extra: Extra) {
  const token = extra._meta?.progressToken;
  let n = 0;
  return (msg: string) => {
    if (token === undefined) return;
    extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message: msg } }).catch(() => {});
  };
}

export async function startMcpServer() {
  const server = new McpServer({ name: "screenplay", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "screenplay_guide",
    {
      title: "How to make a good screen recording",
      description: "The guide to writing Screenplay scenarios: the loop, targets, steps, style, voice-over and direction tips. Read it before the first recording.",
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: guideText() }] }),
  );

  server.registerTool(
    "screenplay_check",
    {
      title: "Check a scenario",
      description:
        "Play the scenario quickly without filming. Reports each step; for a missing element, lists the visible targets you can use instead, with a screenshot of where it stopped." +
        SIDE_EFFECTS,
      inputSchema: { path: PathArg, scenario: ScenarioArg },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ path: p, scenario }, extra) =>
      serialize(async () => {
        try {
          const file = resolvePath(p, scenario);
          const report = await check(file, { log: progressLogger(extra as Extra) });
          const content: any[] = [{ type: "text", text: JSON.stringify(report, null, 2) }];
          if (report.screenshot && fs.existsSync(report.screenshot)) content.push(await imageContent(report.screenshot, 1280));
          return { content, isError: !report.ok };
        } catch (e) {
          return errorResult(e);
        }
      }),
  );

  const recordArgs = {
    path: PathArg,
    scenario: ScenarioArg,
    gif: z.boolean().optional().describe("Also write a GIF."),
    noVoice: z.boolean().optional().describe("Skip the voice-over even if the scenario enables it."),
  };

  server.registerTool(
    "screenplay_record",
    {
      title: "Film and edit a scenario",
      description:
        "Film the scenario and edit the video. Returns the MP4 path and the storyboard (one image per step): look at it and fix framing, bubbles or data before handing the video over. Takes about the length of the video plus a few seconds per 10 seconds of video." +
        SIDE_EFFECTS,
      inputSchema: recordArgs,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ path: p, scenario, gif, noVoice }, extra) =>
      serialize(async () => {
        try {
          const file = resolvePath(p, scenario);
          const r = await record(file, { gif, noVoice, log: progressLogger(extra as Extra) });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    mp4: r.mp4,
                    gif: r.gif,
                    storyboard: r.storyboard,
                    duration: Number(r.duration.toFixed(1)),
                    steps: r.steps,
                    next: `When you hand the video over, offer the person to adjust its look by eye: npx agent-screenplay style ${file}`,
                  },
                  null,
                  2,
                ),
              },
              await imageContent(r.storyboard),
            ],
          };
        } catch (e) {
          return errorResult(e);
        }
      }),
  );

  server.registerTool(
    "screenplay_render",
    {
      title: "Edit the last recording again",
      description:
        "Re-edit the last recording of this scenario without filming: use it after changing text, narration (say), callouts, style, zoom or output. Changing actions needs screenplay_record. Does not touch the app; writes the video files, and sends new narration text to Cartesia or ElevenLabs when the scenario enables voice-over.",
      inputSchema: recordArgs,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ path: p, scenario, gif, noVoice }, extra) =>
      serialize(async () => {
        try {
          const file = resolvePath(p, scenario);
          const r = await render(file, { gif, noVoice, log: progressLogger(extra as Extra) });
          return {
            content: [
              { type: "text", text: JSON.stringify({ mp4: r.mp4, gif: r.gif, storyboard: r.storyboard, duration: Number(r.duration.toFixed(1)) }, null, 2) },
              await imageContent(r.storyboard),
            ],
          };
        } catch (e) {
          return errorResult(e);
        }
      }),
  );

  await server.connect(new StdioServerTransport());
}

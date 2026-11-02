import { z } from "zod";

/**
 * A target names one element on screen, never coordinates (except `at` for
 * desktop apps that expose no accessible elements). Playwright-style strings:
 *   "text=Save"                      visible text (exact match first, then contains)
 *   "role=button[name='Save']"       ARIA role and accessible name
 *   "label=Email"                    form field by its label
 *   "placeholder=Search"             input by placeholder
 *   "testid=save-button"             data-testid
 *   "css=.toolbar > button"          CSS selector (web only)
 * A bare string without a prefix is treated as text.
 */
export const Target = z
  .string()
  .min(1)
  .describe(
    "The element to act on: text=…, role=button[name='…'], label=…, placeholder=…, testid=…, css=… (web only). A bare string means text=.",
  );

const Common = {
  say: z
    .string()
    .optional()
    .describe(
      "Narration for this step: shown as a caption, and spoken when voice is enabled. The step lasts at least as long as the sentence.",
    ),
  zoom: z
    .union([z.boolean(), z.number().min(1).max(4)])
    .optional()
    .describe("false: keep the camera wide for this step. A number: force this zoom level (1 = no zoom)."),
  hold: z
    .number()
    .min(0)
    .max(30)
    .optional()
    .describe("Extra seconds to stay on the result of this step before the next one."),
};

const Goto = z.object({ goto: z.string().describe("URL or path to open (relative to the scenario url)."), ...Common }).strict();
const Click = z
  .object({
    click: Target,
    button: z.enum(["left", "right"]).optional(),
    double: z.boolean().optional(),
    ...Common,
  })
  .strict();
const Type = z
  .object({
    type: z.string().describe("Text to type, letter by letter. ${ENV_VAR} is replaced from the environment."),
    into: Target.optional().describe("Field to click first. Omit to type where the focus already is."),
    clear: z.boolean().optional().describe("Clear the field before typing."),
    secret: z.boolean().optional().describe("Mask the text in captions, logs and the storyboard."),
    submit: z.boolean().optional().describe("Press Enter after typing."),
    ...Common,
  })
  .strict();
const Press = z.object({ press: z.string().describe("Key or chord, e.g. Enter, Escape, Meta+K."), ...Common }).strict();
const Hover = z.object({ hover: Target, ...Common }).strict();
const Scroll = z
  .object({
    scroll: z
      .union([Target, z.enum(["down", "up", "top", "bottom"])])
      .describe("An element to bring into view, or a direction (down/up scroll one screen)."),
    ...Common,
  })
  .strict();
const Select = z.object({ select: Target, option: z.string(), ...Common }).strict();
const Wait = z
  .object({
    wait: z
      .union([Target, z.number().min(0).max(120)])
      .describe("An element/text to wait for, or a number of seconds. Long waits are sped up in the video."),
    timeout: z.number().min(1).max(300).optional().describe("Seconds before giving up (default 30)."),
    ...Common,
  })
  .strict();
const Pause = z.object({ pause: z.number().min(0).max(30).describe("Seconds to stay still."), ...Common }).strict();
const Title = z
  .object({
    title: z.string().describe("Opening card shown full screen."),
    subtitle: z.string().optional(),
    duration: z.number().min(0.5).max(15).optional(),
    say: Common.say,
  })
  .strict();
const End = z
  .object({
    end: z.string().describe("Closing card shown full screen (result, call to action)."),
    subtitle: z.string().optional(),
    duration: z.number().min(0.5).max(15).optional(),
    say: Common.say,
  })
  .strict();
const Callout = z
  .object({
    callout: Target,
    text: z.string().describe("Text of the bubble pointing at the element."),
    duration: z.number().min(0.5).max(15).optional(),
    ...Common,
  })
  .strict();
const Highlight = z
  .object({
    highlight: Target,
    text: z.string().optional(),
    duration: z.number().min(0.5).max(15).optional(),
    ...Common,
  })
  .strict();
const ZoomTo = z
  .object({
    zoomTo: Target.describe("Frame the camera on this element without acting on it."),
    duration: z.number().min(0.5).max(15).optional(),
    ...Common,
  })
  .strict();

export const Step = z.union([
  Goto,
  Click,
  Type,
  Press,
  Hover,
  Scroll,
  Select,
  Wait,
  Pause,
  Title,
  End,
  Callout,
  Highlight,
  ZoomTo,
]);
export type Step = z.infer<typeof Step>;

export const BACKGROUNDS = ["sunset", "ocean", "lavender", "forest", "midnight", "mono", "paper"] as const;

export const Style = z
  .object({
    background: z
      .string()
      .optional()
      .describe(`A preset (${BACKGROUNDS.join(", ")}), a CSS color like #0f172a, or an image path.`),
    padding: z.number().min(0).max(400).optional().describe("Space around the recording, in output pixels (default 72)."),
    radius: z.number().min(0).max(80).optional().describe("Corner radius of the recording (default 14)."),
    shadow: z.boolean().optional().describe("Drop shadow under the recording (default true)."),
    cursor: z.enum(["macos", "dot", "none"]).optional().describe("Cursor drawn in the video (default macos)."),
    cursorSize: z.number().min(0.5).max(3).optional().describe("Cursor scale (default 1)."),
    maxZoom: z.number().min(1).max(4).optional().describe("Highest automatic zoom (default 1.9)."),
    autoZoom: z.boolean().optional().describe("Zoom automatically on clicks and typing (default true)."),
    captions: z.boolean().optional().describe("Show the `say` text as captions (default true)."),
    accent: z.string().optional().describe("Accent color for clicks, callouts and highlights (default #3b82f6)."),
    frame: z.enum(["none", "browser"]).optional().describe("Draw a minimal browser window bar above web recordings (default none)."),
  })
  .strict();
export type Style = z.infer<typeof Style>;

export const Voice = z
  .object({
    enabled: z.boolean().optional().describe("Speak each step's `say` text (default false). Needs CARTESIA_API_KEY."),
    language: z.string().optional().describe("Language code, e.g. en, fr, de (default en)."),
    id: z.string().optional().describe("Cartesia voice id (default: a narration voice for the language)."),
    speed: z.number().min(0.6).max(1.5).optional(),
    model: z.string().optional().describe("Cartesia model (default sonic-3.6)."),
  })
  .strict();
export type Voice = z.infer<typeof Voice>;

export const Output = z
  .object({
    width: z.number().int().min(320).max(3840).optional().describe("Video width (default 1920)."),
    height: z.number().int().min(240).max(2160).optional().describe("Video height (default 1080)."),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional().describe("Frames per second (default 30)."),
    gif: z.boolean().optional().describe("Also write a GIF (default false)."),
    path: z.string().optional().describe("Where to write the MP4 (default: next to the scenario, same name)."),
  })
  .strict();
export type Output = z.infer<typeof Output>;

export const Scenario = z
  .object({
    $schema: z.string().optional(),
    name: z.string().optional().describe("Name of the video (default: the file name)."),
    url: z.string().optional().describe("Web: the page to start on."),
    app: z.string().optional().describe("Desktop: the application to film, as the OS names it."),
    viewport: z
      .object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(240).max(2160) })
      .optional()
      .describe("Web: browser size in CSS pixels (default 1440x900)."),
    scale: z.number().min(1).max(3).optional().describe("Web: device pixel ratio of the capture (default 2, Retina)."),
    colorScheme: z.enum(["light", "dark"]).optional(),
    locale: z.string().optional().describe("Web: browser locale, e.g. fr-FR."),
    auth: z
      .object({ storageState: z.string().describe("Path to a session saved by `screenplay login`.") })
      .optional(),
    hideScrollbars: z.boolean().optional().describe("Web: hide scrollbars (default true)."),
    typingSpeed: z.number().min(0.2).max(5).optional().describe("Typing speed multiplier (default 1, about 14 characters/second)."),
    style: Style.optional(),
    voice: Voice.optional(),
    output: Output.optional(),
    steps: z.array(Step).min(1),
  })
  .strict()
  .refine((s) => Boolean(s.url) !== Boolean(s.app), {
    message: "Give exactly one of `url` (a website) or `app` (a desktop application).",
  });
export type Scenario = z.infer<typeof Scenario>;

export type StepKind =
  | "goto"
  | "click"
  | "type"
  | "press"
  | "hover"
  | "scroll"
  | "select"
  | "wait"
  | "pause"
  | "title"
  | "end"
  | "callout"
  | "highlight"
  | "zoomTo";

const KINDS: StepKind[] = [
  "goto",
  "click",
  "type",
  "press",
  "hover",
  "scroll",
  "select",
  "wait",
  "pause",
  "title",
  "end",
  "callout",
  "highlight",
  "zoomTo",
];

export function stepKind(step: Step): StepKind {
  for (const k of KINDS) if (k in step) return k;
  throw new Error(`Unknown step: ${JSON.stringify(step)}`);
}

export function describeStep(step: Step): string {
  const kind = stepKind(step);
  const value = (step as Record<string, unknown>)[kind];
  if (kind === "type") {
    const t = step as z.infer<typeof Type>;
    const text = t.secret ? "••••••" : t.type;
    return t.into ? `type "${text}" into ${t.into}` : `type "${text}"`;
  }
  return `${kind} ${typeof value === "string" ? value : JSON.stringify(value)}`;
}

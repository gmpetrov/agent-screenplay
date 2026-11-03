---
name: screenplay
description: Make polished screen recordings of a website or desktop app (feature demos, walkthroughs, explainer videos with voice-over) with Screenplay. Use when asked to record, film, demo or show a feature in a video, or to make an explainer or walkthrough video of an app.
---

# Making screen recordings with Screenplay

Screenplay turns a JSON **scenario** into a Screen Studio-style video: it plays the steps in a browser (or a desktop app), films them, then edits the video with a smooth cursor, automatic zooms, click effects, callouts, captions, title cards and an optional voice-over. You write the scenario; Screenplay does the filming and editing. It contains no AI.

Tools: the MCP tools `screenplay_check`, `screenplay_record`, `screenplay_render`, or the CLI `npx agent-screenplay check|record|render <file.json>`.

## The loop

1. **Understand what to show.** One video shows one idea: a feature, a flow, a fix. 15 to 60 seconds. Decide the story first: the starting point, the 3 to 8 actions that matter, the result.
   **Ask about the voice-over before writing**, in one question, unless the request already says: no voice (captions only, the default), or a voice-over, in which language. If they want one, see *Voice-over* below for how to get the voice.
2. **Explore the app** (with your browser tools, or by reading its code) to find the real path: which page, which buttons, what text they carry, what data is on screen. Prefer a demo account with realistic data: an empty dashboard or "test123" ruins the video.
3. **Write the scenario** next to where the video should go (for example `demos/handoff.json`).
4. **Run `check`.** It plays the scenario fast, without filming, and tells you which step fails and which targets are visible instead. Fix and check again until it plays to the end.
5. **Run `record`.** It films and edits, and writes `<name>.mp4` and `<name>.storyboard.png`.
6. **Look at the storyboard** (one image per step). Check: is each zoom framed on the right element, is a bubble hiding something, does a step show an error, is the data credible? Fix the scenario. If you only changed text, narration, style or zoom, run `render` (no new filming); if you changed actions, `record` again.
7. Hand over the MP4 path (and the GIF if asked), then **offer to adjust the look**: the person can set the background, padding, corners, shadow and the intro/outro cards by eye with `npx agent-screenplay style <scenario.json>`, which opens an editor in their browser and re-renders without filming. If they accept and the computer has a screen, run it for them in the background (it keeps running until stopped) and say a browser tab opened; otherwise give them the command.

## Scenario

```json
{
  "$schema": "https://raw.githubusercontent.com/gmpetrov/agent-screenplay/main/schema/scenario.schema.json",
  "url": "https://app.example.com/inbox",
  "auth": { "storageState": ".screenplay/auth.json" },
  "style": { "background": "dawn" },
  "steps": [
    { "click": "text=Camille Laurent", "say": "When the AI agent gets stuck, the conversation lands in your inbox." },
    { "callout": "role=button[name='Take over']", "text": "Take over from the AI agent" },
    { "click": "role=button[name='Take over']" },
    { "type": "Hi Camille, I'm on it.", "into": "placeholder=Write a reply…" },
    { "click": "role=button[name='Send']" },
    { "highlight": "text=Assigned to you", "text": "Your teammates see it's yours" }
  ]
}
```

`url` for a website (a relative path means a local HTML file). `app` instead of `url` for a desktop application (its name as the OS shows it).

### The whole screen (desktop)

`"screen": true` films the whole main screen instead of one window: use it when the video goes from one app to another, or shows the menu bar. `app` is then optional (the app brought to the front first).

- `{ "open": "Dictionary" }` launches an app or brings it to the front; the next steps act in it.
- A step's `"app": "Finder"` acts in another app for that step (and the next ones).
- A step's `"surface": "menubar"` looks for the element in the app's menu bar; `"menu"` in an open menu; also `sheet`, `popover`, `alert`.

Everything on screen is filmed: notifications, other windows, desktop icons and widgets. Before recording, close what should not be seen, turn on Do Not Disturb, and set `"hideOthers": true` (macOS) to hide the other apps. Some windows (menu bar apps' panels) ignore Hide Others: close them. Prefer a window recording when the video stays in one app.

```json
{
  "screen": true,
  "app": "Calculator",
  "hideOthers": true,
  "steps": [
    { "click": "role=button[name='7']" },
    { "open": "Dictionary" },
    { "type": "screenplay", "into": "role=textfield" },
    { "click": "role=menuitem[name='Edit']", "surface": "menubar" }
  ]
}
```

### Targets

Name elements the way a user sees them, never with coordinates:

| Target | Finds |
|---|---|
| `text=Save` | visible text (exact first, then partial) |
| `role=button[name='Save']` | ARIA role + accessible name (best for buttons, links, tabs, checkboxes) |
| `label=Email` | a form field by its label |
| `placeholder=Search` | an input by its placeholder |
| `testid=save` | `data-testid` |
| `css=.toolbar button` | CSS (web only, last resort) |
| `at=640,320` | coordinates (desktop apps with no accessible elements only) |

When `check` cannot find a target, it lists the visible ones: copy one.

### Steps

Actions: `goto`, `click` (`double`, `button: "right"`), `type` (+ `into`, `clear`, `submit`, `secret`), `press` (`Enter`, `Meta+K`), `hover`, `scroll` (`down`/`up`/`top`/`bottom` or a target), `select` (+ `option`), `wait` (a target or seconds), `pause`.

Direction: `title` and `end` (full-screen cards, `subtitle`), `callout` (bubble with `text` pointing at an element), `highlight` (dims everything else, optional `text`), `zoomTo` (frame an element without acting).

On any step: `say` (narration: a caption, and speech when voice is on), `zoom` (`false` to stay wide, or a level like `1.5`), `hold` (extra seconds on the result).

`${ENV_VAR}` in any string is replaced from the environment (use it for logins; mark password typing with `"secret": true`).

### Style, voice, output

```json
"style": { "background": "dawn", "padding": 72, "radius": 14, "cursor": "macos", "maxZoom": 1.9, "frame": "browser", "accent": "#3b82f6", "captions": true },
"voice": { "enabled": true, "language": "fr" },
"output": { "width": 1920, "height": 1080, "fps": 30, "gif": false }
```

Backgrounds: `dawn` (default), `iris`, `citrus`, `apricot`, `coral`, `blaze`, `cloud`, `glacier`, `tide`, `meadow`, a color (`#0f172a`), an image path, or a gradient `{ "gradient": ["#0ea5e9", "#6366f1"], "angle": 135 }`. `frame: "browser"` adds a minimal browser bar with the URL.

A `screenplay.config.json` in the scenario's folder or a parent sets the style of every video below it (`{ "style": { … } }`); a scenario's own `style` wins, setting by setting. Keep a project's look there rather than repeating it in each scenario, and leave it alone unless asked. When a person wants to choose the look themselves, tell them to run `npx agent-screenplay style <scenario.json>`: it opens a visual editor in their browser (it needs a screen, so do not run it yourself in a headless environment).

Title and end cards are **off by default**: `title` and `end` steps are left out of the video unless `"style": { "cards": true }`. Add them, and turn cards on, only when the person asks for an intro or an outro.

### Voice-over

Off by default. With `"voice": { "enabled": true, "language": "fr" }`, each `say` is spoken and the video waits for each sentence to finish. Without voice, `say` still shows as a caption. Getting the voice:

1. If `CARTESIA_API_KEY` or `ELEVENLABS_API_KEY` is set in the environment, it is used (Cartesia first; `"provider": "elevenlabs"` to choose).
2. If neither is set, offer the person the choice:
   - give a key (set `CARTESIA_API_KEY` from https://play.cartesia.ai/keys or `ELEVENLABS_API_KEY` from https://elevenlabs.io/app/settings/api-keys, then restart the agent); or
   - make the voice themselves: write the narration as a ready-to-paste script, one numbered line per spoken step, with the language and the tone, and ask them to generate it in ElevenLabs' or Cartesia's web app and save one file per line as `voice/01.mp3`, `voice/02.mp3`… next to the scenario. Then give each spoken step its `"audio": "voice/NN.mp3"` and run `render` (no new filming).
   - or go without voice: captions only.

## Direction that makes a good video

- **One action per step**, and a `say` on the steps that matter, not on every one. Narration: short spoken sentences, present tense, what the viewer gains ("One click, and the conversation is yours"), not what the cursor does ("Now I click the button").
- **Show before you act** when the control is hard to spot: a `callout` on the button, then the `click`.
- **End on the proof**: a `highlight` or `hold` on the result (the saved item, the green status, the sent message).
- **Let zooms work**: they follow clicks and typing automatically. Use `"zoom": false` on a step whose result appears far from the click (a toast, a side panel), or `zoomTo` to frame the result.
- **Realistic data and typing**: real-looking names and messages, 3 to 10 words typed, not paragraphs.
- **Keep it short**: under a minute; cut steps that don't move the story.
- **Logins**: run `npx agent-screenplay login <url>` once (a person signs in in the window that opens, then closes it; the session is saved to `.screenplay/auth.json`) and set `auth.storageState`; or log in with steps using `${EMAIL}` / `${PASSWORD}` and `secret: true`.

## When something goes wrong

- `check` fails on a target → use one from the listed visible targets, or add a `wait` for it. A listed `css=… (shows "…")` is a button whose text is drawn by CSS (some cookie walls): copy it as is.
- "shows a bot check that needs a person" (Cloudflare) → run `npx agent-screenplay login <url>` (in the background: it waits), and tell the person: pass the check in the browser window that opened, accept the cookies if asked, then **close the window**. Closing saves the session; do not ask them to press Enter in a terminal. Then set `"auth": { "storageState": ".screenplay/auth.json" }` and check again.
- "covered by …" → something (a toast, a cookie banner, a modal) sits on the element: close it first with a step.
- "the typed text did not appear" → the field was not focused: use `into` to click it.
- A wait is long (page loads, AI answers) → keep it: long waits are sped up in the video automatically.
- The storyboard shows the wrong framing → `"zoom": false` on that step, or a `zoomTo` step, or lower `style.maxZoom`.

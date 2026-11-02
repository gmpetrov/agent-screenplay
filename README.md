# Screenplay

Screen Studio-quality screen recordings for AI agents. An agent writes a **scenario** (what to do, what to show, what to say); Screenplay plays it in a browser, films it, and edits the video: smooth cursor, automatic zooms, click effects, callouts, captions, title cards, optional voice-over.

> Status: early. Web recording works end to end; the MCP server, `init` and desktop apps are in progress.

## Try it

```bash
git clone https://github.com/gmpetrov/screenplay && cd screenplay
npm install && npm run build
npx playwright install chromium        # or set SCREENPLAY_CHROME to an installed Chrome
node dist/cli.js record examples/handoff-demo.json
open examples/handoff-demo.mp4          # and examples/handoff-demo.storyboard.png
```

With a voice-over (Cartesia):

```bash
CARTESIA_API_KEY=sk_car_... node dist/cli.js record examples/handoff-explainer.json
```

## Commands

| Command | What it does |
|---|---|
| `screenplay check <scenario>` | Plays the scenario fast without filming: every element exists and the flow completes. Lists visible targets when one is missing. |
| `screenplay record <scenario>` | Films and edits: writes the MP4 and a storyboard PNG next to the scenario. |
| `screenplay render <scenario>` | Edits the last recording again without filming (style, zoom, captions, narration). |

## Scenario

```json
{
  "url": "https://app.example.com",
  "style": { "background": "ocean" },
  "voice": { "enabled": false },
  "steps": [
    { "title": "Human handoff, in one click" },
    { "click": "text=Inbox", "say": "When the AI agent gets stuck…" },
    { "type": "Hello", "into": "placeholder=Write a reply…" },
    { "callout": "role=button[name='Take over']", "text": "Take over from the AI agent" },
    { "end": "Available today" }
  ]
}
```

Targets name elements, never coordinates: `text=…`, `role=button[name='…']`, `label=…`, `placeholder=…`, `testid=…`, `css=…`. The full format is in [`schema/scenario.schema.json`](schema/scenario.schema.json).

## License

MIT

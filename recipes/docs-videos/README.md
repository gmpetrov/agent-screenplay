# Recipe: a video for every page of your docs

Have your coding agent film a short explainer for each feature page of your docs, and find out when one goes stale.

Each video is a script (`*.screenplay.json`) kept in your repo. The agent writes it, Screenplay films and edits it, and the same script is replayed every night by `check`, which fails when a button it clicks was renamed, moved or removed.

## What's here

| File | Goes to | What it does |
|---|---|---|
| [`docs-video/SKILL.md`](docs-video/SKILL.md) | `.claude/skills/docs-video/SKILL.md` | How a docs video is made: read the page, explore the app, write the script, `check`, `record`, review the storyboard, three takes at most, publish |
| [`screenplay.config.json`](screenplay.config.json) | `videos/screenplay.config.json` | One house style for every video in the folder |
| [`handoff-demo.screenplay.json`](handoff-demo.screenplay.json) | `videos/` | An example script (for the [example app](../../examples/demo-app)) |
| [`docs-videos.yml`](docs-videos.yml) | `.github/workflows/docs-videos.yml` | Replays every script against staging each night |

## Set up

```bash
npx agent-screenplay init                                   # Chromium, the MCP server, the guide
mkdir -p .claude/skills videos
cp -r recipes/docs-videos/docs-video .claude/skills/         # from a clone of this repo
cp recipes/docs-videos/screenplay.config.json videos/
npx agent-screenplay login https://app.example.com -o videos/.screenplay/auth.json
echo "videos/.screenplay/" >> .gitignore
echo "videos/*.mp4" >> .gitignore
echo "videos/*.storyboard.png" >> .gitignore
```

Point the scenarios at a demo account or staging, never production: `check` and `record` really click.

## Use it

1. **Shot list.** Ask your agent:

   > Read every page in docs/. For each page that shows something a user does in the app, propose one video: the page, the one thing a viewer should be able to do after watching, the starting URL, the 3 to 8 actions that show it, and the result to end on. Skip concept pages and the API reference. Write it as a table in videos/shotlist.md. Don't film anything yet.

   Review the table: cut, merge, split. One video, one idea, under 60 seconds.

2. **Film.** Then:

   > For each row of videos/shotlist.md, start a subagent that makes the video with the docs-video skill. Run 4 at a time. When they're all done, give me a table: page, video, length, takes, and anything that looked wrong.

   Takes click for real: give each video its own records in the demo data, and film the ones that change shared data alone, at the end.

3. **Voice.** Add `"voice": { "enabled": true }` and set `CARTESIA_API_KEY` or `ELEVENLABS_API_KEY`, or give each step an `"audio"` file. See [Voice-over](../../README.md#voice-over).

4. **Publish.** Upload the MP4s and a poster frame to a CDN, embed them at the top of each page, and keep only the scripts in git.

5. **Stay fresh.** Add `docs-videos.yml` to your workflows. Write each script's URL as `${APP_URL}/...` so the same script runs locally and against staging.

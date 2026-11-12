---
name: docs-video
description: Make or refresh the explainer video of one page of our product docs with Screenplay (agent-screenplay). Use when asked to film, re-film or check a docs video, or to make videos for the docs.
---

# Docs videos

Each feature page of the docs gets one video: 20 to 60 seconds, one idea, filmed on the demo account, narrated with the page's own words. The video's scenario lives in the repo next to the page, so it can be checked and re-filmed whenever the app changes.

## Where things are

- Docs pages: `docs/` (one `.mdx` per page)
- Scenarios: `videos/<page-slug>.screenplay.json`, one per video, next to `videos/screenplay.config.json` (the house style: never change it unless asked). Their `url` starts with `${APP_URL}`, so the same scenario runs against the demo app, staging or a preview.
- The demo account's session: `videos/.screenplay/auth.json` (made with `npx agent-screenplay login <app url> -o videos/.screenplay/auth.json`; never commit it). If it has expired, ask a person to run that command again.
- Rendered videos: `videos/<page-slug>.mp4` and `videos/<page-slug>.storyboard.png` (git-ignored; published to the CDN, not committed)

## Make a video for one page

1. **Read the page.** Write down, in one sentence, what a viewer should be able to do after watching. That sentence is the video. If the page covers two things, make two videos and say so.
2. **Explore the app on the demo account** (browser tools, or the app's code) and find the real path: the starting URL, the 3 to 8 actions that show the feature, and the result to end on. Name targets the way a user sees them: `text=…`, `role=button[name='…']`, `label=…`, `placeholder=…`. CSS only as a last resort.
3. **Write the scenario** in `videos/<page-slug>.screenplay.json` with `"auth": { "storageState": ".screenplay/auth.json" }`. Narration (`say`):
   - Use the page's own words for things (same names as the docs headings and the UI), so the video and the text never disagree.
   - Short spoken sentences, present tense, what the viewer gains: "One click, and the whole team sees it." Never what the cursor does: "Now I click the Save button."
   - A `say` on the steps that matter, not on every step. First line says what the feature is for; last line lands on the result.
   - `callout` before a click on a control that is hard to spot; end on a `highlight` or a `hold` on the result.
   - Type 3 to 10 realistic words, never "test" or "asdf".
4. **Run `npx agent-screenplay check videos/<page-slug>.screenplay.json`** until it plays to the end. When a target is not found, use one of the visible targets it lists.
5. **Run `npx agent-screenplay record videos/<page-slug>.screenplay.json`.**
6. **Open the storyboard image and review every frame:**
   - Is each zoom framed on the element that matters?
   - Does a callout or caption hide what it talks about?
   - Is there an error, a spinner, a toast or an empty state on screen?
   - Does the data look real (names, amounts, dates)?
   - Does the narration match what is on screen at that moment?
   Fix the scenario. Changed only text, narration, style or zoom: `render` (no new take). Changed actions: `record` again.
7. **Three takes at most.** If it still isn't right, stop and report what is wrong and why (a bug in the app, missing demo data, a flow too long for one video).
8. **Report**: the page, the video path, its length, the number of takes, and anything you were unsure about.

## Takes click for real

`check` and `record` really perform the steps on the demo account: a "Delete" deletes, a "Send" sends. So:

- Never point a scenario at production data.
- When several videos are filmed at the same time, each one must use records nobody else's scenario changes (its own project, contact or document in the demo data). If a scenario changes shared data, film it alone, last.
- If a take leaves the demo data in a different state (an item created, archived or sent), undo it after the take, or note it in the report.

## Refresh the videos

When asked to check the docs videos (for example after a release):

1. Run `check` on every `videos/*.screenplay.json`.
2. For each one that fails, find out why: a renamed or moved control (fix the scenario and re-film), a changed flow (re-read the docs page; the page may need updating too: say so), or a bug in the app (report it, don't film around it).
3. `check` only catches broken flows. If the release changed how pages look (a redesign, a new layout), re-film every video whose pages changed, even if its check passes.
4. Report a table: page, check result, what changed, re-filmed or not.

## Publish

- Upload each new or changed `videos/<page-slug>.mp4` to the CDN, with a poster image taken from the video (`ffmpeg -ss 2 -i in.mp4 -frames:v 1 poster.jpg`, at a moment where the feature is on screen).
- Embed it at the top of the page, under the first paragraph:

  ```mdx
  <Frame caption="One line on what the video shows.">
    <video controls playsInline preload="metadata" poster="https://cdn.example.com/docs/<page-slug>.jpg" src="https://cdn.example.com/docs/<page-slug>.mp4" />
  </Frame>
  ```

- Open one pull request for all the videos of a run, listing each page with its video link, so a person can watch them before merging.

# evo.videostroll

`v0.0.0.1.1` (alpha) · **M2: speaks** · MIT

An open-source MCP server and Claude Code skill that lets an AI agent
**record narrated walkthrough videos of a website** — driving the browser itself,
speaking as it goes, with a visible cursor and timestamped captions.

The agent decides what to show and what to say. The tool makes it a video.

## What comes out

One walkthrough produces, in one output folder:

| File | What it is |
| --- | --- |
| `walkthrough.mp4` | H.264 video + AAC narration, cursor visible, captions optionally burned in |
| `walkthrough.srt` / `walkthrough.vtt` | Captions with timestamps, one cue per narrated sentence |
| `walkthrough.json` | The manifest: every step, its start/end time, narration, action, URL, and a thumbnail — the timestamps, as data, for any other app |
| `walkthrough.storyboard.json` | The exact storyboard that was rendered, so the run is reproducible |

## Status

**M2 — it speaks.** `start` → `step` → `finish` produces a narrated,
captioned MP4 from a real browser: CDP screencast per step, the cursor overlay
in every frame, a real voice, captions timed from the engine's word
boundaries, SRT/VTT and the manifest alongside. The first real walkthrough —
seven steps across www.evomedia.net, sixty-two seconds — rendered in 94 s of
wall time with every caption engine-timed.

The design, decisions and remaining questions are in **[PLAN.md](PLAN.md)**;
the contract is [`server/schema/storyboard.schema.json`](server/schema/storyboard.schema.json),
with worked examples in [`examples/storyboards/`](examples/storyboards/).

## Voices

| `voice.provider` | Cost | Needs | Word timing | Notes |
| --- | --- | --- | --- | --- |
| `edge` (default) | free | network, no key | yes | Microsoft Edge's neural voices via an unofficial endpoint. `voice.name` picks the voice, e.g. `en-US-GuyNeural`. |
| `piper` | free | the `piper` binary + one `.onnx` voice model, offline | no | Set `PIPER_PATH` (or have `piper` on `PATH`) and `PIPER_MODEL`, or pass the model path as `voice.name`. |
| `silent` | — | nothing | synthetic | Silence sized by words-per-minute. Deterministic; what the test suite uses. |

**No provider falls back to another on its own.** A silent video where a voice
was asked for is a wrong-looking success, so a failed voice fails the step
with a message naming the alternatives. Check the Edge endpoint still answers
before trusting a release: `npm run check:edge`.

## Batch render from the command line

```bash
cd server
npm run render -- ../examples/storyboards/www-evomedia.json ./output/www
```

## Run it

```bash
cd server
npm ci
npx playwright install chromium
npm test
```

Register the server with an MCP client (Claude Code, Claude Desktop, any
other) by pointing it at `node server/dist/index.js` after `npm run build`,
or at `npx @evomedia/videostroll` once published. Tools: `videostroll_start`,
`videostroll_step`, `videostroll_observe`, `videostroll_finish`,
`videostroll_abort`, `videostroll_render`.

## Two deliverables, one repo

- **`server/`** — the MCP server. The engine: browser, cursor, recording,
  narration, captions, assembly. Usable from any MCP client.
- **`skill/`** — the Claude Code skill. Teaches the agent *how to make a good
  walkthrough*: reconnoitre first, storyboard, narrate in short sentences, pace
  to the voice, verify the manifest. It calls the server's tools.

The server without the skill is a capable but undirected recorder. The skill
without the server has nothing to record with. They ship together.

## Recording other people's sites

The tool records whatever the browser shows. Before pointing it at a site you
do not own: read that site's terms, do not record behind a login you were not
given for this purpose, and treat anything personal that appears on screen as
if you had photographed it — because you have. The skill refuses to narrate
secrets and never puts credentials in a storyboard; that is the floor, not the
ceiling.

## Licence

MIT — see [LICENSE](LICENSE). Synthesised voices and recorded sites remain
subject to their own terms.

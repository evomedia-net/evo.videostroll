# evo.videostroll

`v0.0.0.1.0` (alpha) · **planning** · MIT

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

Planning. Nothing here runs yet. The design, the decisions still open, and the
milestones are in **[PLAN.md](PLAN.md)**. The storyboard format the whole thing
is built around is already concrete: [`server/schema/storyboard.schema.json`](server/schema/storyboard.schema.json),
with a worked example in [`examples/storyboards/`](examples/storyboards/).

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

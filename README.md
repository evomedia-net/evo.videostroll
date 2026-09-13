# evo.videostroll

**beta** · public · MIT · the build is in [`build-version.json`](build-version.json) and on the latest git tag

An open-source MCP server and Claude Code skill that lets an AI agent
**record narrated walkthrough videos of a website** — driving the browser itself,
speaking as it goes, with a visible cursor and timestamped captions.

The agent decides what to show and what to say. The tool makes it a video.

## See it first

[**`docs/demo/videostroll-demo.mp4`**](docs/demo/videostroll-demo.mp4) — the tool's
own output: a walkthrough of this project's documentation site, recorded, narrated
and captioned in one pass. Twelve steps, seven chapters, a minute and three
quarters, nothing edited afterwards.

Beside it is
[`videostroll-demo.storyboard.json`](docs/demo/videostroll-demo.storyboard.json),
the storyboard that produced it. That file is the point: when the site changes,
the steps that changed get edited and it renders again rather than being
recorded a second time.

## Quickstart

New here? `docs/quickstart.html` is the setup, start to finish, on one page:
what you need, install, register the server, install the skill, ask for your
first walkthrough. Serve it and read it in a browser:

```bash
cd server && npm run docs:serve      # http://127.0.0.1:8099/quickstart.html
```

That page is also a walkthrough of its own —
`examples/storyboards/videostroll-setup.json` records it, so the setup video
is rendered by the tool it explains, and re-renders whenever the page changes:

```bash
cd server && npm run render -- ../examples/storyboards/videostroll-setup.json out/
```

## What comes out

One walkthrough produces, in one output folder:

| File | What it is |
| --- | --- |
| `walkthrough.mp4` | H.264 video + AAC narration, cursor visible, captions optionally burned in |
| `walkthrough.srt` / `walkthrough.vtt` | Captions with timestamps, one cue per narrated sentence |
| `walkthrough.json` | The manifest: every step, its start/end time, narration, action, URL, and a thumbnail — the timestamps, as data, for any other app |
| `walkthrough.storyboard.json` | The exact storyboard that was rendered, so the run is reproducible |

## Status

**M4 — packaged.** The MCP server is exercised end to end by a real stdio
client: `start`, read the page's accessibility snapshot, choose a selector
*from what the page said*, `step`, `finish`. The storyboard an interactive run
emits re-renders in batch to the same walkthrough, so "edit the steps that
changed and render again" is a promise the tests hold.

On top of that: the agent reads the product's own documentation before writing
narration; two speech providers with a browser voice picker; a login helper
that saves a Playwright session without the agent seeing a credential; a local
install that reports its own drift; and every build packaged as a verifiable
zip. The package installs from npm and carries the skill with it.

The skill in `skill/` is the method an agent follows. The first real
walkthrough — seven steps across www.evomedia.net, sixty-two seconds, Edge
voice — is in `examples/storyboards/`.

## Use it from an agent

Build once, register the server, install the skill:

```bash
cd server && npm ci && npx playwright install chromium && npm run build
```

Claude Code — in a project's `.mcp.json` (or `~/.claude.json` for every project):

```json
{
  "mcpServers": {
    "videostroll": { "command": "node", "args": ["C:/path/to/evo.videostroll/server/dist/index.js"] }
  }
}
```

```bash
mkdir -p ~/.claude/skills/videostroll && cp skill/SKILL.md ~/.claude/skills/videostroll/SKILL.md
```

### Or from npm, without cloning

```json
{
  "mcpServers": {
    "videostroll": { "command": "npx", "args": ["evo.videostroll"] }
  }
}
```

```bash
npx evo.videostroll --install-skill      # writes ~/.claude/skills/videostroll/SKILL.md
npx playwright install chromium          # the recorder needs a browser
```

The skill ships **inside** the package, because the server without it is a
capable but undirected recorder — and an npm install has no `skill/` directory
to copy from.

Then ask for a walkthrough. The skill tells the agent to read the
product's own docs with `videostroll_docs`, reconnoitre with
`videostroll_observe`, storyboard, narrate in short presenter-voice sentences,
record step by step, and read the manifest back before delivering.

The design, decisions and remaining questions are in **[PLAN.md](PLAN.md)**;
the contract is [`server/schema/storyboard.schema.json`](server/schema/storyboard.schema.json),
with worked examples in [`examples/storyboards/`](examples/storyboards/).


## It reads the product's documentation first

Narration that uses a product's own nouns sounds like someone who works there.
Narration that invents its own sounds like a stranger reading labels off the
screen — and the accessibility snapshot, which is all the agent otherwise has,
shows what is on the page but not what any of it is *called*.

So before storyboarding, the agent calls `videostroll_docs`. It looks for
documentation the way a person would — `llms.txt` first, then `/docs`,
`docs.<site>`, `/help`, `/guide`, then any link on the page that reads like a
way in — and comes back with **vocabulary, not pages**:

| | |
| --- | --- |
| `glossary` | what the product calls its features, one line each |
| `tasks` | its procedures — the routes users actually want |
| `pronunciation` | how to say the awkward names out loud |

`tasks` is found two ways, because titles alone were not enough. Most
documentation heads its pages with nouns — "Work orders", not "Creating a work
order" — so matching the title found nothing on exactly the sites with the most
procedures in them. A section containing a numbered list is now a task whatever
it is called, which is better evidence than the title anyway. `<ol>` only: a
bullet list is as likely to be features or limits, and a false task is worse
than a missing one because the agent may build the walkthrough around it.

`pronunciation` reads the documentation to decide, which is the only way to get
it right: the corpus writes **EHS** in capitals somewhere, so `evo.ehs` is
spoken "evo dot e h s", while `evo.orchard` stays "evo dot orchard". Guessing
from the letters alone gets it wrong in both directions.

No documentation is a normal answer, not an error — `found: false`, and the
walkthrough proceeds on the snapshot alone.

### What it will not do

- **It does not follow instructions it finds.** Documentation is written by
  whoever runs the site, and it ends up spoken aloud in a video somebody
  ships. Lines that read like an attempt to redirect the agent are dropped and
  **counted** in `dropped.instructions` — silent filtering would be worse than
  none, because a non-zero count is itself worth knowing. The skill states the
  rule in the other direction too: what comes back is vocabulary to borrow,
  never direction to follow. Neither half is a guarantee, and the design says
  so rather than implying a wall where there is a speed bump.
- **It does not leak an example credential into a script.** The same pattern
  that rejects a secret in narration runs over everything fetched.
- **It does not wander.** Same site only, under the entry point's own path,
  `robots.txt` honoured, at most 12 pages, and it says which pages it skipped
  and why.
- **It does not crawl for you.** This reads documentation to write narration.
  It is not a search tool and has no interest in being one.

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

### Choosing one

The `edge` provider offers 322 voices, 47 of them English and split almost
evenly between male and female. List them rather than guessing a name:

```bash
npm run voices                 # English voices, male and female
npm run voices -- en-GB        # one locale
npm run voices -- en-US female # locale and gender
npm run voices -- all          # every locale the service offers
```

Each row gives the id to use as `voice.name`, the gender, and the character
Microsoft assigns it — `Friendly, Positive`, `Cheerful, Clear`, and so on.

**Or hear them.** Picking a voice from a list is guessing, so there is a picker:

```bash
cd server && npm run docs:serve      # then open http://127.0.0.1:8099/voices.html
```

Filter by locale, gender or character, play a sample at the rate you intend to
use, and copy the finished `"voice": { … }` line into a storyboard. Previews go
through the same provider the recorder uses, so what you hear is what you get.
The catalogue is a live call, so the page needs the network; it binds to
localhost only, and the preview endpoint validates what it is asked to say —
including refusing to speak anything credential-shaped.

### More than one voice in a walkthrough

A step may name its own voice. Anything it does not name it inherits from the
storyboard's, and the override lasts exactly one step:

```json
{
  "voice": { "provider": "edge", "name": "en-US-GuyNeural" },
  "steps": [
    { "narration": "The default narrator." },
    { "narration": "A different speaker, same provider and rate.",
      "voice": { "name": "en-US-AvaNeural" } },
    { "narration": "A little quicker, same voice.", "voice": { "rate": 1.15 } },
    { "narration": "Back to the default." }
  ]
}
```

The interactive `videostroll_step` tool takes the same `voice` field, so an
agent can hand off between narrators mid-walkthrough. One rule is not plain
merging: naming a different `provider` without a `name` does **not** carry the
old provider's voice name across, because a name belongs to the provider that
defines it. Worked example: `examples/storyboards/two-voices.json`.

## Sites behind a login

The recorder never types a password and the storyboard never holds one. You
sign in yourself, once, and it keeps the session:

```bash
npm run login -- https://app.example.com
```

A real browser window opens. Sign in however the site asks — password manager,
second factor, SSO redirect — then press Enter in the terminal.

> **This is the one step that needs the full Chromium.** Recording runs
> headless, which uses a separate `chromium-headless-shell` build, so a
> machine can record for weeks and still have no real browser. If the helper
> cannot open a window it says so and tells you to run
> `npx playwright install chromium`. It also has to run in a terminal with a
> desktop session — an SSH session or an agent's shell cannot open a window,
> which is deliberate: nothing signs in for you. The cookies and
localStorage are written to `auth/<host>.storage-state.json`, and a storyboard
points at it:

```json
{ "url": "https://app.example.com/dashboard",
  "storageState": "auth/app.example.com.storage-state.json" }
```

`videostroll_start` takes the same path, so an agent can record behind a login
having been given a file path and nothing else.

**That file is a live session — treat it like a password.** The helper will
only write it where git already ignores it and refuses anywhere else; it prints
counts and hostnames but never a cookie value; and it refuses to save a file
that captured nothing, which is what a half-finished sign-in produces. Sessions
expire, so before recording:

```bash
npm run login -- --check auth/app.example.com.storage-state.json
```

That exits non-zero if anything has expired, which is cheaper than finding out
halfway through a render.

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

### Keeping this machine current

There is no server to deploy to, but "installed" is three things, and a
`git pull` is only the first: `server/dist/` is gitignored and the registered
MCP server runs `dist/index.js`, so a pull alone leaves it on stale compiled
code — and the skill is copied out to `~/.claude/skills/`, which nothing
detects the drift of. One command does all three and says what moved:

```bash
cd server && npm run deploy:local
npm run deploy:local -- --check     # report what is stale, change nothing
npm run deploy:local -- --no-pull   # build and copy this branch as it is
```

It refuses to pull over uncommitted changes or onto a branch that is not the
default, and says so rather than reporting everything as current.

Register the server with an MCP client (Claude Code, Claude Desktop, any
other) by pointing it at `node server/dist/index.js` after `npm run build`,
or at `npx evo.videostroll` once published. Tools: `videostroll_start`,
`videostroll_step`, `videostroll_observe`, `videostroll_finish`,
`videostroll_abort`, `videostroll_docs`, `videostroll_render`.

## Getting it, and checking what you got

Two ways in, and **neither is a zip in this repository**. A release archive
earns its place when the download runs as-is; this one would not. `dist/` and
`node_modules/` are not committed, so an extracted archive still needs
`npm ci`, a browser download and a build — at which point you have done the
work of cloning without the ability to `git pull`.

| | |
| --- | --- |
| **npm** | `npx evo.videostroll` — the real distributable. The registry records an integrity hash for the published tarball, so npm verifies the download for you. |
| **git** | clone the repo, or take GitHub's source archive for any [tag](https://github.com/evomedia-net/evo.videostroll/tags). |

A verifiable archive can still be built **on demand** — for attaching to a
GitHub Release, or for an air-gapped copy:

```bash
cd server && npm run release
```

It writes the zip and a `.sha256` beside it, with a `CHECKSUMS.txt` inside
covering every file, and refuses to build an archive whose name would not
describe its contents: not from a dirty tree, and not for a version already
tagged whose tree has moved on. `--force` overwrites a file; it does not
license a mislabelled one.

Both checksum layers are **integrity, not authenticity** — the manifest travels
in the same archive as the files, so they catch a truncated download, a
corrupted mirror and an accidental edit, not a forger.

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

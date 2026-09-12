# Security

How to report a vulnerability, what to expect, and what is in scope:
**[the evomedia-net security policy](https://github.com/evomedia-net/.github/blob/main/SECURITY.md)**.
Short version — email [dev@evomedia.net](mailto:dev@evomedia.net), not a public
issue.

What follows is particular to this project. It drives a real browser, holds a
saved login on disk, and reads text off websites it did not write, so it is
worth being explicit about where the edges are.

## What it does with a login

`npm run login` opens a browser, you sign in by hand, and Playwright's
**storage state** — cookies and local storage, not a password — is written to
a file you name. The recorder replays that file.

- **The agent never sees a credential.** You type it into a real browser; the
  agent gets a session file.
- **The file is a live session.** Anyone who can read it can act as you on that
  site until it expires. It is worth the same care as a password even though it
  is not one.
- **`auth/` is gitignored, and the release archive excludes it.** Point
  `--out` somewhere outside the repository if you would rather it were nowhere
  near one.
- **The storyboard never carries credentials.** The schema rejects text that
  looks like a password, key or token, in narration and in `type` actions
  alike. That is a guard against the obvious mistake, not a secrets scanner:
  an operator determined to type a password into a storyboard can.

## What it does with untrusted text

`videostroll_docs` fetches a site's documentation so the narration can use the
product's own vocabulary. **That text is written by whoever runs the site, and
it ends up spoken aloud in a video somebody publishes.**

- Fetched text is treated as **data, never as instructions**. Lines that read
  like an attempt to redirect the agent are dropped, and the count is reported
  in `dropped.instructions` rather than swallowed — a silent filter is worse
  than none, because nobody learns the site tried.
- The same credential pattern runs over everything fetched, so an example API
  key in someone's docs cannot reach a script.
- **Neither is a wall.** A determined injection gets past a regex. The durable
  protection is that the skill instructs the agent to treat what comes back as
  vocabulary to borrow and never as direction to follow, and the two together
  are still defence in depth rather than a guarantee. Treat a walkthrough of a
  site you do not control as untrusted output and watch it before publishing.
- The scan stays on one site, under the entry point's own path, honours
  `robots.txt`, caps at twelve pages, and identifies itself in its user agent.

## The browser

Recording launches Chromium through Playwright and navigates wherever the
storyboard says. A storyboard is code: **do not run one you did not write or
read**, any more than you would run an unfamiliar script. `videostroll_render`
takes a whole storyboard as input and is the obvious place for that to matter.

## Release integrity

Every release carries a `.sha256` beside the zip and a `CHECKSUMS.txt` inside
it. Both are **integrity checks, not signatures** — the manifest travels in the
same archive as the files, so whoever can change one can change the other. They
catch a truncated download, a corrupted mirror and an accidental edit. They do
not catch a forger, and this file would rather say so than imply otherwise.

## Not a finding here

- The fixture site under `server/test/fixture/` contains a deliberately hostile
  documentation page — an injection attempt, an example API key. It is the test
  data for the guards above.
- `examples/storyboards/` records public pages only.

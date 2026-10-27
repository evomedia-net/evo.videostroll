# Changelog

Notable changes to evo.videostroll, newest first. Each entry links the pull request that made it.

Versions have five parts, `v{major}.{rc}.{beta}.{alpha}.{build}`, and the build number
advances once per release. New changes go under Unreleased in the same pull request,
and the release moves them under its version.

## Unreleased

### Fixed

- **tts:** update msedge-tts to 2.1.0, which the Edge voice endpoint accepts again ([#64](https://github.com/evomedia-net/evo.videostroll/pull/64))
- **recorder:** refuse the browser's own full screen so full-screen steps record whole ([#68](https://github.com/evomedia-net/evo.videostroll/pull/68))

### Documentation

- **changelog:** the fleet format, evo.polaris's with no date on version headings; the .txt twins underline a third-level heading with ~ ([#70](https://github.com/evomedia-net/evo.videostroll/pull/70))

### Maintenance

- **ci:** re-run a test run once when a job in it times out ([#62](https://github.com/evomedia-net/evo.videostroll/pull/62))
- **ci:** stop a hung test run after 5 minutes instead of GitHub's 6 hours ([#61](https://github.com/evomedia-net/evo.videostroll/pull/61))
- **github:** add the repository's social preview card ([#60](https://github.com/evomedia-net/evo.videostroll/pull/60))

## v0.0.1.0.1

### Documentation

- give every shell command a PowerShell form as well as a bash one ([#58](https://github.com/evomedia-net/evo.videostroll/pull/58))

## v0.0.1.0.0

### Fixed

- **docs:** decode HTML entities, so "&mdash;" is not handed to the voice ([#55](https://github.com/evomedia-net/evo.videostroll/pull/55))
- **render:** clear the previous render's thumbnails, and name them per walkthrough ([#54](https://github.com/evomedia-net/evo.videostroll/pull/54))

### Documentation

- **demo:** commit the demo walkthrough and play it on the quickstart ([#56](https://github.com/evomedia-net/evo.videostroll/pull/56))
- **site:** publish an llms.txt so the docs site is readable by its own tool ([#52](https://github.com/evomedia-net/evo.videostroll/pull/52))

## v0.0.0.1.14

### Fixed

- **docs:** stop respelling acronyms the voice already reads correctly ([#46](https://github.com/evomedia-net/evo.videostroll/pull/46))

### Documentation

- **skill:** list videostroll_docs in the skill description tool list ([#48](https://github.com/evomedia-net/evo.videostroll/pull/48))

### Maintenance

- **docs:** generate the .txt twins from their .md and check them in CI ([#49](https://github.com/evomedia-net/evo.videostroll/pull/49))

## v0.0.0.1.13

A release stamp only: no other change since the previous release.

## v0.0.0.1.12

### Added

- **docs:serve:** show a banner, link setup.html, and say how to stop ([#40](https://github.com/evomedia-net/evo.videostroll/pull/40))

## v0.0.0.1.11

### Documentation

- **setup:** one menu on every page, and the two outputs are a choice not two steps ([#37](https://github.com/evomedia-net/evo.videostroll/pull/37))

## v0.0.0.1.10

### Added

- **setup:** a form for every setting, name the output files, and make the quickstart assume nothing ([#34](https://github.com/evomedia-net/evo.videostroll/pull/34))

### Documentation

- **security:** the project's own security notes ([#33](https://github.com/evomedia-net/evo.videostroll/pull/33))

## v0.0.0.1.9

### Added

- **package:** publishable, and the skill travels with it ([#30](https://github.com/evomedia-net/evo.videostroll/pull/30))
- **docs:** read the product's own documentation before writing narration ([#28](https://github.com/evomedia-net/evo.videostroll/pull/28))

### Fixed

- **docs:** find the procedures in documentation whose headings are all nouns ([#29](https://github.com/evomedia-net/evo.videostroll/pull/29))

## v0.0.0.1.8

### Added

- **release:** refuse to build a zip whose name would not match its contents ([#25](https://github.com/evomedia-net/evo.videostroll/pull/25))
- **package:** make the npm package publishable, and stop promising two providers ([#24](https://github.com/evomedia-net/evo.videostroll/pull/24))
- **release:** package a verifiable release zip, with both checksum layers ([#23](https://github.com/evomedia-net/evo.videostroll/pull/23))

### Fixed

- **auth:** the save step called writeFile without importing it ([#21](https://github.com/evomedia-net/evo.videostroll/pull/21))
- **auth:** prove the saved session works before calling it saved ([#20](https://github.com/evomedia-net/evo.videostroll/pull/20))
- **auth:** closing the browser saves the session instead of discarding it ([#19](https://github.com/evomedia-net/evo.videostroll/pull/19))
- **auth:** explain a failed browser launch instead of dumping a stack trace ([#18](https://github.com/evomedia-net/evo.videostroll/pull/18))

### Documentation

- **quickstart:** deploy:local, the full-browser note, and a soft narrator ([#22](https://github.com/evomedia-net/evo.videostroll/pull/22))

## v0.0.0.1.7

### Added

- **install:** npm run deploy:local - one command, and it says what moved ([#16](https://github.com/evomedia-net/evo.videostroll/pull/16))

## v0.0.0.1.6

### Added

- **voices:** a web picker - filter, hear a voice, copy the line ([#14](https://github.com/evomedia-net/evo.videostroll/pull/14))

## v0.0.0.1.5

### Added

- **auth:** npm run login - sign in yourself once, and record behind it ([#12](https://github.com/evomedia-net/evo.videostroll/pull/12))

### Documentation

- the README stops restating the build number ([#11](https://github.com/evomedia-net/evo.videostroll/pull/11))

## v0.0.0.1.4

### Added

- **voice:** a voice catalogue, and a voice per step ([#9](https://github.com/evomedia-net/evo.videostroll/pull/9))

### Documentation

- a quickstart page, and the setup walkthrough that records it ([#8](https://github.com/evomedia-net/evo.videostroll/pull/8))

## v0.0.0.1.3

### Added

- M3 - the MCP surface driven end to end by a real client, interactive/batch parity, the skill finalised ([#6](https://github.com/evomedia-net/evo.videostroll/pull/6))

## v0.0.0.1.2

### Added

- **server:** M2 - a voice. Edge and Piper providers, captions timed from word boundaries ([#4](https://github.com/evomedia-net/evo.videostroll/pull/4))

## v0.0.0.1.1

### Added

- **server:** M1 - record a captioned walkthrough from a real browser ([#2](https://github.com/evomedia-net/evo.videostroll/pull/2))

## v0.0.0.1.0

### Maintenance

- scaffold evo.videostroll - plan, storyboard schema, skill draft

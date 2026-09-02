---
name: videostroll
description: Record a narrated walkthrough video of a website - the agent drives the browser, a visible cursor follows, its narration is spoken, and captions with timestamps come out alongside. Use when asked for a walkthrough, demo video, screen tour, or "show me how X works" as a video. Needs the evo.videostroll MCP server.
---

# videostroll — how to make a walkthrough that is worth watching

> **Status: draft.** This skill describes the method the tool is being built
> around. The tool names below match `PLAN.md` § 8 and will be corrected when
> the server lands.

You are about to produce a video someone will watch instead of reading. The
recorder does the mechanics. Your job is the three things a recorder cannot do:
decide what to show, say it well, and check that what you said is what was on
screen.

## 0. Before anything: reconnoitre

Call `videostroll_start` with the URL, then **read the page** the call returns
before deciding a single step. Never narrate a page you have not read. If the
walkthrough spans several pages, `videostroll_observe` your way through them
first — observing records nothing.

Write down, for yourself, in one line each:

- **Goal** — what the viewer should be able to do or understand afterwards.
- **Audience** — who is watching, and what they already know.
- **Route** — the 4–10 places on the site that carry the goal, in order.

If you cannot write the goal in one line, you do not have a walkthrough yet.

## 1. Storyboard before you record

A storyboard is a list of **steps**. One step = one idea + the action that
shows it. Draft all of them before recording any of them.

For each step:

- **Narration:** at most two sentences. One idea. Present tense.
- **Action:** the thing on screen that *demonstrates* the sentence — move the
  cursor to it, hover it, click it, scroll to it, highlight it. If nothing on
  screen demonstrates the sentence, the sentence does not belong in a video.
- **Selector, not coordinates.** `role=` and `text=` selectors survive layout
  changes; pixel positions do not.

Order steps the way a person would move through the site, not the way the
code is organised.

## 2. Say it like a person, not a manual

- **What, then why.** Say what the viewer is looking at before saying why it
  matters. "This is the projects page. Each card is one product." — not the
  other way round.
- **Plain words.** No "utilise", no "leverage", no "as you can see".
- **Present tense, active voice.** "The header stays put when you scroll."
- **Short.** A sentence you would not say out loud is a sentence that will
  sound wrong when it is.
- **Never say a secret.** No passwords, tokens, keys, internal hostnames,
  personal email addresses, or anything from an `.env`. If it is on screen,
  scroll it off or pick a different page. The server rejects storyboard fields
  that look like credentials; that is the floor. You are the ceiling.

## 3. Pace to the voice

The recorder synthesises each narration *first* and holds the step until the
voice finishes, so the voice sets the length. Your job is to keep it humane:

- Under **2.5 s** a step reads as a cut. Merge it into a neighbour.
- Over **15 s** and the viewer's eyes wander. Split it.
- One action per sentence, roughly. A click-then-scroll-then-type under one
  sentence is three steps wearing a coat.
- Let the first step breathe — a plain "This is X" over the landing page,
  cursor resting, before anything moves.

## 4. Record

Interactive: call `videostroll_step` for each storyboard step, in order.
Read the page state each call returns — if the page is not what you expected
(a redirect, a modal, an error), **stop and fix the storyboard**; do not
narrate around it.

Batch: `videostroll_render` with the whole storyboard, when the storyboard is
already proven.

## 5. Verify before you deliver

`videostroll_finish` returns the manifest. Read it back.

- Every step's **page title and URL** must be what the narration claims. A
  mismatch means the step recorded the wrong thing — **re-record it**, do not
  re-word the narration to match what happened.
- Open **three thumbnails**: first, last, and the one you are least sure of.
- Timestamps must be monotonic and the total must be roughly what you
  expected. A 40-second plan that rendered to 3 minutes had a step hang.
- Play the first ten seconds. The cursor must be visible and the voice must
  start when the first caption does.

## 6. Deliver

Hand over the output folder **and the storyboard**. The storyboard is what
makes the next version a re-cut instead of a redo: when the site changes,
edit the steps that changed and `render` again.

## What this skill will not do

- Record behind a login it was not given a storage-state file for.
- Guess a site's terms of service. Recording someone else's site is the
  operator's call, not the agent's.
- Pad. If the goal is met in six steps, it is six steps.

---
name: hackathon-speed
description: Skip writing tests and skip running the test suite so work lands fast during the hackathon. Use for every code change in this repo until the hackathon is over.
---

# Hackathon speed

This repo is a HackMIT demo on a deadline. Ship the change; do not build the
safety net around it.

## Skip

- **Do not write tests.** No new `*.test.ts` / `*.test.tsx` files, no added
  cases in existing ones.
- **Do not run the suite.** Skip `pnpm test`, `pnpm run test:launcher`, and
  `pnpm run check` (which runs the suite as its last step).
- **Do not repair existing tests** that fail only on an assertion. Leave them
  red and say so in one line. The exception is a test that no longer
  _compiles_ — a renamed type or export breaks `typecheck` for the whole
  project, so fix the reference, not the expectation.

## Still do

- **`pnpm run typecheck`** after a change that touches types, exports, or
  signatures. It takes about five seconds and catches the class of breakage
  that eats demo time: a rename that compiles nowhere.
- **Actually run the thing** when the change is user-facing. A screenshot of
  the page or a `curl` against the route is worth more right now than any
  assertion — it is the same evidence the demo depends on.
- **Say what was not verified.** One line at the end: what you ran, what you
  skipped. A teammate has to know which parts are only claimed to work.

## What this actually saves

Be honest about the trade, because it changes where the time goes:

- Authoring tests is the expensive part — a feature in this repo costs a few
  hundred lines of them. That is the real saving.
- Running the existing suite is not expensive: about six seconds for all of
  it. If a change lands near `features/live-track`, `features/body-cam`, or
  `features/paw-patrol`, a single targeted run
  (`npx vitest run features/<area>`) is a second or two and worth it before a
  demo. Offer it; do not do it by default.

## After the hackathon

Delete this skill and drop the matching section from `AGENTS.md`. Then run
`pnpm run check` once and fix whatever drifted — expect the tests skipped here
to be the first thing that fails.

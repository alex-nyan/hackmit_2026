<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Hackathon mode: skip tests

Active until the hackathon is over. For **every** task in this repo:

- Do not write tests, and do not run the test suite (`pnpm test`,
  `pnpm run test:launcher`, `pnpm run check`).
- Do fix a test that no longer **compiles** after a rename — it breaks
  `typecheck` for the whole project. Leave a merely-failing assertion red and
  say so.
- Do run `pnpm run typecheck` when types, exports, or signatures changed, and
  do actually exercise user-facing changes in the running app.
- Do state in one line what was verified and what was skipped.

Details and the trade-offs are in `.claude/skills/hackathon-speed/SKILL.md`.
Remove both when the hackathon ends.

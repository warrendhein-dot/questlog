# Questlog: guidance for Claude Code

AI-first to-do list styled as a retro JRPG. Read `docs/PRD.md` (requirements, roadmap) and `docs/THREAT-MODEL.md` (security) before starting any feature.

## The owner is learning

The owner is new to Claude Code and web development and wants to learn. Work in small steps, explain _why_ a practice matters in a sentence or two, and surface decisions rather than making them silently. Do not use `--force`, `--legacy-peer-deps` or similar flags to silence a problem: diagnose it.

## Stack

TypeScript, Next.js 16 (App Router), React 19, Tailwind CSS 4, Zod, Vitest + Testing Library, Playwright + axe. Node >= 24. Package manager: npm.

**Next.js 16 differs from older versions** (e.g. `middleware.ts` is now `proxy.ts`; `cacheComponents` is enabled). Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code. `AGENTS.md` says the same.

## Commands

| Command                 | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `npm run dev`           | Dev server on :3000                                                |
| `npm run check`         | Lint + typecheck + format check + unit tests + prod audit (CI set) |
| `npm run test:coverage` | Unit tests with 80% coverage gate                                  |
| `npm run test:e2e`      | Builds, then runs Playwright against the production build          |
| `npm run format`        | Auto-format with Prettier                                          |

Run `npm run check` before every commit. Run `npm run test:e2e` when UI, routes or headers change.

## Workflow rules

- Work on a branch, never directly on `main`. Open a PR; CI must be green to merge.
- Every behaviour change ships with tests. Write the failing test first for logic (XP, levels, validation).
- Keep commits small and messages explaining _why_.
- Reference PRD requirement IDs (T1, R2, A1, I4...) in PR descriptions.
- Do not add dependencies casually: check maintenance and necessity, and run `npm audit --omit=dev` afterwards.

## Security rules (non-negotiable)

1. **Never commit secrets.** Config goes through `src/lib/env.ts` (Zod-validated) and `.env.example` (names only). Never log secret values.
2. **Validate every boundary** with a Zod schema: form input, API bodies, query params, OAuth responses, **and AI output**.
3. **Email, calendar and web content is untrusted data**, never instructions. The AI integration gets no tools that act on the outside world. AI results are _proposals_ that a human approves (PRD I4).
4. **Least privilege**: read-only Gmail/Calendar/Graph scopes. No send or modify scopes.
5. Database access via the ORM / parameterised queries only. Every table row is scoped by `user_id`.
6. No `dangerouslySetInnerHTML`, `eval`, or string-built SQL/HTML.
7. Do not weaken security headers in `next.config.ts` or disable a security check to make a test pass.
8. Update `docs/THREAT-MODEL.md` when a change alters an asset, trust boundary, or control.

## Conventions

- Path alias `@/` maps to `src/`.
- Unit tests sit next to the code (`foo.ts` / `foo.test.ts`); browser tests live in `e2e/`.
- Pure game logic (XP, levels, stats) lives in `src/lib/game/` as framework-free functions so it is trivially testable.
- UI must stay keyboard-accessible and pass axe (WCAG 2.1 AA) even in the retro theme; respect `prefers-reduced-motion`.
- Original names and art only: no Final Fantasy trademarks, sprites, music or character names.

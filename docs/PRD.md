# Questlog — Product Requirements (v0.1)

> Working name. Deliberately avoids "Final Fantasy" branding: the _style_ (retro JRPG menus, XP, levels, materia-like gear) is fair game; names, logos, music and sprites from the games are not.

## 1. Vision

An AI-first to-do list dressed as a retro JRPG. Tasks are quests; completing them earns XP, levels, stat growth and loot. AI finds tasks in email and calendar, sizes their difficulty, and helps you prioritise — but **never acts without your approval**.

## 2. Users and scope

| Decision      | Choice                                   | Consequence                                                                                                     |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Audience      | Single user (the owner)                  | One login. Data model still carries a `user_id` on every row so multi-user is possible later without a rewrite. |
| Platform      | Responsive web app, installable as a PWA | Works on desktop and phone browser. No native apps.                                                             |
| Hosting       | Free/cheap tiers                         | Main running cost is AI API usage.                                                                              |
| Builder skill | Beginner, learning-oriented              | Mainstream stack, small steps, explained decisions.                                                             |

## 3. Functional requirements

Priority: **M** = must (v1), **S** = should (v1.x), **C** = could (later).

### 3.1 Tasks (quests)

| ID  | Function                                                | Pri |
| --- | ------------------------------------------------------- | --- |
| T1  | Create / edit / delete / complete a task (title, notes) | M   |
| T2  | Due date and priority (low / normal / high)             | M   |
| T3  | Categories/tags; each category maps to an RPG stat      | M   |
| T4  | Subtasks (checklist inside a task)                      | M   |
| T5  | Recurring tasks (daily / weekly / custom)               | M   |
| T6  | "Today" and "This week" views (the quest log)           | M   |
| T7  | Undo for completion and deletion (soft delete)          | S   |

### 3.2 RPG layer

| ID  | Function                                                                                                                                             | Pri |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| R1  | Completing a task awards XP; XP drives character level                                                                                               | M   |
| R2  | Task size (easy / medium / hard / boss) sets base XP; priority and on-time completion add bonuses                                                    | M   |
| R3  | Character sheet with stats (e.g. Work → STR, Health → VIT, Learning → MAG, Home → DEF, Social → SPR) that grow with completed tasks in that category | M   |
| R4  | Retro UI: pixel font, menu windows, blue-gradient panels, level-up animation                                                                         | M   |
| R5  | Loot: items/titles unlocked at level and streak milestones                                                                                           | S   |
| R6  | Achievements (e.g. "7-day streak", "Slayed 10 boss tasks")                                                                                           | S   |
| R7  | Anti-cheat sanity: XP can't be farmed by create/complete/delete loops (daily XP cap, XP only for tasks older than N minutes)                         | M   |

### 3.3 AI features

| ID  | Function                                                                           | Pri |
| --- | ---------------------------------------------------------------------------------- | --- |
| A1  | AI estimates task size/difficulty; user can override                               | M   |
| A2  | Break a big task into subtasks on request                                          | S   |
| A3  | Daily "quest briefing" summarising today's priorities                              | S   |
| A4  | Smart prioritisation: suggest order using deadlines and calendar gaps              | S   |
| A5  | Flavour text: RPG-style quest names and narration (original wording)               | S   |
| A6  | Every AI call is logged (prompt size, model, cost, outcome) for cost and debugging | M   |

### 3.4 Integrations (phase 2+)

| ID  | Function                                                                                     | Pri           |
| --- | -------------------------------------------------------------------------------------------- | ------------- |
| I1  | Gmail → proposed tasks, **only** from a label/allow-list the user controls                   | S             |
| I2  | Google Calendar → proposed prep/follow-up tasks                                              | S             |
| I3  | Outlook mail + calendar (Microsoft Graph) → proposed tasks                                   | C             |
| I4  | **Proposal inbox**: AI suggestions wait for accept / edit / reject. Nothing is auto-created. | M (for I1–I3) |
| I5  | Disconnect an account and purge its tokens and imported data                                 | M (for I1–I3) |
| I6  | De-duplicate: the same email/event never produces the same proposal twice                    | M (for I1–I3) |

## 4. Non-functional requirements

### Security (see also `docs/THREAT-MODEL.md`, to be written in Phase 0)

- **Least privilege OAuth**: read-only Gmail/Calendar scopes; no send/modify scopes.
- **Prompt-injection defence**: email/calendar text is _untrusted data_. The AI can only output structured task proposals (validated against a schema); it has no tools that send, delete or modify anything. Combined with the proposal inbox, a malicious email can at worst create a bad suggestion you reject.
- **Secrets**: never in git. Environment variables locally, host secret store in production. Secret scanning on every push.
- **Tokens**: OAuth refresh tokens encrypted at rest.
- **Auth**: managed auth provider (no hand-rolled passwords); sessions via secure, httpOnly cookies; allow-list restricts sign-in to the owner.
- **Input validation** on every server boundary (schema validation, e.g. Zod); parameterised DB access only.
- **Web hardening**: CSP and other security headers, CSRF protection, rate limiting on AI and auth endpoints.
- **Dependencies**: lockfile committed, automated update PRs, vulnerability audit in CI.
- **Data**: row-level security in the database, scoped by `user_id`.

### Privacy

- Only emails matching the user-defined filter are ever read or sent to the AI.
- Store the minimum: task text and a link/ID back to the source, not full email bodies.
- Clear documentation of what leaves the app (to the Claude API) and what is stored.

### Quality

- Automated tests at three levels: unit (XP/level logic), integration (API + DB), end-to-end (key user journeys).
- Accessibility: keyboard navigable, sufficient contrast even in the retro theme, `prefers-reduced-motion` respected.
- Performance: Today view interactive in under 2 seconds on a mid-range phone.

## 5. Proposed technical approach (to be confirmed in Phase 0)

| Concern                | Proposal                                             | Why                                                              |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Language               | TypeScript everywhere                                | One language, type safety catches bugs early.                    |
| App framework          | Next.js (App Router)                                 | Front end and API in one project; large community; easy hosting. |
| Database               | PostgreSQL (Supabase or Neon free tier)              | Reliable, supports row-level security.                           |
| ORM / migrations       | Drizzle or Prisma                                    | Typed queries and versioned schema changes.                      |
| Auth                   | Supabase Auth or Auth.js, with Google sign-in        | No password handling of our own.                                 |
| AI                     | Claude API via the Anthropic SDK, structured outputs | Schema-constrained output limits prompt-injection damage.        |
| Unit/integration tests | Vitest                                               | Fast, TypeScript-native.                                         |
| End-to-end tests       | Playwright                                           | Real-browser tests; can also run in CI.                          |
| Lint / format          | ESLint + Prettier + `tsc --noEmit`                   | Consistent code, caught errors.                                  |
| CI/CD                  | GitHub Actions                                       | Free for private repos at this scale.                            |
| Security automation    | Dependabot, `npm audit`, CodeQL, secret scanning     | Catches known vulnerabilities and leaked keys.                   |
| Hosting                | Vercel (preview deploy per PR)                       | Free tier; automatic preview URLs.                               |

## 6. Automated development cycle

```
idea → spec (this doc) → issue → branch → code + tests → PR
   → CI: lint · typecheck · unit · integration · e2e · security scans · build
   → preview deploy → review (AI code-review + human) → merge → production deploy
```

- `main` is protected: changes land only via pull request with green CI.
- Claude Code assists with implementation, test writing and review; the pipeline is the objective gatekeeper.
- Every PR produces build artifacts (preview URL, test report, coverage).

## 7. Roadmap

| Phase | Goal                | Done when                                                                                                                             |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Foundations         | Repo, project scaffold, CI, linting, test harness, security scanning, threat model, `CLAUDE.md` — all green with a "hello world" page |
| 1     | Core quests         | T1–T6 working with auth, database and tests                                                                                           |
| 2     | RPG layer           | R1–R4, R7: XP, levels, stats, retro UI                                                                                                |
| 3     | AI basics           | A1, A6 (then A2–A5)                                                                                                                   |
| 4     | Google integrations | I1, I2, I4–I6 with the proposal inbox                                                                                                 |
| 5     | Outlook + polish    | I3, loot/achievements, PWA install, accessibility pass                                                                                |

## 8. Open questions

1. Final product name (working: Questlog).
2. Which Gmail filter mechanism: a dedicated label (e.g. `Questlog`) vs a sender allow-list vs both?
3. Streak rules: does a missed day reset the streak, or is there a grace day?
4. XP values and level curve — to be tuned by play-testing; start with a simple formula in a single, well-tested module.
5. Should you ever want other users, what is the sign-up policy? (Out of scope for v1.)

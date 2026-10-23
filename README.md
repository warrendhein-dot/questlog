# Questlog

An AI-first to-do list disguised as a retro RPG: complete tasks to earn XP, level up and unlock loot. Optionally, AI proposes tasks from your email and calendar, and you approve each one.

Status: **Phase 0 (foundations)**. See [docs/PRD.md](docs/PRD.md) for requirements and roadmap, and [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) for the security design.

## Getting started

Requires Node.js 24 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Copy `.env.example` to `.env.local` if you need to override settings.

## Quality checks

```bash
npm run check        # lint, types, formatting, unit tests, production dependency audit
npm run test:e2e     # real-browser tests (first run: npx playwright install chromium)
```

The same checks run automatically on every pull request (GitHub Actions), plus CodeQL code scanning and Gitleaks secret scanning.

## Project layout

```
src/app/        Pages and layouts (Next.js App Router)
src/lib/        Shared logic (env validation; game rules will live in src/lib/game/)
e2e/            Playwright browser tests
docs/           Product requirements and threat model
.github/        CI workflows, Dependabot, pull request template
```

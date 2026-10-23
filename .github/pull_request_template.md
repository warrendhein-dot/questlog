## What and why

<!-- One or two sentences. Link the PRD requirement ID if there is one (e.g. T1, R2). -->

## Checklist

- [ ] Tests added or updated for the behaviour I changed
- [ ] `npm run check` passes locally
- [ ] No secrets, tokens or personal data in code, tests or logs
- [ ] New environment variables are in `src/lib/env.ts` and `.env.example`
- [ ] Anything that handles untrusted input (forms, emails, calendar data, AI output) is validated with a schema
- [ ] Docs updated if behaviour or security assumptions changed (`docs/`)

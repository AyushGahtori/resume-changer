# Local load test

Developer-only tooling for the local Firebase emulator traffic run. People using Resume Changer do not see this folder, and the deployed app does not include its sign-in helper.

The runner copies `browser-auth/` into the app for the isolated local build, then deletes that copy. `src/app/e2e/load-test-auth/` is gitignored so a crashed build cannot leave the helper in the product.

```bash
npm run test:load:estimate -- --users 1000 --seed 42
npm run test:load:smoke
npm run test:load -- --users 1000 --concurrency 100 --browser-percent 5 --seed 42
npm run test:load:cleanup -- --run-id <run-id>
```

Runs stay on `127.0.0.1` with the demo project `demo-resume-changer-loadtest`. They do not call Vercel, live Firebase, or an AI provider. A local result is not evidence about hosted capacity. The decisions are in `docs/non-ai-load-testing-plan.md`.

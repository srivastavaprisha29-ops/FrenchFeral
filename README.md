# FrenchFeral

A French practice site with lessons, grammar, and learner dashboards. Guest progress stays in the browser. On the hosted Site, learners can sign in with ChatGPT and optionally import guest progress to sync across devices.

## Build and publish

Run `node scripts/build.mjs` to package the frontend assets and Worker entrypoint. The tracked Sites manifest binds D1 as `DB`. The SQL migration under `drizzle/` creates the progress table at deployment. The repository can also be served with `python3 -m http.server 8000` for local guest practice.

## Learner data

The Worker reads learner identity from the Sites sign-in gateway and derives the database row key from it. A row stores cumulative counts, a streak, current mastery and review flags, and the active daily lesson. It excludes email addresses, exercise answers, audio usage, and session histories. A revision check protects concurrent writes. **Account** lets learners import local progress, reset progress, delete their FrenchFeral D1 row, or sign out. Their ChatGPT account is managed separately.

## Release checks

While signed out, check that the homepage and sample lesson work and that the progress API returns 401. Then sign in with two distinct ChatGPT accounts and verify each sees its own dashboard, import is available for an existing guest session, and changes sync to a second browser. Delete the test learner's synced data and verify its dashboard resets while the other learner's data remains.

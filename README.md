# FrenchFeral

A browser-based French practice site for student life in Paris. Guest practice works immediately. Accounts and cross-device dashboards use a separate Supabase project.

## Run locally

From the repository root, run `python3 -m http.server 8000` and open http://localhost:8000/. Try a sample lesson from the homepage and open **Dashboard** to see local progress.

## Enable accounts before public launch

1. Create a dedicated Supabase project for FrenchFeral. Apply [supabase/schema.sql](supabase/schema.sql) in its SQL Editor. It restricts progress to the authenticated row owner and provides a self-delete operation that cascades to progress.
2. In [account-config.js](account-config.js), set the project URL and the **publishable** key. The key in this file is public. Keep secret and service-role keys out of the frontend.
3. Enable email/password authentication with email confirmation. Set the production Site URL and allow the exact deployed root URL and your development URL under Authentication URL Configuration. Configure production SMTP for verification and password recovery.
4. Serve the repository root on an HTTPS static host. Visitors can practice as guests. Create an account or sign in to sync progress. On **Account**, select **Import practice from this browser** to claim existing local progress. An account can claim once. Existing aggregate counts use the larger value on either side to avoid double-counting overlapping practice, and mastery is merged by lesson.
5. Verify with two separate learners. Confirm each account sees its own data, syncs to a second device, recovers a password, and can reset progress or delete its own account. In the API, a guest should have zero access and account A must be unable to read or alter account B’s row.

## Data stored

Supabase Auth holds the learner's sign-in identity. The progress table contains one summary per account covering completion and checkpoint totals, per-lesson mastery, current review status, active daily assignment, and streak. Written answers, listening activity, and individual session history are excluded. Signed-in updates sync while the page is open. If syncing fails, keep the page open and select **Account → Retry sync**. Guest practice is browser-local until imported.

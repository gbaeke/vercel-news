# Repository operating notes

- Production deploys to Vercel are triggered by committing and pushing this repository. Do not use a separate deployment path unless the user explicitly requests one.
- Production data lives in Neon Postgres. Treat every schema change as a production migration: keep `lib/schema.sql` idempotent, test the migration against local Postgres, and explicitly call out the required production migration before deployment.
- Never run a migration against the production Neon database without explicit user authorization.

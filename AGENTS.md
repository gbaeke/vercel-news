# Repository operating notes

- Production deploys to Vercel are triggered by committing and pushing this repository. Do not use a separate deployment path unless the user explicitly requests one.
- Production data lives in Neon Postgres. Treat every schema change as a production migration: keep `lib/schema.sql` idempotent, test the migration against local Postgres, and explicitly call out the required production migration before deployment.
- Never run a migration against the production Neon database without explicit user authorization.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

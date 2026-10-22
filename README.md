# Relay Distribution

Inventory, sales tracking and client ordering built with React, Vinext, Cloudflare D1 and Zod.

## Run locally

Use Node 24 and pnpm 11.25.0. Run `pnpm install --frozen-lockfile`, `pnpm build`, then apply `drizzle/0000_flimsy_genesis.sql` using Wrangler D1 local execute against `dist/server/wrangler.json` with persistence `.wrangler/state`. Run `pnpm dev` and open the printed localhost URL.

The anonymous interface is a labeled interactive demo. Its changes are temporary. Signed-in users load real database records. Local sign-in is simulated by the starter only on loopback development; production sign-in is provided by Sites.

## Runtime configuration

Set D1 binding `DB`. Inject `STAFF_USER_IDS` or `STAFF_EMAILS` as comma-separated allowlists. Empty allowlists grant no staff privileges. For local staff testing, set STAFF_USER_IDS to the starter's documented local identity in an ignored `.dev.vars` file. Never put production tokens, passwords, or configuration values in source.

Production requires the trusted Sites authentication gateway. Do not expose the raw Worker directly: identity headers must be supplied by the trusted gateway, not arbitrary clients. New hosted sites are private; client rollout requires configuring hosting access separately from application roles.

## Features

Staff can create/edit/archive products, adjust inventory, view delivered revenue, and progress or cancel orders. Clients can browse, use the cart, place orders and see their own history. Prices are calculated on the server. Atomic reservations prevent negative stock; cancellation restores inventory once. Product archiving preserves order history.

Strict Zod schemas reject unknown fields and invalid query/path inputs. JSON bodies are bounded to 32 KiB. Writes enforce same-origin requests and a verification header. All database values use prepared bindings. Audit records track stock changes and order transitions. Orders support idempotency keys.

## Checks

`pnpm typecheck`, `pnpm test`, and `pnpm build`. GitHub Actions runs these on pushes and pull requests. Tests cover transactional inventory races, cancellation, request validation, CSRF and client isolation.

Revenue is delivered order value, not collected payments. There is no payment processing, tax calculation, or carrier integration. Product/order lists are bounded; API limit/offset parameters are available for future pagination UI.

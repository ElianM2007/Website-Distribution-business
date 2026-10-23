# Relay Distribution

Inventory, sales tracking and client ordering with React, Vinext, Cloudflare D1 and Zod.

## Accounts and access

The application uses its own database-backed email/password accounts. New registrations remain pending until an administrator approves them. Pending and rejected accounts cannot read products, categories or orders. Every protected request rechecks account approval, so revocation takes effect immediately. Clients can read only their own orders; only administrators manage products, categories, stock, order statuses and account approvals.

Passwords are salted and hashed; plaintext passwords are never stored. Session tokens are random, hashed in the database and sent in HttpOnly cookies. Authentication routes enforce request validation, same-origin checks and persisted rate limits. ChatGPT identity headers do not grant application access.

## Owner setup

Inject `OWNER_EMAIL` and a cryptographically random `OWNER_SETUP_TOKEN` at runtime. Do not commit either value. Open the owner setup form, enter the configured email, your own password and setup token. Owner creation is one-time and cannot be claimed by ordinary registration. After setup, remove the runtime setup token and redeploy. Keep the owner password in your password manager, not in chat or Git.

Only the sign-in and registration pages are accessible to the public. The hosting audience must permit anonymous access to these pages to avoid an additional platform sign-in screen; the application independently protects all business data.

## Run locally

Use Node 24 and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm build
```

Set local runtime values in an ignored `.dev.vars` file. Apply pending SQL migrations in filename order, once each:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/<pending-migration>.sql
pnpm dev
```

Open the printed localhost URL. Local and hosted databases are separate. Hosted migrations are applied by Sites during deployment. No production products, categories, customers or passwords are seeded.

## Ordering

Approved clients choose delivery or pickup. Delivery requires an address; pickup does not. Cart quantities can be entered directly. The server calculates prices and reserves inventory atomically, and a successful checkout displays an order-number confirmation. Orders are shared through the online database, and active order screens refresh every 15 seconds.

Administrators confirm and prepare orders. Delivery orders progress to shipped and delivered; pickup orders can be marked collected after confirmation. Cancellation restores inventory once. Archiving a product preserves its order history. Revenue represents completed order value, not collected payment.

## Validation and source control

Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. CI runs these on GitHub. Tests cover stock races, cancellation, authorization, approval, sessions, CSRF and request validation. Database values use prepared bindings and inputs use strict Zod schemas. JSON bodies are limited to 32 KiB.

See [source-control policy](docs/SOURCE-CONTROL.md). Authored source, migrations, tests and lockfiles are committed to GitHub. Secrets, live data, dependencies and generated cache/build artifacts are excluded.

There is no payment processing, tax calculation, carrier integration or email-based password recovery. Approval is a business authorization decision, not email ownership verification. Existing orders retain their original customer IDs when authentication changes; they are not automatically attached to new accounts by an unverified matching email.

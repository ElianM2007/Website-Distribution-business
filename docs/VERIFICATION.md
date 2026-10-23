# Verification: database accounts and pickup

- TypeScript check: passed.
- Backend test suite: 24 passed, 0 failed.
- Actual local Cloudflare Worker smoke test: passed.
- Browser inspection: email/password sign-in form rendered with registration and owner setup entry points.

The Worker smoke test exercises password hashing in the actual runtime, session creation, pending registration, owner approval, client permissions, category/product creation, a 12-unit pickup order, manager confirmation/completion, revocation and logout. It rejects non-loopback targets and creates only local QA records. Run `node tests/worker-smoke.mjs` with the dev server running and a dedicated local QA `.dev.vars` configuration. The test stores its generated QA owner password only in ignored `.sites-runtime/test-owner.json`; never use it against production.

The production owner must choose their own password using the one-time owner setup form. No production password is generated or embedded in the source. Existing production business records are preserved; the migration adds account/category tables and a delivery-default fulfillment column.

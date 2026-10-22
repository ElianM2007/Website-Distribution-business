# Relay Distribution implementation

The initial scope is a distribution workspace for inventory, sales tracking, and client orders. It does not collect card details or process payments. Revenue represents delivered orders, not payment settlement.

## Parallel work

| Workstream | Responsibility |
| --- | --- |
| Frontend agent | Staff dashboard, inventory editor, order workflow, client catalog and cart, responsive styling, accessible feedback |
| Backend agent | Verified identity, server-side roles, API validation, database schema, atomic stock and order changes, security tests |
| Integrator | Project setup, Git history, CI, local/browser verification, runtime configuration and private deployment |

## Acceptance checks

- Anonymous requests cannot read business records or mutate data.
- Authenticated clients see only their own orders and cannot change inventory or order statuses.
- Staff can create and edit products, archive products, adjust stock with a reason, and progress orders.
- Order prices come from the database; clients cannot supply totals.
- Stock cannot become negative, and cancellation cannot restore stock twice.
- Invalid JSON, unexpected properties, oversized bodies, invalid IDs and cross-origin writes fail safely.
- Sample data is visibly labeled and does not populate the production database.
- Runtime configuration contains staff allowlists; source contains no passwords, tokens or secret values.
- The production build and relevant automated tests pass before handoff.

## References

The user provided two YouTube links as loose inspiration: https://www.youtube.com/watch?v=2-h2mEf_zcQ and https://www.youtube.com/watch?v=z7tqhsxtQpU&t=937s. Their video content was unavailable to the tools in this session, so no claim is made that the videos were watched or reproduced.

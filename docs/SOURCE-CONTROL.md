# Source control

The complete application source is tracked in this repository, including UI components, API endpoints, database schema and migrations, tests, CI, assets, dependency lockfile and configuration templates.

Completed changes are committed and pushed to GitHub. The default `main` branch is kept current after verification; the `codex/relay-distribution` branch retains the same implementation history.

Runtime secrets, password hashes, sessions, customer records, local database files and deployment credentials are never committed. Generated dependencies and build/cache directories are reproducible from the tracked source and lockfile and are excluded from Git.

To check that a checkout is synchronized, run `git status --short`, `git fetch github`, and compare `git rev-parse HEAD` with `git rev-parse github/main`. A clean status and matching commit IDs confirm that all authored changes are committed and pushed.

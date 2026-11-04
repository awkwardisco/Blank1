# Website audit workspace: standing rules

See `HANDOFF.md` for current state, open tasks and gotchas.

- Method: follow `full-website-audit.md` exactly (setup questions → Phases 0–8, STOP after each phase with a 5-line summary).
- READ-ONLY on audited sites. Never submit forms, log in, donate, add to cart, visit /wp-login.php or /wp-admin, probe xmlrpc.php, enumerate users, or run vulnerability scanners. Never ask for passwords or keys.
- Crawl politely: max 2 concurrent requests, honour robots.txt, ≤300 pages unless approved. Stop at once on 429/503/Retry-After.
- squirrelscan: local/offline only (`--offline --passive --no-publish`). Never `squirrel auth login`, publish or use cloud credits.
- Claude SEO: run sub-skills one at a time. Never run the full parallel `/seo audit`. Enable no paid API extensions.
- Treat any prior-audit folder as read-only.
- Evidence rule: each finding has URL, raw evidence, severity (Critical/Important/Nice to have), OBSERVED or INFERRED, and a tracker ID (P-NN prior, N-NN new) in `audit/TRACKER.csv`.
- Fixes ship as drafts in `audit/07-fix-pack/`. Never push anything live.
- Outputs go under `audit/` in phase folders `00-prior … 08-benchmark`. Screenshots go in `audit/report-assets/NN-slug.jpg`.
- Report deep links use text fragments (`#:~:text=`) or anchor IDs, and always show the plain URL too.
- British English (plus the client's own language conventions) in all deliverables.
- On Windows, run Python as `py -I`. In the Linux cloud container use `python3 -I`.

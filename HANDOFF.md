# HANDOFF: phased website audit (finished for biblesociety.sg; next: a new site)

## 1. Goal
Run a read-only, phased audit of a charity/non-profit website: technical SEO, AI search readiness (GEO/AEO), UX/conversion and content/E-E-A-T. The method is defined in `full-website-audit.md` (a slash-command prompt; `$ARGUMENTS` = site URL). The first run, for https://www.biblesociety.sg (BSS), is complete. The deliverables are a tracker, a phase-by-phase evidence folder, `REPORT.md`, a draft fix pack (never applied live), and a leadership-facing HTML report with screenshots, deep links and a peer benchmark. The next session repeats the whole audit for a **different website**, reusing the method, scripts and report layout below.

## 2. Current state (BSS run, all under `audit/`, local to the user's machine, NOT in this repo)
- **Done:** Phases 0–5 and 7, plus the benchmark (extra, user-requested).
  - `00-prior/PRIOR-FINDINGS.md`, `00-prior/ARCHITECTURE.md`
  - `01-squirrelscan/` (audit id `1d204903`)
  - `02-technical-schema/`, `03-geo-aeo/` (incl. `ai-answer-check.csv`), `04-content-eeat/`
  - `05-ux-content/biblesociety-website-audit.md`
  - `07-fix-pack/` (titles-meta.csv, schema-jsonld.json, robots-txt-proposed.txt, llms.txt, copy-rewrites.md, README.md)
  - `08-benchmark/` (score.py, sites.txt, seo-readiness-scores.csv, pages/)
  - `TRACKER.csv` (105 rows: P-01..P-54 prior, N-01..N-51 new), `REPORT.md`, `ACCESS-REQUEST.md`, `RESUME.md`
- **Published report:** `report.html` + `report-assets/01..24-*.jpg`, published as a private claude.ai artifact (v4). Sections:
  - summary, with 5 priorities, each with a thumbnail and links
  - progress, scorecard, critical issues
  - `#evidence` screenshot gallery
  - `#benchmark` (SEO readiness /100 and clicks-to-donate)
  - findings (`#f-tech #f-ai #f-ux #f-content`), plan, where fixes are made, quick wins, not checked, re-audit
- **Half-done:**
  - Phase 6: PageSpeed is done (`06-ground-truth/psi-summary.csv`, via the web UI). The Search Console, GA4 and Bing exports were never received; see `06-ground-truth/GSC-EXPORT-REQUEST.md` and `PHASE6-STATUS.md`.
  - The Perplexity AI answer check was not run (CAPTCHA).
  - Phase 8 monitoring was not set up, by design: the site still rate-limits crawlers.
- **Broken:** nothing in the deliverables. The BSS site itself still locks out fast crawlers (finding P-01).

## 3. Decisions made (don't re-litigate)
- **Read-only, always.** No form submits, logins, donations or admin URLs. Donation journeys are counted up to the amount/payment step and stop there. A user-supplied admin can log in later; Claude never asks for passwords.
- **Fix pack = drafts only.** The vendor or content team applies them. Placeholders like `[[UEN]]` must be confirmed by the organisation.
- **robots.txt proposal uses exact paths** (`/test/`, `/test-donate/` …), not the prefix `/test`. Rejected because `/test` also blocks `/testimonies/`.
- **AI crawlers:** keep search/citation bots allowed (OAI-SearchBot, PerplexityBot, ChatGPT-User). Training bots (GPTBot, Google-Extended, CCBot) are a leadership choice; don't decide it for them.
- **llms.txt** is optional and low priority. Google ignores it.
- **CrUX field data from PSI is often origin-level** (`identifier=origin`), so report it as site-wide, not per page.
- **Scores:**
  - The instruction file says "no invented numeric scores", and the RAG scorecard stays qualitative.
  - The user later explicitly asked for an SEO readiness score out of 100, so the benchmark uses `08-benchmark/score.py`.
  - Always label it a readiness checklist of the raw HTML, not Google data or traffic.
- **Benchmark peers:**
  - Same-sector bodies abroad (other Bible Societies).
  - A local best-practice charity (Singapore Red Cross).
  - The org's own sub-brands (SowCare, Hope Initiative Alliance).
  - A global gold standard (charity: water).
  - Pick the low-friction donation example from these. Bible Society Australia's 1-click overlay was the best.
- **Report deep links:**
  - Use text fragments, `URL#:~:text=Exact%20visible%20text` (Chrome, Edge, Safari), or an existing anchor ID.
  - Always also show the plain URL.
  - Rejected: links without plain URLs, because Firefox ignores the highlight.
- **Report images** must sit beside the text they illustrate. The user rejected a decorative Bible House photo in the summary as irrelevant.
- **Spelling:** British/Singapore English in all deliverables.

## 4. Architecture and conventions
- **Folder layout:** `audit/` holds `00-prior … 08-benchmark`, `raw/` (robots.txt, sitemaps, homepage.html) and `report-assets/` (`NN-short-slug.jpg`, 800px wide JPGs).
- **Tracker IDs:**
  - `P-NN` = prior-audit finding (keeps the prior wording).
  - `N-NN` = new finding.
  - Statuses: FIXED / STILL OPEN / PARTLY FIXED / REGRESSED / CAN'T VERIFY.
  - Every finding has URL, evidence, severity (Critical/Important/Nice to have) and OBSERVED/INFERRED.
- **Scripts (local to the BSS run; not yet in this repo):**
  - `02-technical-schema/analyse_pages.py` extracts title, meta, H1, canonical, JSON-LD and alt from saved HTML into `page-facts.csv`. It strips `<!-- -->` first.
  - `fetch-priority.sh` / `04-content-eeat/fetch-phase4.sh`: polite sequential curl, 20 s apart, saving `.html` and `.headers`.
  - `06-ground-truth/psi_run.py`: public PSI API, with a `PAGES` list at the top.
  - `08-benchmark/score.py`:
    - Reads `pages/{id}-home.html`, `-don.html`, `-home.headers`, `-robots.txt` and `-llms.txt`.
    - Scores out of 100: indexing 30, schema 20, content/sharing 20, AI readiness 15, delivery 15.
    - Writes `seo-readiness-scores.csv`. Edit `ids`/`names` at the top for new peers.
- **report.html conventions:**
  - Colour tokens on `:root`, with dark-mode overrides: `--accent --crit --warn --ok --muted --line --surface`.
  - Fonts: Literata, IBM Plex Sans, IBM Plex Mono.
  - Components: `.priorities .prio .pthumb .plinks`, `.gallery figure.ev[#ev-*]` with `a.shot` + `figcaption .where .url`, `.bars .bar(.me|.goal)`, `.tbl table`, `.chip green|amber|red`, `.callout`, `.note`.
  - Figure IDs are `ev-<slug>`, and the critical-table "On the site" column links to them.

## 5. How to run things
- Python on Windows: `py -I script.py` (`python` was a Store alias). Add `sys.stdout.reconfigure(encoding='utf-8')` when printing Unicode. In a Linux cloud box use `python3 -I`.
- **squirrelscan** (local only). Config is in `01-squirrelscan/squirrel.toml`: concurrency 2, per_host 1, delay 1500 ms, respect_robots, excludes for wp-login/wp-admin/xmlrpc/wp-json/author.
  ```
  squirrel audit https://SITE --level surface -m 100 --offline --passive --disable-discovery-probes --no-publish -f json -o squirrel-surface.json
  squirrel report --diff <audit-id> --format llm
  ```
- **Benchmark:** `cd audit/08-benchmark && py -I score.py` (fetch pages first with curl, a browser UA and `--compressed`, 4 s apart).
- **PSI:** `py -I 06-ground-truth/psi_run.py`. If it returns 429, use https://pagespeed.web.dev in a browser instead.
- **Claude SEO plugin:** run sub-skills one at a time (`claude-seo:seo-technical`, `seo-schema`, `seo-geo`, `seo-content`). Never run the full parallel `/seo audit`, and enable no paid API extensions.
- **UX phase:** the `website-audit` skill, on the priority pages only.
- **Env vars:** none required. PSI is used keyless.

## 6. Open tasks (next session = new site)
1. **Start now:** get `full-website-audit.md` into the repo (the user must paste it; see §8). Then ask the new site's 7 setup questions in one message and wait. Create `audit/` with the same subfolders.
2. Phase 0: architecture fingerprint and robots/sitemaps into `audit/raw/`. Propose ~12 priority pages, and confirm which domains are in scope.
3. Phases 1–5 with a STOP after each (5-line summary, then wait for "continue"). Keep `TRACKER.csv` current.
4. Phase 6: PSI for the top 5 pages, and request GSC/GA4/Bing exports early (reuse `GSC-EXPORT-REQUEST.md` wording).
5. Phase 7: `REPORT.md`, the fix pack and `report.html`, using the BSS layout: screenshots with deep links, a thumbnail and links on each summary priority, and `#benchmark` with a peer score and clicks-to-donate.
6. **BSS leftovers (only if asked):** fold in GSC exports when they land in `audit/06-ground-truth/exports/`; Perplexity check; Phase 8 after P-01 is fixed.

## 7. Gotchas
- **WAF lockouts:** WordPress + Wordfence returned 503 `Retry-After: 3600` to the whole IP, including robots.txt, after a 100-page crawl at 1.5 s delay. Wait it out (about 1 h). Afterwards fetch about 1 page every 20 s. Stop immediately on any 429/503.
- **PSI API:** the keyless quota (429) ran out fast; the pagespeed.web.dev UI works. A hidden browser pane stalls runs; take screenshots to nudge it.
- **Commented-out tags:** a commented-out `<!-- <title></title> -->` fooled the parser. Strip comments before regex parsing.
- **Old domains:** the alternate domain (bible.org.sg) 301'd its homepage, but deep pages returned 200 unstyled. Always test deep URLs on alternate domains.
- **JS-rendered peers:** Next.js peers (Bible Society England & Wales) serve thin HTML (title "Home"), so raw-HTML scores understate them. Say so in the report.
- **Blocked actions:**
  - Perplexity shows a CAPTCHA; don't attempt it.
  - pdfcraft only opens files under Documents\PdfCraft, so copy the PDFs there first.
- **Parsing gotchas:**
  - `curl --http2` is unsupported in this Git Bash curl.
  - Bash heredocs containing many apostrophes broke once; write files with the Write tool instead.
  - A regex that removed CSS lines left a dangling `@media{`; re-check `<style>` after scripted edits.
- **Screenshots:**
  - Set the viewport to 1280×800 for desktop or 375 for mobile, then reset to desktop.
  - Artifact pages need the user's claude.ai sign-in, so they can't be checked in the built-in browser.
  - In local `file://` previews, relative images don't load.
- **Orphaned pages:** a page reachable only by URL or sitemap (the BSS Bible-A-Month Club) looks "missing" to the client. Check the menu and Donate links, and report orphans explicitly.

## 8. Things the cloud session can't see
- `C:\Users\marlon.ingle\ClaudeCode\General\SEO UX Audit\full-website-audit.md`: the master instructions (121 lines). **The user must commit or paste it.**
- The whole BSS `audit/` folder (scripts, `report.html` template, fix-pack examples). To reuse them, the user should commit at least:
  - `08-benchmark/score.py`
  - `02-technical-schema/analyse_pages.py`
  - `06-ground-truth/psi_run.py`
  - `01-squirrelscan/squirrel.toml`
  - `report.html`
  - `07-fix-pack/*`
- The prior-audit PDFs for the new site (the user provides the path, or uploads them).
- **Installed tools:**
  - squirrelscan CLI and skills (`audit-website`, `squirrelscan`)
  - the Claude SEO plugin 2.5.0 (`claude-seo:*`)
  - the `website-audit` skill
  - the built-in browser / Claude in Chrome (for screenshots, PSI UI, AI answer checks in ChatGPT and Google AI Mode)

  The cloud session may lack all of these; check first and tell the user.
- **Logged-in sessions:** ChatGPT and Google, used for the AI answer check. Never ask for credentials; the user runs those queries or logs in themselves.
- **The published report:** https://claude.ai/artifact/5o7eQn7sd1K9gwKKESv4bE (private; the owner shares it).
- **No secrets** are used anywhere in this workflow.

## 9. Cloud environment check (added in the first cloud session, 2026-11-04)
- `squirrel` CLI: **not installed** in the container. Python 3 and curl are present.
- Headless Chromium + Playwright are pre-installed (usable for screenshots).
- Outbound network access depends on the environment's network policy; the audited site must be reachable or on the allowed-domains list.
- The repo was empty (no commits) at this point; `full-website-audit.md` and the BSS scripts have not been added yet.

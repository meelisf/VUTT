# Prerender full-text for SEO discoverability + AI-bot policy

**Date:** 2026-07-03
**Status:** Design (approved for spec review)

## Problem

Google Search Console reports ~1,660 `/work/{id}` and `/persons/{id}` pages as
**"Crawled – currently not indexed"** (only ~437 indexed). Diagnosis: the pages are
technically fine (correct self-referencing canonicals — verified), but the bot-facing
prerendered HTML (`build_meta_html`) contains **only bibliographic metadata** (title,
creators, year, place, publisher, archive refs). ~2,000 work pages therefore look
**thin and structurally near-identical** to Google's quality layer → crawled but not
indexed.

The actual mission problem is the mirror image: **nobody knows the corpus exists.** The
material is substantial but undiscoverable because the unique content — the transcribed
text itself — is never exposed to search engines.

(Separately, the "Alternative page with proper canonical tag" report is a single page,
`/stats`, canonicalizing to `/` by design — intentional, not addressed here.)

## Goal

Expose each work's full transcribed text in the bot-facing prerender so search engines
can index the corpus by its actual words — **while not inviting AI-training scrapers to
hammer the server**, particularly the scanned page images (the expensive, scrape-attractive
asset; the concern that drives peers like Uppsala to deploy Anubis).

## Constraints & context

- **Moving target:** transcriptions are edited continuously. Whatever is exposed must
  stay current at crawl time, and edits must (eventually) prompt Google to re-crawl.
- **Whole-work pages, not per-page URLs.** ~20k page-level URLs would balloon the sitemap
  and crawl surface for negligible benefit. One rich page per work.
- **AI-bot blocking is non-trivial and partly futile via robots.txt.** Compliant bots
  (GPTBot, Google-Extended, CCBot, ClaudeBot) honor it; the aggressive/unlabeled scrapers
  ignore it and spoof UAs. Genuine enforcement (Cloudflare AI Labyrinth, Anubis PoW) is a
  separate, heavy project — explicitly out of scope.
- Text is cheap bandwidth; **images are the load risk.** Image protection must be
  UA-agnostic (rate-limit), not reliant on bot cooperation.

## What each protection layer actually buys us (honest accounting)

| Layer | Stops | Doesn't stop | Cost | Status |
|---|---|---|---|---|
| robots.txt AI rules | Compliant AI bots | Anything ignoring it | Free | **New (this work)** |
| Image rate-limit (per-IP, nginx) | Bulk image download load — UA-agnostic | Distributed/rotating-IP scrapers | Low | **Already deployed** |
| Anubis / Cloudflare PoW | Almost everything | — | High infra | Deferred (future project) |

The rate-limit is the real teeth because it doesn't care whether a bot identifies itself.
robots.txt is free politeness that catches the well-behaved AI crawlers. That's the honest
baseline; true AI-proofing is named but not attempted here.

## Design

### Part A — Full work text in the prerender  *(substantive; in git)*

**Where:** `build_meta_html(work_id, ...)` in `server/metadata_handler.py`, served to bots
via `GET /meta/work/{work_id}` (`server/routers/public.py`).

**Extract pure text helpers to a neutral module (avoid heavy import).** Do **not** import
the full Meilisearch indexing module into `metadata_handler.py` — it risks cyclic/heavy
imports and indexing side-effects. Move the pure text functions `split_marginalia`
(`meili_doc.py:41`), `clean_text_for_search` (`:60`), `_clean_search_text` (`:93`), and the
new `read_work_page_texts` into a small neutral module (e.g. `server/text_reading.py`).
`meili_doc.py` and `metadata_handler.py` both import from there (keep back-compat re-exports
in `meili_doc.py` if anything imports them by that path).

**Text source (reuse the indexer's path):** the Meilisearch indexer already reads page
text authoritatively at `server/meili_doc.py:~640-683` — enumerate the work's page images
in sorted order, read `data/{slug}/{base}.txt` (fallback to page `.json` `text_content`
when the `.txt` is missing/empty). Factor this enumeration+read into the shared helper
`read_work_page_texts(work_path) -> list[(page_num, raw_text)]` so the prerender and the
indexer stay consistent and don't drift.

**Cleaning:** run each page's raw text through `clean_text_for_search()` — joins line-end
hyphens, strips all VUTT XML/markdown markup → readable prose. Include **main text +
marginalia** via `_clean_search_text(page_text)` which returns `(main_clean, marginalia_clean)`.

**Rendering (preserve page context):** render **per page**, not one flat blob, so page
context survives for both indexing and debugging. Append after the bibliographic block and
before the nav back-links, e.g.:

```html
<section data-page="12">
  <p>… cleaned main text of page 12 …</p>
  <p class="marginalia"><em>Ääremärkused:</em> … cleaned marginalia …</p>
</section>
```

Use a lightweight per-page wrapper (`<section data-page="N">`), not an `<h2>` per page
(noisy in large works). Keep everything else (canonical, OG/DC tags, cross-links)
unchanged. Escape via the existing `_escape` helper.

**Not cloaking — same public content the user sees.** The prerender contains the **same
public transcription that is available to the user in the SPA** — no SEO-only hidden text.
This keeps dynamic rendering within Google's acceptable use (equivalence of bot and user
content) and avoids any cloaking concern.

**Moving target → live but cheap (caching):** the endpoint already rebuilds fresh per
request, so text is current at crawl time. To avoid re-reading/cleaning N page files on
every crawl, add a **per-work HTML cache** keyed on
`max(_metadata.json mtime, all page .txt/.json mtimes considered by the reader)`. The
`_metadata.json` mtime is **required** in the key — otherwise a bibliographic-only edit
(title/author/year/publisher) would leave the bot-facing HTML stale. Any change → key
changes → next crawl rebuilds; otherwise serve cached HTML. Mirrors the existing
`_home_cache` pattern in `public.py`. Cache entry: `{work_id: (cache_key, html)}`;
invalidate implicitly by key mismatch.

**Large-work guardrail (size):** log the rendered HTML byte size per work in debug/manual
mode and emit a warning when uncompressed HTML exceeds a conservative threshold
(~1.5–1.8 MB). Rationale: Google documents a **15 MB per-file fetch cap** for Googlebot,
and very large / text-diluted pages tend to index less reliably; the exact "effective text
budget" is not officially specified, so treat this as a monitoring signal, not a hard rule.
Most works are far below this, but a decision is pre-registered for the rare oversized work:
**accept truncation** (cap at N pages / M bytes with a "full text in app" note) rather than
silently emit multi-MB HTML. "Full text" is therefore best-effort for exceptionally large
works — this does **not** imply per-page URLs.

**Access gating:** unchanged — honor `is_work_public` / `can_read_work`. Restricted works
get **no text** (as today; `work_meta` already returns 403 for unauthorized).

### Part B — Sitemap `lastmod` reflects text edits  *(small; in git)*

**Where:** `build_sitemap_xml()` in `server/metadata_handler.py:426`.

Today work `lastmod` = `_metadata.json` mtime, which **does not change when page text is
edited** → Google never learns to re-crawl edited transcriptions. Change work `lastmod` to
`max(page file mtimes, _metadata.json mtime)`. Reuse the same page-enumeration helper from
Part A (bounded cost; sitemap is already cached in `_sitemap_cache`). Person `lastmod`
(from `updated_at`) is unchanged.

**`lastmod` is a hint, not a guarantee.** Google treats sitemap `lastmod` and submission as
signals, not commitments; "Crawled – currently not indexed" explicitly means Google has
seen the page and may still choose not to index it. This change removes a real blocker (no
freshness signal at all today) but does not guarantee re-crawl or indexing.

### Part C — robots.txt AI-bot rules  *(tiny; in git)*

**Where:** `public/robots.txt` (built into `dist/`, served static by nginx).

Add robots.txt tokens that opt out of known AI-training / AI-ingestion crawlers, keeping
search engines fully allowed. These are **robots.txt product tokens**, not necessarily
distinct HTTP User-Agents:

```
# --- AI training / ingestion opt-out (see maintenance note) ---
User-agent: GPTBot          # OpenAI model-training crawler
Disallow: /
User-agent: Google-Extended # robots.txt token: opts out of Gemini training/grounding
Disallow: /                 #   — does NOT affect Google Search crawling or ranking
User-agent: CCBot           # Common Crawl
Disallow: /
User-agent: ClaudeBot       # Anthropic
Disallow: /
User-agent: anthropic-ai
Disallow: /
User-agent: Bytespider      # ByteDance
Disallow: /
User-agent: PerplexityBot   # POLICY CHOICE — see note below
Disallow: /
```

Retain the existing `User-agent: *` rules (which already `Disallow: /api/`, covering images
for compliant bots) and the `Sitemap:` line.

**Wording precision (important):**
- **`Google-Extended`** is not a separate crawler UA. Google crawls with its normal UAs;
  this token only opts the site out of Google using crawled content for **Gemini training
  and grounding**, and Google states it **does not affect inclusion or ranking in Google
  Search**. Frame it as "opt out of Google-Extended uses while leaving Google Search
  crawling allowed" — not "block the Google-Extended crawler".
- **`GPTBot` vs `OAI-SearchBot`:** OpenAI distinguishes `GPTBot` (training opt-out) from
  `OAI-SearchBot` (ChatGPT-search visibility); they can be allowed/blocked independently. We
  block `GPTBot` (training) and, by default, leave `OAI-SearchBot` unlisted (i.e. allowed)
  so ChatGPT-search referrals remain possible — flag this as a reviewable choice.
- **`PerplexityBot` is a policy choice, not the same category.** Perplexity documents
  `PerplexityBot` as a **search/indexing** crawler "not used to crawl content for AI
  foundation models," and recommends allowing it for visibility in Perplexity answers.
  Blocking it therefore trades away Perplexity-answer/referral visibility. It is included
  here only as a conservative "AI-mediated use is not a priority" stance (and amid reports
  of stealth crawling). **Decision needed:** keep the block, or allow it for referral
  visibility.

**Maintenance note (mechanism, not just a comment):** review this crawler list ~quarterly.
Keep two conceptual buckets explicit and decide them separately: (1) **training/ingestion
bots** (GPTBot, Google-Extended, CCBot, Bytespider) — block; (2) **AI search/referral bots**
(OAI-SearchBot, PerplexityBot) — a visibility trade-off, not automatically blocked. Note
that CCBot/ClaudeBot tokens are vendor-documented but UA spoofing is common, so robots.txt
remains advisory (the nginx rate-limit is the UA-agnostic backstop).

**Image load protection is already handled** by the deployed nginx rate-limit
(`/api/images/` → `zone=vutt_api`, 10 r/s per IP, burst 50; `nginx.conf:64`). No code change.

## Explicitly out of scope / deferred

- **Tightening the image rate-limit.** 10 r/s per IP caps runaway load but a patient single
  IP could still drain ~20k images in ~30 min. Decision: **leave as-is for now, monitor.**
  If traffic/abuse grows, tighten via a stricter image-specific nginx zone (e.g. 2–4 r/s)
  and/or `limit_conn` per IP — a one-line host-config change, not git, reversible.
- **Anubis / Cloudflare-tier bot challenge.** Separate future project if scrapers become a
  real problem despite the above.
- **Per-page URLs / anchors.** Rejected — whole-work pages only.
- **`/stats` canonical report.** Intentional behavior; no change.

## Testing

- **Unit:** shared page-text helper (`read_work_page_texts`) returns pages in order with
  `.txt`-authoritative / `.json`-fallback behavior; `build_meta_html` output contains
  cleaned per-page main text in `<section data-page="N">` wrappers plus cleaned marginalia,
  and omits text for a restricted work; cache key =
  `max(_metadata.json mtime, page file mtimes)` — a changed **page** mtime *and* a changed
  **`_metadata.json`** mtime each force a rebuild (guards the bibliographic-staleness case);
  size-guardrail warning fires when rendered HTML exceeds the threshold, and the oversized
  work is truncated per the pre-registered decision.
- **Sitemap:** `lastmod` for a work reflects a page-file mtime newer than `_metadata.json`.
- **robots.txt:** served content includes the AI-bot blocks and retains `Sitemap:` +
  existing `*` rules.
- **Manual (server):** fetch `/meta/work/{id}` with a Googlebot UA and confirm full text is
  present; confirm a restricted work still 403s; re-run seed/reindex unaffected.

## Rollout

- Backend change (Parts A, B): `git pull && docker compose build --no-cache backend &&
  docker compose up -d backend`.
- robots.txt (Part C): ships in frontend build → `npm run build` + `rsync -avz dist/ vutt:~/VUTT/dist/`.
- After deploy: request re-indexing / validation in Search Console for a sample of the
  affected `/work/{id}` URLs. "Crawled – currently not indexed" **may** shrink over
  subsequent weeks as pages carry unique substantive content, but this is **not guaranteed**
  — Google's crawl/index decisions are discretionary. Monitor impressions and indexed-count
  over time rather than expecting an immediate change.

## Success criteria

- Bot-facing `/work/{id}` pages contain the full cleaned transcription (main + marginalia).
- Editing a transcription bumps that work's sitemap `lastmod`.
- robots.txt blocks the named AI crawlers while allowing Googlebot/Bingbot.
- No regression to browser SPA behavior, access gating, or existing indexing pipeline.
- Over weeks: measurable rise in "Indexed" count and appearance of corpus text in Google
  results.

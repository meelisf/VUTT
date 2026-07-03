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

**Text source (reuse the indexer's path):** the Meilisearch indexer already reads page
text authoritatively at `server/meili_doc.py:~640-683` — enumerate the work's page images
in sorted order, read `data/{slug}/{base}.txt` (fallback to page `.json` `text_content`
when the `.txt` is missing/empty). Factor this enumeration+read into a small shared helper
(e.g. `read_work_page_texts(work_path) -> list[(page_num, raw_text)]`) so the prerender and
the indexer stay consistent and don't drift.

**Cleaning:** run each page's raw text through the existing `clean_text_for_search()`
(`server/meili_doc.py:60`) — joins line-end hyphens, strips all VUTT XML/markdown markup →
readable prose. Include **main text + marginalia**: use `_clean_search_text(page_text)`
(`meili_doc.py:93`) which returns `(main_clean, marginalia_clean)`; render main text as the
body and append cleaned marginalia in a labeled section (e.g. `<h2>Ääremärkused</h2>`), so
both are indexable and distinguishable.

**Rendering:** append the concatenated per-page prose into the existing `<body>` of
`build_meta_html`, after the current bibliographic block and before the nav back-links.
Keep everything else (canonical, OG/DC tags, cross-links) unchanged. Escape via the
existing `_escape` helper.

**Moving target → live but cheap (caching):** the endpoint already rebuilds fresh per
request, so text is current at crawl time. To avoid re-reading/cleaning N page files on
every crawl, add a **per-work HTML cache keyed on the max mtime of the work's page files**
(`.txt`, falling back to page `.json`). Edit any page → key changes → next crawl rebuilds;
otherwise serve cached HTML. This mirrors the existing `_home_cache` pattern in
`public.py`. Cache entry: `{work_id: (max_mtime, html)}`; invalidate implicitly by key
mismatch.

**Access gating:** unchanged — honor `is_work_public` / `can_read_work`. Restricted works
get **no text** (as today; `work_meta` already returns 403 for unauthorized).

### Part B — Sitemap `lastmod` reflects text edits  *(small; in git)*

**Where:** `build_sitemap_xml()` in `server/metadata_handler.py:426`.

Today work `lastmod` = `_metadata.json` mtime, which **does not change when page text is
edited** → Google never learns to re-crawl edited transcriptions. Change work `lastmod` to
`max(page file mtimes, _metadata.json mtime)`. Reuse the same page-enumeration helper from
Part A (bounded cost; sitemap is already cached in `_sitemap_cache`). Person `lastmod`
(from `updated_at`) is unchanged.

### Part C — robots.txt AI-bot rules  *(tiny; in git)*

**Where:** `public/robots.txt` (built into `dist/`, served static by nginx).

Add explicit blocks for known AI-training crawlers, keeping search engines fully allowed:

```
User-agent: GPTBot
Disallow: /
User-agent: Google-Extended
Disallow: /
User-agent: CCBot
Disallow: /
User-agent: ClaudeBot
Disallow: /
User-agent: anthropic-ai
Disallow: /
User-agent: Bytespider
Disallow: /
User-agent: PerplexityBot
Disallow: /
# (extendable; list needs occasional maintenance)
```

Retain the existing `User-agent: *` rules (which already `Disallow: /api/`, covering images
for compliant bots) and the `Sitemap:` line.

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

- **Unit:** shared page-text helper returns pages in order with `.txt`-authoritative /
  `.json`-fallback behavior; `build_meta_html` output contains cleaned main text +
  marginalia section for a public work, and omits text for a restricted work; cache key =
  max page mtime and a changed mtime forces a rebuild.
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
  affected `/work/{id}` URLs; expect "Crawled – currently not indexed" to shrink over
  subsequent weeks as pages carry unique substantive content.

## Success criteria

- Bot-facing `/work/{id}` pages contain the full cleaned transcription (main + marginalia).
- Editing a transcription bumps that work's sitemap `lastmod`.
- robots.txt blocks the named AI crawlers while allowing Googlebot/Bingbot.
- No regression to browser SPA behavior, access gating, or existing indexing pipeline.
- Over weeks: measurable rise in "Indexed" count and appearance of corpus text in Google
  results.

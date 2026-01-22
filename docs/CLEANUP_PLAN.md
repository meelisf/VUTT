# Codebase Cleanup Plan

This document outlines technical debt and cleanup tasks identified during the migration to Metadata V3 (Linked Data).

## Completed (2026-01-22)

- [x] **Removed `geminiService.ts`** - Deprecated empty file deleted
- [x] **Cleaned up debug console.log statements** - Removed verbose logging from meiliService.ts, MetadataModal.tsx
- [x] **Fixed duplicate `tags` field in types.ts**
- [x] **Added missing type fields** - `type`, `type_object` to ContentSearchHit; `page_tags` to `_formatted`
- [x] **Fixed `teose_tags` reference** - Changed to `tags` in MetadataModal.tsx

## Priority: High (Do before next major feature)

1.  **Fix TypeScript Type Errors in MetadataModal.tsx:**
    *   6 errors related to `LinkedEntity` type assignments
    *   Lines 273, 277, 279, 281, 474, 484
    *   Issue: `MetadataForm` uses `string | LinkedEntity` but passes to functions expecting `string`
    *   **Task:** Decide on type strategy - either always extract labels before passing, or update receiving types

2.  **Fix Statistics.tsx Type Error:**
    *   Line 175: `StatusCount[]` not assignable to `ChartDataInput[]`
    *   **Task:** Add index signature to `StatusCount` interface or use type assertion

3.  **Consolidate Helper Functions:**
    *   Currently, helper functions like `get_label`, `get_primary_labels`, etc., are duplicated in `server/utils.py` and `scripts/1-1_consolidate_data.py`.
    *   **Task:** Refactor `scripts/1-1_consolidate_data.py` to import these functions directly from `server.utils` (requires setting up correct Python path in the script execution environment).

4.  **Remove Legacy Fields:**
    *   The Meilisearch index still contains some legacy fields for backward compatibility (e.g., `teose_tags` in some contexts, though mostly replaced by `tags`).
    *   **Task:** Verify if any frontend code still relies on old field names and remove them from `server/meilisearch_ops.py` and `scripts/1-1...`.

## Priority: Medium

5.  **Vocabulary vs Wikidata:**
    *   We currently have a hybrid system: `state/vocabularies.json` (legacy local translations) and Wikidata (new live data).
    *   **Task:** Decide if we want to fully deprecate `vocabularies.json` and rely solely on Wikidata, or keep it as a cache/fallback. If deprecating, migrate remaining static definitions to Wikidata IDs.

6.  **Frontend Type Safety:**
    *   `src/types.ts` has union types like `string | LinkedEntity`.
    *   **Task:** Once all data is migrated to V3 objects, strictly type these fields as `LinkedEntity` to simplify frontend logic (remove `typeof` checks).

## Priority: Low

7.  **Console statements audit:**
    *   74 console.* statements remain (mostly legitimate error handling)
    *   Consider adding a logging utility for consistent formatting

## Usage Observations

*   **Keywords:** The current keyword list is a mix of capitalized/uncapitalized and different languages. The `capitalizeFirst` logic helps, but a dedicated cleanup script to merge duplicates (e.g., via Wikidata ID matching) would be beneficial.

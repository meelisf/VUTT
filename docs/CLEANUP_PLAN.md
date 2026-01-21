# Codebase Cleanup Plan

This document outlines technical debt and cleanup tasks identified during the migration to Metadata V3 (Linked Data).

## Priority: High (Do before next major feature)

1.  **Consolidate Helper Functions:**
    *   Currently, helper functions like `get_label`, `get_primary_labels`, etc., are duplicated in `server/utils.py` and `scripts/1-1_consolidate_data.py`.
    *   **Task:** Refactor `scripts/1-1_consolidate_data.py` to import these functions directly from `server.utils` (requires setting up correct Python path in the script execution environment).

2.  **Remove Legacy Fields:**
    *   The Meilisearch index still contains some legacy fields for backward compatibility (e.g., `teose_tags` in some contexts, though mostly replaced by `tags`).
    *   **Task:** Verify if any frontend code still relies on old field names and remove them from `server/meilisearch_ops.py` and `scripts/1-1...`.

## Priority: Medium

3.  **Vocabulary vs Wikidata:**
    *   We currently have a hybrid system: `state/vocabularies.json` (legacy local translations) and Wikidata (new live data).
    *   **Task:** Decide if we want to fully deprecate `vocabularies.json` and rely solely on Wikidata, or keep it as a cache/fallback. If deprecating, migrate remaining static definitions to Wikidata IDs.

4.  **Frontend Type Safety:**
    *   `src/types.ts` has union types like `string | LinkedEntity`.
    *   **Task:** Once all data is migrated to V3 objects, strictly type these fields as `LinkedEntity` to simplify frontend logic (remove `typeof` checks).

## Usage Observations

*   **Keywords:** The current keyword list is a mix of capitalized/uncapitalized and different languages. The `capitalizeFirst` logic helps, but a dedicated cleanup script to merge duplicates (e.g., via Wikidata ID matching) would be beneficial.

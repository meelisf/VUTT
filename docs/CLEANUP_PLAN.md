# Cleanup Plan

## Post-Migration Cleanup (NanoID Transition)

Currently, the system supports both legacy slugs (`teose_id`, e.g., `1632-1`) and persistent NanoIDs (`work_id`, e.g., `occgcn`) to ensure smooth transition.

Once the public launch is successful and no legacy links are in active circulation, we should clean up the codebase.

### 1. Frontend (`src/services/meiliService.ts`)
- Remove `OR teose_id = ...` from all Meilisearch filters.
- Rely strictly on `work_id`.

### 2. Backend (`server/utils.py`)
- In `find_directory_by_id`, remove the fallback search for `slug` and directory names.
- Rely strictly on the `WORK_ID_CACHE` and `id` field in `_metadata.json`.

### 3. Data Schema
- Review `_metadata.json` files. `slug` field can be deprecated or kept purely for human-readable reference, but not used for logic.
# Plan: Metadata V3 (Linked Data Migration)

## 1. Objective

Transition the VUTT metadata model from simple strings (V2) to a Semantic/Linked Data model (V3) backed by Wikidata. This will enable advanced filtering, multilingual search, and future geospatial visualization.

**Key Changes:**
- Fields `keywords`, `genre`, `location`, `publisher` change from `string` to `LinkedEntity` objects.
- `creators` entries gain optional `id` and `source` fields.
- Frontend input fields are replaced with `WikidataAutocomplete` components.

## 2. New Data Schema (V3)

### 2.1. The `LinkedEntity` Interface

All linked fields will share this common structure in `_metadata.json` and TypeScript interfaces.

```typescript
interface LinkedEntity {
  id: string | null;       // Wikidata ID (e.g., "Q13972") or null for manual entries
  label: string;           // Primary label (e.g., "Tartu")
  source: 'wikidata' | 'manual';
  labels?: {               // Optional: Multilingual fallback for search
    et?: string;
    en?: string;
    [key: string]: string | undefined;
  };
}
```

### 2.2. Updated `_metadata.json` Structure

```json
{
  "id": "x9r4mk2p",
  "title": "Disputatio physica...",
  "year": 1635,
  
  // CHANGED: String -> LinkedEntity
  "location": {
    "id": "Q13972",
    "label": "Tartu",
    "source": "wikidata",
    "labels": { "et": "Tartu", "en": "Tartu", "de": "Dorpat" }
  },

  // CHANGED: String -> LinkedEntity
  "publisher": {
    "id": "Q123456",
    "label": "Jacob Becker",
    "source": "wikidata"
  },

  // CHANGED: Array<String> -> Array<LinkedEntity>
  "genre": [
    {
      "id": "Q1123131", 
      "label": "Disputatsioon",
      "source": "wikidata",
      "labels": { "et": "Disputatsioon", "en": "Disputation" }
    }
  ],

  // CHANGED: Array<String> -> Array<LinkedEntity>
  "keywords": [
    {
      "id": "Q5891",
      "label": "Filosoofia",
      "source": "wikidata"
    }
  ],

  // UPDATED: Creator objects gain linking info
  "creators": [
    {
      "role": "praeses",
      "name": "Georg Mancelius",
      "id": "Q553654",       // New field
      "source": "wikidata"   // New field
    }
  ]
}
```

## 3. Implementation Plan

### Phase 1: Frontend Infrastructure (The Foundation)

1.  **Create `src/services/wikidataService.ts`**
    *   Implement `searchWikidata(query, type)` function.
    *   Map `type` to specific Wikidata SPARQL/filters:
        *   `place`: `P31` (instance of) -> `Q486972` (human settlement) etc.
        *   `person`: `P31` -> `Q5` (human).
        *   `topic`: General search.
        *   `genre`: Specific subset or general search.

2.  **Create `src/components/EntityPicker.tsx`**
    *   A generic Autocomplete component using `wikidataService`.
    *   Visual distinction between "Linked" (green check/icon) and "Manual" (gray) entries.
    *   Props: `type`, `value` (LinkedEntity), `onChange`.

3.  **Update `src/types.ts`**
    *   Define `LinkedEntity`.
    *   Update `Work` interface to allow both `string` (legacy/transition) and `LinkedEntity` for relevant fields.

### Phase 2: Frontend Integration (The UI)

4.  **Update `MetadataModal.tsx`**
    *   Replace text inputs with `EntityPicker`.
    *   Handle saving: ensure data is formatted as V3 objects before sending to backend.

5.  **Update Display Components (`WorkCard.tsx`, `Workspace.tsx`)**
    *   Ensure they can render objects. E.g., if `location` is an object, display `location.label`.

### Phase 3: Backend & Indexing (The Plumbing)

6.  **Update `server/utils.py` / `file_server.py`**
    *   Ensure `/update-work-metadata` endpoint accepts nested objects in JSON payload without validation errors.

7.  **Update `scripts/1-1_consolidate_data.py` (Critical)**
    *   **Flattening Strategy:** Meilisearch needs strings for simple search, but we want structured data too.
    *   Target Index Document Structure:
        ```json
        {
          "location": "Tartu",             // For display & simple search
          "location_data": { ... },        // Full object (optional, for frontend retrieval)
          "location_id": "Q13972",         // For faceting/filtering
          "keywords": ["Filosoofia"],      // Array of strings
          "keywords_ids": ["Q5891"]        // Array of IDs
        }
        ```
    *   The script must detect if a field is V2 (string) or V3 (object) and handle both during the transition.

### Phase 4: Migration (The Clean Start)

8.  **Manual Migration / Scripting**
    *   Since data volume is low (~6 works with tags), no complex migration script is needed.
    *   We will simply re-save metadata for existing works via the new UI, or run a small one-off script to "upgrade" string fields to "manual" source entities if needed.

## 4. Specific Wikidata Rules

| Field | Wikidata Context | Filter / ID |
| :--- | :--- | :--- |
| **Location** | Place / Settlement | `P31` (instance of) -> `Q486972` (human settlement) or `Q515` (city) |
| **Printer** | Human or Organization | `P106` (occupation) -> `Q175375` (printer) OR `P31` -> `Q43229` (organization) |
| **Genre** | Literary/Scientific work type | "Disputatsioon" = `Q1123131` |
| **Person** | Human | `P31` -> `Q5` |
| **Keywords** | Concepts | General search |

## 7. Post-Migration Cleanup Guide

Once **all** `_metadata.json` files have been migrated to the V3 format (no bare strings remaining in `location`, `publisher`, `genre`, `keywords`), execute this cleanup to remove technical debt.

### 7.1. Frontend Cleanup
1.  **Strict Types (`src/types.ts`)**:
    *   Remove `string` from Union types.
    *   Change: `location: string | LinkedEntity` → `location: LinkedEntity`.
    *   Repeat for `publisher`, `genre`, `keywords`.
2.  **Remove Safety Wrappers**:
    *   Deprecate/Remove `src/utils/metadataUtils.ts`.
    *   Search & Replace: `getLabel(work.location)` → `work.location.label`.
    *   Search & Replace: `getId(work.location)` → `work.location.id`.

### 7.2. Backend Cleanup
1.  **Indexer (`scripts/1-1_consolidate_data.py`)**:
    *   Remove `isinstance(val, str)` checks in `get_work_metadata`.
    *   Add validation: Raise error or log warning if legacy string data is encountered (enforcing V3).
2.  **API (`server/file_server.py`)**:
    *   If any temporary normalization logic was added to `/update-work-metadata` to handle mixed inputs, remove it.

### 7.3. Verification
*   Run `grep` for "legacy", "compatibility", or "V2" comments added during this migration to ensure no artifacts remain.

## 5. Zero-Downtime & Compatibility Strategy (CRITICAL)

Since the system is in active use, we must ensure **full backward compatibility** at every step. The application must handle "Hybrid State" where some works have V2 (string) metadata and others have V3 (object) metadata.

### 5.1. The "Read Compatible, Write V3" Principle
- **Reading:** All components must gracefully handle both `string` and `LinkedEntity` types.
- **Writing:** New edits via `MetadataModal` will save as V3 objects. Existing data is preserved as-is until edited.

### 5.2. Frontend Safety Layer
Create a helper utility `src/utils/metadataUtils.ts`:
```typescript
// Safe getter for UI display
export function getLabel(value: string | LinkedEntity | undefined | null): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.label || '';
}

// Safe getter for ID (returns null if string)
export function getId(value: string | LinkedEntity | undefined | null): string | null {
  if (!value || typeof value === 'string') return null;
  return value.id || null;
}
```
**Check:** Apply this helper in `WorkCard.tsx`, `Dashboard.tsx`, and `SearchPage.tsx` BEFORE changing the data structure.

### 5.3. Meilisearch Stability (The "Flat Fallback")
The search index schema (`teosed`) relies on string fields for filtering (`koht`, `trükkal`, `genre`).
**Strategy:** The indexing script (`1-1_consolidate_data.py`) will **flatten** V3 objects back to strings for the main fields, while adding *new* auxiliary fields for IDs.

**Example Document sent to Meilisearch:**
```json
{
  "id": "...",
  // OLD FIELDS (Preserved as strings for compatibility):
  "koht": "Tartu",            // Extracted from location.label
  "trükkal": "Jacob Becker",  // Extracted from publisher.label
  "genre": "Disputatsioon",   // Extracted from genre[0].label
  
  // NEW FIELDS (For future advanced features):
  "location_id": "Q13972",
  "location_src": "wikidata",
  "publisher_id": "Q123456"
}
```
**Result:** Existing filters and search queries continue to work exactly as before without any code changes in search logic.

### 5.4. Implementation Checklist
1.  [ ] **Helper Utils:** Create `metadataUtils.ts` first.
2.  [ ] **Frontend Hardening:** Refactor `WorkCard`, `SearchPage`, etc., to use `getLabel()` instead of direct access. **Verify Dashboard still works.**
3.  [ ] **Indexer Update:** Modify `1-1_consolidate_data.py` to handle both strings and objects, flattening objects for legacy fields. **Verify search still works.**
4.  [ ] **New UI:** Only *then* implement `EntityPicker` and enable V3 saving.

## 6. Specific Wikidata Rules

# Codebase Reference

This document maps the project's codebase, providing quick references to scripts, backend services, and frontend components to assist LLMs and developers in navigating the system.

## Scripts (`scripts/`)

Scripts for data migration, maintenance, and processing.

| Script Name | Namespace | Description | File Location |
| :--- | :--- | :--- | :--- |
| `1-1_consolidate_data.py` | Indexing / Meilisearch | Reads `_metadata.json` files (v2 format) and generates a JSONL file for Meilisearch indexing. Each page is treated as a separate document. | [scripts/1-1_consolidate_data.py](../scripts/1-1_consolidate_data.py) |
| `2-1_upload_to_meili.py` | Indexing / Meilisearch | Uploads the generated data to the Meilisearch instance using configuration from environment variables. | [scripts/2-1_upload_to_meili.py](../scripts/2-1_upload_to_meili.py) |
| `add_printer_place.py` | Data Migration / Metadata | Adds printing place (Tartu/Pärnu) and printer information to `_metadata.json` files based on historical periods and rules. | [scripts/add_printer_place.py](../scripts/add_printer_place.py) |
| `assign_collections_by_year.py` | Data Migration / Collections | Assigns collections to works based on their year of publication (e.g., Academia Gustaviana vs. Gustavo-Carolina). | [scripts/assign_collections_by_year.py](../scripts/assign_collections_by_year.py) |
| `create_original_backups.py` | Maintenance / Backups | Creates `.backup.ORIGINAL` files for all `.txt` files if they don't exist, serving as a pristine baseline. | [scripts/create_original_backups.py](../scripts/create_original_backups.py) |
| `kataloogi-töötlemine-peenhäälestatud-mudeliga.py` | Processing / AI | Uses a fine-tuned Qwen3-VL-8B model for bulk image-to-text inference. Includes sorting and resume capability. | [scripts/kataloogi-töötlemine-peenhäälestatud-mudeliga.py](../scripts/kataloogi-töötlemine-peenhäälestatud-mudeliga.py) |
| `migrate_add_nanoid.py` | Data Migration / Metadata | Adds a persistent, unique nanoid-style `id` field to all `_metadata.json` files to ensure stable identification. | [scripts/migrate_add_nanoid.py](../scripts/migrate_add_nanoid.py) |
| `migrate_backups_to_git.py` | Data Migration / Git | Migrates old file-based backup versions into the Git history, preserving original modification timestamps. | [scripts/migrate_backups_to_git.py](../scripts/migrate_backups_to_git.py) |
| `migrate_metadata_v2.py` | Data Migration / Metadata | Migrates metadata from v1 to v2 format (renaming fields like `pealkiri` -> `title`, `autor` -> `creators`, etc.). | [scripts/migrate_metadata_v2.py](../scripts/migrate_metadata_v2.py) |
| `migrate_teose_id.py` | Data Migration / Metadata | Adds `teose_id` to every `_metadata.json` file to resolve inconsistencies between folder names and internal IDs. | [scripts/migrate_teose_id.py](../scripts/migrate_teose_id.py) |
| `migrate_teose_staatus.py` | Data Migration / Metadata | Calculates and updates `teose_staatus` (work status) for all works and syncs it to their pages in Meilisearch. | [scripts/migrate_teose_staatus.py](../scripts/migrate_teose_staatus.py) |
| `remove_author_suffixes.py` | Data Cleaning | Removes suffixes like `[P]` and `[R]` from author names in the metadata to clean up the data. | [scripts/remove_author_suffixes.py](../scripts/remove_author_suffixes.py) |
| `replace_negation_sign.py` | Data Cleaning | Replaces the negation sign (`¬`) with a standard hyphen (`-`) in `.txt` files to fix search indexing issues with split words. | [scripts/replace_negation_sign.py](../scripts/replace_negation_sign.py) |
| `split_images.py` | Image Processing | Splits images in a specified folder vertically into two halves (left/right pages), typically for book spreads. | [scripts/split_images.py](../scripts/split_images.py) |
| `sync_meilisearch.py` | Indexing / Meilisearch | Synchronizes the Meilisearch index with the current file system state (adds new, removes deleted, updates counts). | [scripts/sync_meilisearch.py](../scripts/sync_meilisearch.py) |

## Server (Backend) (`server/`)

Python-based backend handling API requests, file serving, authentication, and integration with Meilisearch and Git.

| File | Module | Description | Location |
| :--- | :--- | :--- | :--- |
| `file_server.py` | Core | Main entry point for the backend server. Handles HTTP requests, routing, and integrates other modules. | [server/file_server.py](../server/file_server.py) |
| `auth.py` | Security | Manages authentication and user sessions (token-based). Stores active sessions in memory. | [server/auth.py](../server/auth.py) |
| `config.py` | Configuration | Centralized configuration for the server (file paths, environment variables, constants). | [server/config.py](../server/config.py) |
| `cors.py` | Security | Middleware for handling Cross-Origin Resource Sharing (CORS) headers and allowed origins. | [server/cors.py](../server/cors.py) |
| `git_ops.py` | Version Control | Handles Git operations: committing changes, reading history, and managing the data repository. | [server/git_ops.py](../server/git_ops.py) |
| `image_server.py` | Media | Specialized handler for serving image files (likely with resizing or processing capabilities, integrated into file_server). | [server/image_server.py](../server/image_server.py) |
| `meilisearch_ops.py` | Search | Encapsulates interactions with the Meilisearch instance: searching, updating indexes, and syncing data. | [server/meilisearch_ops.py](../server/meilisearch_ops.py) |
| `pending_edits.py` | Workflow | Manages pending edits from contributors (currently not in active use, but implemented). | [server/pending_edits.py](../server/pending_edits.py) |
| `rate_limit.py` | Security | Implements rate limiting to protect API endpoints from abuse (brute-force, spam). | [server/rate_limit.py](../server/rate_limit.py) |
| `registration.py` | User Management | Handles user registration flows, including invite tokens and initial account setup. | [server/registration.py](../server/registration.py) |
| `utils.py` | Utilities | Helper functions for string manipulation, ID generation (nanoid), and other common tasks. | [server/utils.py](../server/utils.py) |

## Source (Frontend) (`src/`)

React-based frontend application for viewing, editing, and managing the digital archive.

| File/Directory | Component/Module | Description | Location |
| :--- | :--- | :--- | :--- |
| `App.tsx` | Core | Main application component. Sets up routing (React Router) and providers. | [src/App.tsx](../src/App.tsx) |
| `contexts/UserContext.tsx` | State | Global state for user authentication and session management. | [src/contexts/UserContext.tsx](../src/contexts/UserContext.tsx) |
| `contexts/CollectionContext.tsx` | State | Global state for managing the currently selected collection (filters). | [src/contexts/CollectionContext.tsx](../src/contexts/CollectionContext.tsx) |
| `services/meiliService.ts` | API Client | Primary service for communicating with the backend API and Meilisearch (fetching pages, works, saving edits). | [src/services/meiliService.ts](../src/services/meiliService.ts) |
| `services/collectionService.ts` | API Client | Service for fetching collection definitions and vocabularies from the backend. | [src/services/collectionService.ts](../src/services/collectionService.ts) |
| `pages/Workspace.tsx` | View | The main working environment for editing page transcriptions. Connects ImageViewer and TextEditor. | [src/pages/Workspace.tsx](../src/pages/Workspace.tsx) |
| `pages/Dashboard.tsx` | View | The landing page/dashboard showing collections and recent updates. | [src/pages/Dashboard.tsx](../src/pages/Dashboard.tsx) |
| `pages/SearchPage.tsx` | View | Specialized search interface for querying the archive. | [src/pages/SearchPage.tsx](../src/pages/SearchPage.tsx) |
| `components/TextEditor.tsx` | UI Component | The complex editor component for transcription, supporting Markdown and history/metadata viewing. | [src/components/TextEditor.tsx](../src/components/TextEditor.tsx) |
| `components/ImageViewer.tsx` | UI Component | Component for displaying and interacting with the scanned page images. | [src/components/ImageViewer.tsx](../src/components/ImageViewer.tsx) |
| `components/MetadataModal.tsx` | UI Component | Modal for editing work-level metadata (title, year, creators, etc.). | [src/components/MetadataModal.tsx](../src/components/MetadataModal.tsx) |

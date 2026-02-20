"""
Massiliste metaandmete uuenduste HTTP handlerid.

Eraldatud file_server.py-st. Sisaldab:
- /works/bulk-tags - märksõnade määramine mitmele teosele
- /works/bulk-genre - žanri määramine mitmele teosele
- /works/bulk-collection - kollektsiooni määramine mitmele teosele
"""
import os
import json

from .http_helpers import send_json_response, read_request_data, require_auth
from .utils import find_directory_by_id, metadata_lock
from .git_ops import save_with_git
from .meilisearch_ops import sync_work_to_meilisearch_async
from .config import BASE_DIR, COLLECTIONS_FILE


def handle_bulk_tags(handler):
    """Määrab märksõnad mitmele teosele korraga (ainult admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        work_ids = data.get('work_ids', [])
        tags = data.get('tags', [])  # LinkedEntity objektide list
        mode = data.get('mode', 'add')  # 'add' või 'replace'

        if not work_ids:
            send_json_response(handler, 400, {"status": "error", "message": "work_ids on kohustuslik"})
            return

        if not tags and mode == 'replace':
            # Replace tühja listiga = eemalda kõik märksõnad
            pass
        elif not tags:
            send_json_response(handler, 400, {"status": "error", "message": "tags on kohustuslik"})
            return

        updated = 0
        failed = []

        for work_id in work_ids:
            try:
                dir_path = find_directory_by_id(work_id)
                if not dir_path:
                    failed.append({"id": work_id, "error": "Kausta ei leitud"})
                    continue

                metadata_path = os.path.join(dir_path, '_metadata.json')

                with metadata_lock:
                    current_meta = {}
                    if os.path.exists(metadata_path):
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            current_meta = json.load(f)

                    if mode == 'replace':
                        # Asenda kõik märksõnad
                        current_meta['tags'] = tags
                    else:
                        # Lisa olemasolevatele (väldi duplikaate ID või labeli järgi)
                        existing_tags = current_meta.get('tags', [])
                        existing_ids = set()
                        existing_labels = set()
                        for t in existing_tags:
                            if isinstance(t, dict):
                                if t.get('id'):
                                    existing_ids.add(t['id'])
                                existing_labels.add(t.get('label', '').lower())
                            elif isinstance(t, str):
                                existing_labels.add(t.lower())

                        for new_tag in tags:
                            tag_id = new_tag.get('id') if isinstance(new_tag, dict) else None
                            tag_label = new_tag.get('label', '').lower() if isinstance(new_tag, dict) else str(new_tag).lower()

                            if tag_id and tag_id in existing_ids:
                                continue  # Sama ID juba olemas
                            if tag_label in existing_labels:
                                continue  # Sama label juba olemas

                            existing_tags.append(new_tag)
                            if tag_id:
                                existing_ids.add(tag_id)
                            existing_labels.add(tag_label)

                        current_meta['tags'] = existing_tags

                    json_content = json.dumps(current_meta, indent=2, ensure_ascii=False)
                    save_with_git(
                        filepath=metadata_path,
                        content=json_content,
                        username=user['username'],
                        message=f"Märksõnad: {os.path.basename(dir_path)}"
                    )

                sync_work_to_meilisearch_async(os.path.basename(dir_path))
                updated += 1

            except Exception as e:
                failed.append({"id": work_id, "error": str(e)})

        tag_labels = ', '.join([t.get('label', str(t)) if isinstance(t, dict) else str(t) for t in tags[:3]])
        if len(tags) > 3:
            tag_labels += f" (+{len(tags) - 3})"
        print(f"Admin '{user['username']}' määras märksõnad [{tag_labels}] ({mode}) {updated} teosele")

        send_json_response(handler, 200, {
            "status": "success",
            "message": f"Uuendatud {updated} teost",
            "updated": updated,
            "failed": failed
        })

    except Exception as e:
        print(f"BULK-TAGS VIGA: {e}")
        import traceback
        traceback.print_exc()
        handler.send_error(500, str(e))


def handle_bulk_genre(handler):
    """Määrab žanri mitmele teosele korraga (ainult admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        work_ids = data.get('work_ids', [])
        genre = data.get('genre')  # LinkedEntity objekt või null

        if not work_ids:
            send_json_response(handler, 400, {"status": "error", "message": "work_ids on kohustuslik"})
            return

        updated = 0
        failed = []

        for work_id in work_ids:
            try:
                dir_path = find_directory_by_id(work_id)
                if not dir_path:
                    failed.append({"id": work_id, "error": "Kausta ei leitud"})
                    continue

                metadata_path = os.path.join(dir_path, '_metadata.json')

                with metadata_lock:
                    current_meta = {}
                    if os.path.exists(metadata_path):
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            current_meta = json.load(f)

                    # Uuenda žanri väli (võib olla null)
                    current_meta['genre'] = genre

                    json_content = json.dumps(current_meta, indent=2, ensure_ascii=False)
                    save_with_git(
                        filepath=metadata_path,
                        content=json_content,
                        username=user['username'],
                        message=f"Žanr: {os.path.basename(dir_path)}"
                    )

                sync_work_to_meilisearch_async(os.path.basename(dir_path))
                updated += 1

            except Exception as e:
                failed.append({"id": work_id, "error": str(e)})

        genre_label = genre.get('label', str(genre)) if isinstance(genre, dict) else str(genre) if genre else 'eemaldatud'
        print(f"Admin '{user['username']}' määras žanri '{genre_label}' {updated} teosele")

        send_json_response(handler, 200, {
            "status": "success",
            "message": f"Uuendatud {updated} teost",
            "updated": updated,
            "failed": failed
        })

    except Exception as e:
        print(f"BULK-GENRE VIGA: {e}")
        import traceback
        traceback.print_exc()
        handler.send_error(500, str(e))


def handle_bulk_collection(handler):
    """Määrab kollektsiooni mitmele teosele korraga (ainult admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        work_ids = data.get('work_ids', [])
        collection = data.get('collection')  # None = eemalda kollektsioon

        if not work_ids:
            send_json_response(handler, 400, {"status": "error", "message": "work_ids on kohustuslik"})
            return

        # Valideeri kollektsioon (kui pole None/null)
        if collection:
            collections_data = {}
            if os.path.exists(COLLECTIONS_FILE):
                with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
                    collections_data = json.load(f)
            if collection not in collections_data:
                send_json_response(handler, 400, {"status": "error", "message": f"Kollektsiooni '{collection}' ei leitud"})
                return

        updated = 0
        failed = []

        for work_id in work_ids:
            try:
                # Leia kaust ID järgi
                dir_path = find_directory_by_id(work_id)
                if not dir_path:
                    failed.append({"id": work_id, "error": "Kausta ei leitud"})
                    continue

                metadata_path = os.path.join(dir_path, '_metadata.json')

                # Loe olemasolev metadata ja salvesta Gitiga
                with metadata_lock:
                    current_meta = {}
                    if os.path.exists(metadata_path):
                        with open(metadata_path, 'r', encoding='utf-8') as f:
                            current_meta = json.load(f)

                    # Uuenda collection väli
                    current_meta['collection'] = collection

                    # Salvesta Gitiga
                    json_content = json.dumps(current_meta, indent=2, ensure_ascii=False)
                    save_with_git(
                        filepath=metadata_path,
                        content=json_content,
                        username=user['username'],
                        message=f"Kollektsioon: {os.path.basename(dir_path)}"
                    )

                # Sünkrooni Meilisearchiga (taustal)
                sync_work_to_meilisearch_async(os.path.basename(dir_path))

                updated += 1

            except Exception as e:
                failed.append({"id": work_id, "error": str(e)})

        print(f"Admin '{user['username']}' määras kollektsiooni '{collection}' {updated} teosele")

        send_json_response(handler, 200, {
            "status": "success",
            "message": f"Uuendatud {updated} teost",
            "updated": updated,
            "failed": failed
        })

    except Exception as e:
        print(f"BULK-COLLECTION VIGA: {e}")
        import traceback
        traceback.print_exc()
        handler.send_error(500, str(e))

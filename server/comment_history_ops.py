"""Kommentaaride versiooniajaloo arvutus git-logist (on-demand, puhas loogika).

Git on ainus tõeallikas — eraldi indeksit ei hoita. Vt
`docs/superpowers/specs/2026-06-30-page-comments-markdown-git-restore-design.md`.
"""
import json

from .git_ops import get_file_at_commit, get_file_git_history


def _extract_comments(file_content):
    """Parsib lehe .json sisu → comments-massiiv.

    Toetab nii juur-`comments` kui `meta_content.comments` struktuuri.
    Vigane JSON / puuduv comments → [].
    """
    try:
        data = json.loads(file_content)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, dict):
        return []
    source = data.get("meta_content", data)
    if not isinstance(source, dict):
        return []
    comments = source.get("comments", [])
    return comments if isinstance(comments, list) else []


def find_comment_in_content(file_content, comment_id):
    """Leiab kommentaari-objekti faili sisust id järgi; None kui puudub."""
    for c in _extract_comments(file_content):
        if isinstance(c, dict) and c.get("id") == comment_id:
            return c
    return None


def build_comment_history(json_relpath, current_comments, max_count=100):
    """Arvutab kommentaaride versiooniajaloo git-logist.

    versions: { id: [{commit_hash, timestamp, author, text}] } — AINULT ajaloolised
              text-versioonid, mis erinevad praegusest; uusimast vanimani;
              järjestikused identsed kokku tõmmatud.
    deleted:  [{id, text, author, created_at, replies, last_seen_commit}] — id-d,
              mis ajaloos esinevad aga current_comments-ist puuduvad; säilitatud
              uusim esinemine (= viimane seis enne kustutamist).
    truncated: kas ajalugu jõudis max_count-ini.
    """
    history = get_file_git_history(json_relpath, max_count=max_count)
    truncated = len(history) >= max_count

    current_by_id = {c.get("id"): c for c in current_comments if isinstance(c, dict)}
    current_text = {cid: c.get("text", "") for cid, c in current_by_id.items()}

    versions = {}
    last_added = {}   # id -> viimati lisatud text (dedup)
    deleted = {}      # id -> deleted-kirje (esimene kohatud = uusim)

    for commit in history:  # uusimast vanimani
        content = get_file_at_commit(json_relpath, commit["full_hash"])
        if content is None:
            continue
        for c in _extract_comments(content):
            if not isinstance(c, dict):
                continue
            cid = c.get("id")
            if cid is None:
                continue
            text = c.get("text", "")
            if cid in current_by_id:
                if text != current_text.get(cid) and last_added.get(cid) != text:
                    versions.setdefault(cid, []).append({
                        "commit_hash": commit["full_hash"],
                        "timestamp": commit["date"],
                        "author": commit["author"],
                        "text": text,
                    })
                    last_added[cid] = text
            elif cid not in deleted:
                deleted[cid] = {
                    "id": cid,
                    "text": text,
                    "author": c.get("author", ""),
                    "created_at": c.get("created_at", ""),
                    "replies": c.get("replies", []),
                    "last_seen_commit": commit["full_hash"],
                }

    return {
        "versions": versions,
        "deleted": list(deleted.values()),
        "truncated": truncated,
    }


def apply_comment_restore(current_comments, restored_comment, mode):
    """Rakendab taaste praegusele comments-massiivile.

    mode "version": olemasoleva kommentaari text üle (replies jäävad).
    mode "deleted": lisab terve kommentaari tagasi.
    Returns (new_comments, None) | (None, (status_code, detail)).
    """
    by_id = {c.get("id"): c for c in current_comments if isinstance(c, dict)}
    cid = restored_comment.get("id")
    if mode == "version":
        if cid not in by_id:
            return None, (404, "Kommentaari ei leitud praegusest seisust")
        new = [
            {**c, "text": restored_comment.get("text", "")} if c.get("id") == cid else c
            for c in current_comments
        ]
        return new, None
    if mode == "deleted":
        if cid in by_id:
            return None, (409, "Kommentaar selle id-ga on juba olemas")
        return list(current_comments) + [restored_comment], None
    return None, (400, "Tundmatu mode")

"""Isikukaartide ajaloo/diffi abifunktsioonid."""
from __future__ import annotations

_DIFF_IGNORED_FIELDS = frozenset({
    "updated_at", "updated_by", "created_at", "created_by",
    "schema_version", "import_batch_ids", "id",
})


def compute_person_diff(before: dict, after: dict) -> list:
    """
    Tagastab [{field, old, new}] muutunud väljade loendi.
    Ignoreerib tehnilisi välju (timestamps, id jne).
    """
    changes = []
    for key in sorted(set(before) | set(after)):
        if key in _DIFF_IGNORED_FIELDS:
            continue
        old_val = before.get(key)
        new_val = after.get(key)
        if old_val != new_val:
            changes.append({"field": key, "old": old_val, "new": new_val})
    return changes


__all__ = ['compute_person_diff']

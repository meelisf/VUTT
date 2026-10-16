"""Kollektsioonipuu nähtavus (#617): privaatse kogu alamkogu on privaatne.

Puhas moodul (ainult stdlib) — impordivad nii live-tee (`access_ops`,
`meilisearch_ops`, `auth`) kui seed-tee (`meili_doc` → `scripts/1-1_consolidate_data.py`).
Nähtavuse arvutus elab AINULT siin: neli koopiat läksid varem lahku.

Kogu on avalik ainult siis, kui tema ise JA kõik esivanemad on avalikud. Kogu
enda `visibility` on salvestatud määrang; kehtiv nähtavus tuleneb ahelast.
Teose tasandil kehtib endiselt „public wins": piisab ühest avalikust kogust.
"""


def collection_chain(collection_id, collections):
    """Kogu ja tema esivanemad (alates kogust endast). Tsüklikindel."""
    chain = []
    seen = set()
    current = collection_id
    while current and current not in seen:
        seen.add(current)
        chain.append(current)
        col = (collections or {}).get(current)
        current = col.get("parent") if isinstance(col, dict) else None
    return chain


def is_collection_public(collection_id, collections):
    """Kehtiv nähtavus: avalik ainult siis, kui ükski ahela lüli ei ole privaatne.

    Tundmatu kogu (puudub konfist) loetakse avalikuks — sama vaikimisi
    käitumine, mis enne pärimist (`.get(c, {}).get("visibility", "public")`).
    """
    for cid in collection_chain(collection_id, collections):
        col = (collections or {}).get(cid)
        if isinstance(col, dict) and col.get("visibility", "public") != "public":
            return False
    return True


def is_work_public_in(work_collections, collections):
    """Teose avalikkus kogude konfi järgi. Kogudeta teos on avalik."""
    if not work_collections:
        return True
    return any(is_collection_public(c, collections) for c in work_collections)


def collection_descendants(collection_id, collections):
    """{collection_id} ∪ kõik järglased (rekursiivselt)."""
    target = {collection_id}
    changed = True
    while changed:
        changed = False
        for cid, col in (collections or {}).items():
            if isinstance(col, dict) and col.get("parent") in target and cid not in target:
                target.add(cid)
                changed = True
    return target

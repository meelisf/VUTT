"""Tekstisisese annotatsiooni ankru ja kirje lepitamine (ADR 0041).

`<annN>…</annN>` tekstis ja kirje lehe JSON-i `text_annotations`-is on ÜKS
fakt kahes failis. Redaktor hoiab neid koos (`useTextAnnotationActions` lisab
mõlemad ühe tegevusega), aga iga tekstitee, mis redaktorist läbi EI käi,
kirjutab ainult ühte poolt:

  - `reocr_apply.apply_ocr_results` kirjutas `.txt` üle → ankrud kadusid,
    kirjed jäid õhku rippuma (tootmises 6 kirjet 6 lehel, mõõdetud 2026-09-13);
  - `editing.git_restore` võtab teksti ja kirjed kahest eri kohast → tekkisid
    ankrud ilma kirjeta (23 tägi 8 lehel).

Mõlemad suunad on nähtav viga: ankruta kirje kuvatakse otsingus märkusena,
mille juurde ei saa minna; kirjeta ankur annab redaktoris tühja popoveri ja
MCP-s seletamatu märgendi.

Puhas moodul: ei failisüsteemi, ei git'i. Kutsuja kirjutab tulemuse ise
(re-OCR teel samasse `save_with_git` kutsesse, et commit jääks üheks).
"""
import json
import re
import time
from typing import Optional

# `<ann12>` ei tohi jääda `<ann1>` regexi alla — \d+ ahne match ja
# sõnapiir sulgtäägi kujul. Sama muster nagu `src/utils/annUtils.ts`.
_ANN_TAG_RE = re.compile(r"</?ann(\d+)>")

# Prefiks kommentaaril, mille ankur on kaotsi läinud. Ütleb PÕHJUSE välja:
# ilma selleta näeb toimetaja kommentaari, mis tundub asjata lehe küljes.
ORPHAN_COMMENT_PREFIX = "Endine tekstisisene märkus (ankur kadus teksti muutumisel)"


def find_ann_ids_in_text(text: str) -> set:
    """Kõik ankru-ID-d tekstis. Avav ja sulgev täg annavad sama ID."""
    if not text:
        return set()
    return {int(m.group(1)) for m in _ANN_TAG_RE.finditer(text)}


def strip_ann_tags(text: str, ids) -> str:
    """Eemaldab ANTUD ID-de tägid, jätab sisu alles. Teisi ankruid ei puutu."""
    if not ids:
        return text
    ids = set(ids)

    def _asenda(match):
        return "" if int(match.group(1)) in ids else match.group(0)

    return _ANN_TAG_RE.sub(_asenda, text)


def _annotation_records(meta: dict) -> list:
    """`text_annotations` kettalt — kettal võib olla mida iganes.

    Ainult `id`-ga sõnastikud loevad kirjeks; ülejäänu visatakse kõrvale
    (ilma `id`-ta kirjet ei saa ühegi ankruga siduda, seega ta on müra).
    """
    raw = meta.get("text_annotations")
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("id"), int):
            out.append(item)
    return out


def _comment_id(offset: int) -> str:
    """Kommentaari id samas vormingus nagu frontend (`Date.now()` string).

    `offset` hoiab ühe lepituse käigus tekkivad id-d erinevana — sama
    millisekund annaks korduva React-võtme.
    """
    return str(int(time.time() * 1000) + offset)


def _orphan_comment(ann: dict, offset: int) -> Optional[dict]:
    """Ankru kaotanud kirjest lehe kommentaar. `None`, kui sisu ei ole."""
    comment_text = (ann.get("comment") or "").strip()
    if not comment_text:
        return None
    return {
        "id": _comment_id(offset),
        "text": "{}: {}".format(ORPHAN_COMMENT_PREFIX, comment_text),
        "author": ann.get("author") or "Automaatne",
        # Algne aeg säilib: see ütleb, MILLAL toimetaja tähelepaneku tegi,
        # mitte millal ankur kaotsi läks.
        "created_at": ann.get("created_at") or "",
    }


def reconcile_page_annotations(text: str, meta: dict):
    """Lepitab ankrud ja kirjed. Tagastab `(text, meta, changed)`.

    - kirje ilma ankruta → lehe kommentaariks, kirje eemaldatakse
    - ankur ilma kirjeta → täg tekstist maha (sisu jääb)
    - terve paar → puutumata

    `changed=False` tähendab, et kutsuja ei pea midagi kirjutama (ADR 0012).
    Sisendit ei mutateerita; tagastatud `meta` on madal koopia.
    """
    text = text or ""
    records = _annotation_records(meta)
    ids_in_text = find_ann_ids_in_text(text)
    ids_in_meta = {a["id"] for a in records}

    orphan_records = [a for a in records if a["id"] not in ids_in_text]
    orphan_anchors = ids_in_text - ids_in_meta

    if not orphan_records and not orphan_anchors:
        return text, meta, False

    uus_meta = dict(meta)

    if orphan_records:
        alles = [a for a in records if a["id"] in ids_in_text]
        kommentaarid = list(uus_meta.get("comments") or [])
        for offset, ann in enumerate(orphan_records):
            kommentaar = _orphan_comment(ann, offset)
            if kommentaar:
                kommentaarid.append(kommentaar)
        uus_meta["text_annotations"] = alles
        uus_meta["comments"] = kommentaarid

    if orphan_anchors:
        text = strip_ann_tags(text, orphan_anchors)

    return text, uus_meta, True


def split_page_json(page_json: dict):
    """Eraldab kirjete kihi lehe JSON-ist. Tagastab `(meta, wrapped)`.

    Lehe JSON on kettal kahes kujus: uus lame (`/save` kirjutab kliendi
    `meta_content`-i otse faili juuriks) ja vana `meta_content` wrapper.
    Kirjed elavad ÜHES neist — kes valib vale kihi, näeb tühja loendit ja
    kirjutab kirjed vaikselt üle.
    """
    if isinstance(page_json.get("meta_content"), dict):
        return page_json["meta_content"], True
    return page_json, False


def merge_page_json(page_json: dict, meta: dict, wrapped: bool) -> dict:
    """`split_page_json` pöördtehe — kirjutab meta tagasi samasse kihti."""
    if wrapped:
        return {**page_json, "meta_content": meta}
    return meta


def apply_restored_annotations(
    restored_text: str, restored_json_raw: Optional[str], page_json: dict
):
    """Git-taaste: paneb taastatud teksti ja kirjed kokku ühte tõde.

    Tagastab `(tekst, page_json, changed)`.

    Tekst tuleb ühest commitist, kirjed lehe JSON-ist SAMAS commitis
    (`restored_json_raw`). Kui seda JSON-i tollal ei olnud või ta ei loe,
    jäävad praegused kirjed alles — loetamatu ajalugu ei tohi tähendada
    andmekadu. Lõpuks käib mõlema peale `reconcile_page_annotations`, nii et
    taaste ei saa jätta orba kummalegi poole.
    """
    meta, wrapped = split_page_json(page_json)

    restored_records = None
    if restored_json_raw is not None:
        try:
            restored = json.loads(restored_json_raw)
        except (json.JSONDecodeError, TypeError):
            restored = None
        if isinstance(restored, dict):
            restored_meta, _ = split_page_json(restored)
            restored_records = restored_meta.get("text_annotations") or []

    swapped = False
    if restored_records is not None and restored_records != (
        meta.get("text_annotations") or []
    ):
        meta = {**meta, "text_annotations": restored_records}
        swapped = True

    text, meta, reconciled = reconcile_page_annotations(restored_text, meta)
    changed = swapped or reconciled
    return text, merge_page_json(page_json, meta, wrapped), changed

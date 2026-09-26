"""Lehe salvestuse kolmesuunaline liitmine (#455, ADR 0054).

Redaktor saadab koos uue seisuga (*mine*) baasseisu (*base*) — lehe väljad nii,
nagu ta need laadis või viimati salvestas. Kettal olev seis (*theirs*) võib olla
vahepeal muutunud (kommentaarivastus, teine aken, taaste, re-OCR) või oli klient
laadinud aegunud Meili dokumendi. Liitmine käib üksuste kaupa:

    mine == base    → theirs   (mina ei muutnud)
    theirs == base  → mine     (nemad ei muutnud)
    mine == theirs  → mine     (sama muudatus)
    muidu           → kokkupõrge

Üksused: `text` (tekst + `text_annotations` koos — ankrud elavad tekstis,
ADR 0041), `status`, `page_tags`, kommentaarid id kaupa (`comments:<id>`).

Võrdlus käib Meili-projektsioonis: kommentaari tekst läbi `normalize_eszett`-i
(Meili annab ß → ss, #228) ja kanooniline JSON. Kui *mine* = *base*, võetakse
*theirs* toores väärtus — puutumata kommentaar säilitab kettal ß-i.
"""
import json
import os

from .meili_doc import normalize_eszett

PAGE_FIELDS = ("text_content", "status", "page_tags", "comments", "text_annotations")


def _kanooniline(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def _norm_comment(c):
    if isinstance(c, dict) and c.get("text"):
        return {**c, "text": normalize_eszett(c["text"])}
    return c


def _eq(a, b) -> bool:
    return _kanooniline(a) == _kanooniline(b)


def _eq_comment(a, b) -> bool:
    return _eq(_norm_comment(a), _norm_comment(b))


def _vali(base, mine, theirs, eq):
    """(väärtus, konflikt) üldreegli järgi."""
    if eq(mine, base):
        return theirs, False
    if eq(theirs, base) or eq(mine, theirs):
        return mine, False
    return None, True


def _comment_id(c):
    return str(c.get("id")) if isinstance(c, dict) and c.get("id") is not None else None


def _merge_comments(base, mine, theirs):
    b = {_comment_id(c): c for c in base or [] if _comment_id(c)}
    m = {_comment_id(c): c for c in mine or [] if _comment_id(c)}
    t = {_comment_id(c): c for c in theirs or [] if _comment_id(c)}
    konfliktid = []
    tulemus = {}

    for cid in list(dict.fromkeys([*t, *m, *b])):
        in_b, in_m, in_t = cid in b, cid in m, cid in t
        if in_m and in_t:
            if in_b:
                value, konflikt = _vali(b[cid], m[cid], t[cid], _eq_comment)
            else:  # mõlemad lisasid sama id-ga (ebatõenäoline)
                value, konflikt = (m[cid], False) if _eq_comment(m[cid], t[cid]) else (None, True)
            if konflikt:
                konfliktid.append(f"comments:{cid}")
            else:
                tulemus[cid] = value
        elif in_m:  # puudub theirs-ist
            if not in_b:
                tulemus[cid] = m[cid]                      # mina lisasin
            elif not _eq_comment(m[cid], b[cid]):
                konfliktid.append(f"comments:{cid}")       # nemad kustutasid, mina muutsin
            # muidu: nemad kustutasid muutmata kommentaari
        elif in_t:  # puudub mine-st
            if not in_b:
                tulemus[cid] = t[cid]                      # nemad lisasid
            elif not _eq_comment(t[cid], b[cid]):
                konfliktid.append(f"comments:{cid}")       # mina kustutasin, nemad muutsid
            # muidu: mina kustutasin muutmata kommentaari

    # Järjekord: theirs järjekord, siis mine uued
    jarjestus = [cid for cid in t if cid in tulemus] + [cid for cid in m if cid in tulemus and cid not in t]
    return [tulemus[cid] for cid in jarjestus], konfliktid


def merge_page(base: dict, mine: dict, theirs: dict):
    """Tagastab (liidetud leht, konfliktide loend). Konflikti korral on liidetud
    leht mittetäielik ja seda EI tohi kirjutada."""
    merged = {}
    konfliktid = []

    tekst_b = (base.get("text_content") or "", base.get("text_annotations") or [])
    tekst_m = (mine.get("text_content") or "", mine.get("text_annotations") or [])
    tekst_t = (theirs.get("text_content") or "", theirs.get("text_annotations") or [])
    value, konflikt = _vali(tekst_b, tekst_m, tekst_t, _eq)
    if konflikt:
        konfliktid.append("text")
    else:
        merged["text_content"], merged["text_annotations"] = value

    for field in ("status", "page_tags"):
        value, konflikt = _vali(base.get(field), mine.get(field), theirs.get(field), _eq)
        if konflikt:
            konfliktid.append(field)
        else:
            merged[field] = value

    comments, comment_konfliktid = _merge_comments(
        base.get("comments"), mine.get("comments"), theirs.get("comments"))
    konfliktid.extend(comment_konfliktid)
    merged["comments"] = comments
    return merged, konfliktid


def read_page_view(txt_path: str, json_path: str) -> dict:
    """Kettal olev leht redaktori projektsioonis — SAMA mis `meili_doc`
    (`.txt` autoriteet, JSON `text_content` fallback; `meta_content` või juur;
    `page_tags` → `tags` fallback; staatus vaikimisi `Toores`)."""
    text = ""
    if os.path.exists(txt_path):
        with open(txt_path, "r", encoding="utf-8") as f:
            text = f.read()
    view = {"text_content": text, "status": "Toores", "page_tags": [],
            "comments": [], "text_annotations": []}
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            file_json = json.load(f)
        source = file_json.get("meta_content", file_json) if isinstance(file_json, dict) else {}
        if not isinstance(source, dict):
            source = {}
        view["page_tags"] = source.get("page_tags", source.get("tags", [])) or []
        view["comments"] = source.get("comments", []) or []
        view["text_annotations"] = source.get("text_annotations", []) or []
        view["status"] = source.get("status", "Toores")
        if not text and isinstance(file_json, dict) and "text_content" in file_json:
            view["text_content"] = file_json["text_content"] or ""
    return view

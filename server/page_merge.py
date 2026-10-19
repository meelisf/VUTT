"""Lehe salvestuse kolmesuunaline liitmine (#455, ADR 0054).

Redaktor saadab koos uue seisuga (*mine*) baasseisu (*base*) — lehe väljad nii,
nagu ta need laadis või viimati salvestas. Kettal olev seis (*theirs*) võib olla
vahepeal muutunud (kommentaarivastus, teine aken, taaste, re-OCR) või oli klient
laadinud aegunud Meili dokumendi. Liitmine käib üksuste kaupa:

    mine == base    → theirs   (mina ei muutnud)
    theirs == base  → mine     (nemad ei muutnud)
    mine == theirs  → mine     (sama muudatus)
    muidu           → kokkupõrge

Üksused: `text` (ridade kaupa, vt `merge_text`), `status`, `page_tags`,
kommentaarid id kaupa (`comments:<id>`) ja tekstiannotatsioonid id kaupa
(`annotations:<id>`). Ankrud `<annN>` elavad tekstis endas (ADR 0041), seega
kontrollitakse pärast liitmist, et tägid ja kirjed klapivad (`_seose_vead`) —
uus viga, mida kummaski sisendis ei olnud, teeb kogu tekstist kokkupõrke (#612).

Võrdlus käib Meili-projektsioonis: kommentaari tekst läbi `normalize_eszett`-i
(Meili annab ß → ss, #228) ja kanooniline JSON. Kui *mine* = *base*, võetakse
*theirs* toores väärtus — puutumata kommentaar säilitab kettal ß-i.
"""
import difflib
import json
import os
import re

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


def _merge_by_id(base, mine, theirs, eq=_eq_comment, prefix="comments"):
    """Kirjete loend id kaupa (kommentaarid, tekstiannotatsioonid)."""
    b = {_comment_id(c): c for c in base or [] if _comment_id(c)}
    m = {_comment_id(c): c for c in mine or [] if _comment_id(c)}
    t = {_comment_id(c): c for c in theirs or [] if _comment_id(c)}
    konfliktid = []
    tulemus = {}

    for cid in list(dict.fromkeys([*t, *m, *b])):
        in_b, in_m, in_t = cid in b, cid in m, cid in t
        if in_m and in_t:
            if in_b:
                value, konflikt = _vali(b[cid], m[cid], t[cid], eq)
            else:  # mõlemad lisasid sama id-ga (ebatõenäoline)
                value, konflikt = (m[cid], False) if eq(m[cid], t[cid]) else (None, True)
            if konflikt:
                konfliktid.append(f"{prefix}:{cid}")
            else:
                tulemus[cid] = value
        elif in_m:  # puudub theirs-ist
            if not in_b:
                tulemus[cid] = m[cid]                      # mina lisasin
            elif not eq(m[cid], b[cid]):
                konfliktid.append(f"{prefix}:{cid}")       # nemad kustutasid, mina muutsin
            # muidu: nemad kustutasid muutmata kirje
        elif in_t:  # puudub mine-st
            if not in_b:
                tulemus[cid] = t[cid]                      # nemad lisasid
            elif not eq(t[cid], b[cid]):
                konfliktid.append(f"{prefix}:{cid}")       # mina kustutasin, nemad muutsid
            # muidu: mina kustutasin muutmata kirje

    # Järjekord: theirs järjekord, siis mine uued
    jarjestus = [cid for cid in t if cid in tulemus] + [cid for cid in m if cid in tulemus and cid not in t]
    return [tulemus[cid] for cid in jarjestus], konfliktid


def _muudatused(base_read, teised_read):
    """Ühe poole muudatused baasi suhtes: [(i1, i2, j1, j2)] baasi koordinaatides."""
    sm = difflib.SequenceMatcher(None, base_read, teised_read, autojunk=False)
    return [(i1, i2, j1, j2) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal"]


def _poole_lõik(read, muudatused, lo, hi, nihe):
    """Poole read, mis vastavad baasi vahemikule [lo, hi). `nihe` = poole
    indeksi ja baasi indeksi vahe enne `lo`-d; tagastab (read, uus nihe)."""
    sees = [h for h in muudatused if lo <= h[0] and h[1] <= hi]
    lõpu_nihe = nihe + sum((j2 - j1) - (i2 - i1) for i1, i2, j1, j2 in sees)
    return read[lo + nihe:hi + lõpu_nihe], lõpu_nihe


def merge_text(base: str, mine: str, theirs: str):
    """Kolmesuunaline liitmine ridade kaupa (diff3, #612).

    Tagastab (liidetud tekst | None, tükid). Tükid katavad kogu teksti:
    `{"kind": "ok", "text"}` või `{"kind": "conflict", "base", "mine", "theirs"}`.
    Mõlema poole muudatus, mis kattub või PUUTUB (naaberread, sama
    lisamiskoht), on kokkupõrge — nagu git. Rida = füüsiline rida
    transkriptsioonis, seega sama rea kaks parandust põrkuvad alati.
    """
    b = base.splitlines(keepends=True)
    m = mine.splitlines(keepends=True)
    t = theirs.splitlines(keepends=True)
    hm, ht = _muudatused(b, m), _muudatused(b, t)
    kõik = sorted([(h, "m") for h in hm] + [(h, "t") for h in ht], key=lambda x: (x[0][0], x[0][1]))

    tükid = []
    konflikt = False

    def ok(read):
        if not read:
            return
        if tükid and tükid[-1]["kind"] == "ok":
            tükid[-1]["text"] += "".join(read)
        else:
            tükid.append({"kind": "ok", "text": "".join(read)})

    pos = 0
    nihe_m = nihe_t = 0
    i = 0
    while i < len(kõik):
        # Klaster: muudatused, mis kattuvad või puutuvad baasis kokku.
        lo, hi = kõik[i][0][0], kõik[i][0][1]
        pooled = {kõik[i][1]}
        i += 1
        while i < len(kõik) and kõik[i][0][0] <= hi:
            hi = max(hi, kõik[i][0][1])
            pooled.add(kõik[i][1])
            i += 1
        ok(b[pos:lo])
        lõik_m, uus_nihe_m = _poole_lõik(m, hm, lo, hi, nihe_m)
        lõik_t, uus_nihe_t = _poole_lõik(t, ht, lo, hi, nihe_t)
        nihe_m, nihe_t = uus_nihe_m, uus_nihe_t
        if pooled == {"m"} or lõik_m == lõik_t:
            ok(lõik_m)
        elif pooled == {"t"}:
            ok(lõik_t)
        else:
            konflikt = True
            tükid.append({"kind": "conflict", "base": "".join(b[lo:hi]),
                          "mine": "".join(lõik_m), "theirs": "".join(lõik_t)})
        pos = hi
    ok(b[pos:])

    if konflikt:
        return None, tükid
    return "".join(tk["text"] for tk in tükid), tükid


_PAARISTÄG_RE = re.compile(r"<(/?)(m|i|b|cs|hi|fn|ann\d+)>")
_ANN_ID_RE = re.compile(r"^ann(\d+)$")


def _seose_vead(text: str, annotations) -> set:
    """Tägide ja annotatsioonikirjete vastuolud: tasakaalust väljas paaristäg,
    kirjeta `<annN>`, tägita kirje. Võrreldakse hulkadena, sest juba kettal
    olev vastuolu (vana viga) ei ole liitmise süü."""
    loendur = {}
    for sulg, nimi in _PAARISTÄG_RE.findall(text or ""):
        loendur[nimi] = loendur.get(nimi, 0) + (-1 if sulg else 1)
    vead = {f"tasakaal:{nimi}" for nimi, n in loendur.items() if n}
    tägide_id = {int(mm.group(1)) for nimi in loendur if (mm := _ANN_ID_RE.match(nimi))}
    kirjete_id = set()
    for a in annotations or []:
        if isinstance(a, dict) and a.get("id") is not None:
            try:
                kirjete_id.add(int(a["id"]))
            except (TypeError, ValueError):
                pass
    vead |= {f"kirjeta:{n}" for n in tägide_id - kirjete_id}
    vead |= {f"tägita:{n}" for n in kirjete_id - tägide_id}
    return vead


# Avalik nimi tekstiettepanekute ümberbaseerimisele (#641).
annotation_link_errors = _seose_vead


def merge_page(base: dict, mine: dict, theirs: dict):
    """Tagastab (liidetud leht, konfliktide loend). Konflikti korral on liidetud
    leht mittetäielik ja seda EI tohi kirjutada."""
    merged = {}
    konfliktid = []

    tekst_b = base.get("text_content") or ""
    tekst_m = mine.get("text_content") or ""
    tekst_t = theirs.get("text_content") or ""
    tekst, _tükid = merge_text(tekst_b, tekst_m, tekst_t)

    annotatsioonid, ann_konfliktid = _merge_by_id(
        base.get("text_annotations"), mine.get("text_annotations"),
        theirs.get("text_annotations"), eq=_eq, prefix="annotations")
    konfliktid.extend(ann_konfliktid)

    if tekst is None:
        konfliktid.append("text")
    elif not ann_konfliktid and (
        _seose_vead(tekst, annotatsioonid)
        - _seose_vead(tekst_m, mine.get("text_annotations"))
        - _seose_vead(tekst_t, theirs.get("text_annotations"))
    ):
        # Ridade liitmine lõhkus tägi või ankru, mida kummaski sisendis ei olnud.
        konfliktid.append("text")
    else:
        merged["text_content"] = tekst
    merged["text_annotations"] = annotatsioonid

    for field in ("status", "page_tags"):
        value, konflikt = _vali(base.get(field), mine.get(field), theirs.get(field), _eq)
        if konflikt:
            konfliktid.append(field)
        else:
            merged[field] = value

    comments, comment_konfliktid = _merge_by_id(
        base.get("comments"), mine.get("comments"), theirs.get("comments"))
    konfliktid.extend(comment_konfliktid)
    merged["comments"] = comments
    return merged, konfliktid


def text_conflict_chunks(base: str, mine: str, theirs: str):
    """Kokkupõrke tükid dialoogile (#612). Kui ridade liitmine ise õnnestus,
    aga `merge_page` lükkas tulemuse tagasi (tägid/ankrud), on kogu tekst üks
    kokkupõrge — muidu poleks dialoogis midagi valida."""
    tekst, tükid = merge_text(base, mine, theirs)
    if tekst is not None:
        return [{"kind": "conflict", "base": base, "mine": mine, "theirs": theirs}]
    return tükid


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

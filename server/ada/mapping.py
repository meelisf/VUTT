"""ADA (dspace.ut.ee) Dublin Core → VUTT metaandmed. PUHAS: null I/O.

Kogu loogika, mis võib valesti minna — kuupäeva parsimine, sortimine,
väljade kaardistus — elab siin ja on testitav ilma võrguta.
"""
import re
from typing import Dict, List, Optional, Tuple

# Sõnaline dc.language → ISO 639-2/B. Tundmatu EI kaardistu — vale kood on
# halvem kui puuduv (ADR 0019: languages = teoses SISULISELT esinevad keeled).
KEELE_KAART = {
    "german": "deu", "deutsch": "deu",
    "latin": "lat", "latina": "lat",
    "estonian": "est", "eesti": "est",
    "russian": "rus", "swedish": "swe",
    "french": "fra", "english": "eng",
    "greek": "grc", "polish": "pol",
}

# ADA on TÜ raamatukogu repositoorium. VAIKEVÄÄRTUS, mitte tõde — admin muudab.
VAIKE_ARHIIV = "TÜR"

_TAIS = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")
_KUU = re.compile(r"^(\d{2})\.(\d{4})$")
_AASTA = re.compile(r"^(\d{4})$")
_ESTER = re.compile(r"record=(b\d+)")
_HANDLE_URL = re.compile(r"hdl\.handle\.net/|/handle/")


def parse_failinime_kuupaev(nimi: str) -> Tuple[int, int, int, int]:
    """Failinimest sortimisvõti `(aasta, kuu, päev, täpsus)`.

    Täpsus hoitakse ERALDI, mitte ei võltsita puuduvat päeva 1-ks: `11.1815.pdf`
    on „1815, november, päev teadmata", mitte 1815-11-01. Praktiline järjestus on
    sama (0 < 1), aga kood ei väida teadmist, mida tal ei ole.

    Võtmes EI OLE failinime. Sama põhjus: nimi ei ole järjestusteave. Parsimatud
    failid (`9997.pdf`, `klinger.fr.pdf`) saavad aasta 99999 → lähevad lõppu ja
    jäävad seal `sorted`-i stabiilsuse tõttu ADA enda järjekorda.
    """
    tyvi = nimi[:-4] if nimi.lower().endswith(".pdf") else nimi
    m = _TAIS.match(tyvi)
    if m:
        return (int(m.group(3)), int(m.group(2)), int(m.group(1)), 0)
    m = _KUU.match(tyvi)
    if m:
        return (int(m.group(2)), int(m.group(1)), 0, 1)
    m = _AASTA.match(tyvi)
    if m and int(m.group(1)) <= 2100:
        return (int(m.group(1)), 0, 0, 2)
    return (99999, 0, 0, 3)


def sordi_bitstreamid(bitstreams: List[dict]) -> List[dict]:
    """Kronoloogiline järjestus failinimest, MUUDE failide puhul ADA oma järjekord.

    ADA enda järjekord ei ole alati usaldusväärne — kirjes 10062/7822 on neli 1816.
    aasta kirja loendi lõpus — seega dateeritud failid sorditakse.

    Aga ADA failinimed EI OLE süsteemsed. Mõõdetud 2026-09-04, 10 kirjet
    Morgensterni kogust: 127 PDF-ist parsis `dd.mm.yyyy` kujuga **null**. Nende
    tähestikuline sortimine oli aktiivne kahju — kirjes 10062/1778 tõstis see
    kirjaveaga `kinger.pdf` ette ja dateeritud kirjad lõppu, kuigi ADA oli need
    mõistlikult järjestanud.

    Seepärast: kus kuupäeva ei ole, ei mõtle import järjekorda välja. `sorted` on
    stabiilne, seega võrdse võtmega failid jäävad ADA järjekorda. Admin tõstab
    vajadusel halduses ümber (`POST /admin/work/{work_id}/reorder-pages`).
    """
    return sorted(bitstreams, key=lambda b: parse_failinime_kuupaev(b.get("name", "")))


def _vaartused(item: dict, voti: str) -> List[dict]:
    """Kõik DC-kanded ühe võtme kohta. DC väljad on põhimõtteliselt kordused."""
    kanded = (item.get("metadata") or {}).get(voti) or []
    return [k for k in kanded if isinstance(k, dict) and k.get("value")]


def _esimene(item: dict, voti: str) -> Optional[str]:
    kanded = _vaartused(item, voti)
    return kanded[0]["value"] if kanded else None


def _pealkiri(item: dict) -> str:
    """Eelistus: [et] → keeleta → esimene."""
    kanded = _vaartused(item, "dc.title")
    if not kanded:
        return ""
    for k in kanded:
        if (k.get("language") or "").lower() == "et":
            return k["value"]
    for k in kanded:
        if not k.get("language"):
            return k["value"]
    return kanded[0]["value"]


def dc_vuttiks(item: dict) -> Dict[str, object]:
    """ADA item → VUTT-i metaandmete alamhulk.

    `type` ja `collections` EI tule siit: ADA ei ütle tüüpi ja `meta.type` on
    bibliograafiline väide, mida ei seata vaikselt (ADR 0028 §3).
    """
    keeled = []
    for k in _vaartused(item, "dc.language"):
        kood = KEELE_KAART.get(k["value"].strip().lower())
        if kood and kood not in keeled:
            keeled.append(kood)

    ester = None
    for k in _vaartused(item, "dc.description.uri"):
        m = _ESTER.search(k["value"])
        if m:
            ester = m.group(1)
            break

    handle_url = None
    for k in _vaartused(item, "dc.identifier.uri"):
        if _HANDLE_URL.search(k["value"]):
            handle_url = k["value"]
            break

    return {
        "title": _pealkiri(item),
        "year": _esimene(item, "dc.date.issued") or "",
        "year_display": _esimene(item, "dc.coverage.temporal") or "",
        "creators": [{"label": k["value"]} for k in _vaartused(item, "dc.contributor.author")],
        "languages": keeled,
        "ester_id": ester,
        "archive_refs": [
            {"archive_id": VAIKE_ARHIIV, "reference": k["value"]}
            for k in _vaartused(item, "dc.identifier.other")
        ],
        "external_url": handle_url,
    }

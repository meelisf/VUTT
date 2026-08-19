"""Zotero Local API klient.

Miks API, mitte zotero.sqlite: jooksev Zotero hoiab baasi lukus nii, et isegi
mode=ro ühendus kukub. API annab värske seisu töötava Zotero kõrvalt, ei sõltu
sisemisest skeemiversioonist ja jätab prügikasti ise välja.

Hind: indekseerimise ajal peab Zotero jooksma ja Local API olema lubatud
(Settings → Advanced).
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

AJALIMIIT = 30
LEHE_SUURUS = 100


class ZoteroError(Exception):
    """Zoterost ei saa andmeid."""


def _get(base_url: str, path: str, params: dict) -> tuple:
    url = f"{base_url}{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=AJALIMIIT) as vastus:
            toores = vastus.read()
            paised = dict(vastus.headers)
    except urllib.error.URLError as e:
        raise ZoteroError(
            f"Zotero Local API ei vasta aadressil {base_url} ({e.reason}). "
            "Kas Zotero on avatud?"
        ) from e
    try:
        return json.loads(toores), paised
    except json.JSONDecodeError as e:
        # Väljalülitatud API vastab 200-ga, kehas „Local API is not enabled".
        raise ZoteroError(
            "Zotero Local API on välja lülitatud. Lülita sisse: "
            "Zotero → Settings → Advanced → luba teistel rakendustel "
            f"selles arvutis Zoteroga suhelda. (Vastus: {toores[:80]!r})"
        ) from e


def fetch_all(base_url: str, path: str, params: dict | None = None) -> list:
    """Kogub kõik lehed. Zotero annab Total-Results päise ja võtab `start`-i."""
    params = dict(params or {})
    params.setdefault("limit", LEHE_SUURUS)
    kogutud, algus = [], 0
    while True:
        params["start"] = algus
        tykk, paised = _get(base_url, path, params)
        kogutud.extend(tykk)
        kokku = int(paised.get("Total-Results", len(kogutud)))
        algus += len(tykk)
        if not tykk or algus >= kokku:
            return kogutud


def check_api(base_url: str) -> None:
    """Kukub selge juhisega, kui API ei ole kättesaadav või on välja lülitatud."""
    _get(base_url, "/collections", {"limit": 1})


def resolve_collection(base_url: str, wanted: str) -> tuple:
    """Nimi VÕI key → (key, nimi).

    Nimi ei ole püsiv identifikaator — omaniku raamatukogus on mõõdetult mitu
    duplikaat-nime. 0 või >1 vaste korral kukume, et vaikselt vale kogu ei
    indekseeriks.
    """
    kogud = fetch_all(base_url, "/collections")
    otse = [c for c in kogud if c["key"] == wanted]
    if otse:
        return otse[0]["key"], otse[0]["data"]["name"]

    nime_jargi = [c for c in kogud if c["data"]["name"] == wanted]
    if not nime_jargi:
        raise ZoteroError(
            f"ei leidnud kollektsiooni {wanted!r} "
            f"({len(kogud)} kollektsiooni raamatukogus)"
        )
    if len(nime_jargi) > 1:
        kandidaadid = "\n".join(
            f"  {c['key']}  (ülem: {c['data'].get('parentCollection') or '-'})"
            for c in nime_jargi
        )
        raise ZoteroError(
            f"kollektsiooni nimi {wanted!r} ei ole üheselt määratud "
            f"({len(nime_jargi)} vastet). Kirjuta konfiguratsiooni nime asemel "
            f"key:\n{kandidaadid}"
        )
    return nime_jargi[0]["key"], nime_jargi[0]["data"]["name"]


def collection_tree(base_url: str, root_key: str) -> list:
    """Juur + kõik alamkollektsioonid rekursiivselt, [(key, nimi)].

    Kaasamine on tahtlik: kasvav kureeritud kogu saab alamkaustu ja nende
    vaikne väljajätmine tähendaks otsingust puuduvat materjali.
    """
    kogud = {c["key"]: c["data"]["name"] for c in fetch_all(base_url, "/collections")}
    tulem, jarjekord, nahtud = [], [root_key], set()
    while jarjekord:
        key = jarjekord.pop(0)
        if key in nahtud:
            continue
        nahtud.add(key)
        tulem.append((key, kogud.get(key, key)))
        alamad = fetch_all(base_url, f"/collections/{key}/collections")
        jarjekord.extend(a["key"] for a in alamad)
    return tulem


# Zotero API väljanimi → meie Bib väli.
BIB_VALJAD = {
    "title": "title", "date": "year", "place": "place", "publisher": "publisher",
    "publicationTitle": "publication", "volume": "volume", "issue": "issue",
    "pages": "pages", "series": "series", "edition": "edition",
    "ISBN": "isbn", "DOI": "doi",
}


@dataclass(frozen=True)
class Bib:
    creators: list
    title: str
    year: str | None = None
    place: str | None = None
    publisher: str | None = None
    publication: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    series: str | None = None
    edition: str | None = None
    isbn: str | None = None
    doi: str | None = None


@dataclass(frozen=True)
class ZoteroDoc:
    doc_id: str
    parent_key: str
    path: Path | None
    link_mode: str
    file_missing: bool
    bib: Bib


def _bib_kirjest(data: dict) -> Bib:
    vaartused = {
        meie: data[zotero]
        for zotero, meie in BIB_VALJAD.items()
        if data.get(zotero)
    }
    # Zotero `date` on vabatekst („1984-05", „u. 1984") — võtame aastaarvu.
    if "year" in vaartused:
        leid = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", str(vaartused["year"]))
        if leid:
            vaartused["year"] = leid.group(1)

    loojad = []
    for c in data.get("creators", []):
        nimi = c.get("name") or " ".join(
            x for x in (c.get("firstName"), c.get("lastName")) if x)
        if nimi:
            loojad.append([nimi, c.get("creatorType", "author")])
    return Bib(creators=loojad, title=vaartused.pop("title", "(pealkirjata)"),
               **vaartused)


def _lahenda_tee(data: dict, storage_dir: Path) -> Path | None:
    link_mode = data.get("linkMode")
    if link_mode == "linked_url":
        return None
    if link_mode == "linked_file":
        tee = data.get("path") or ""
        if tee.startswith("attachments:"):
            raise ZoteroError(
                f"manus {data['key']} kasutab Zotero baasikataloogi teed "
                f"({tee!r}). Baasikataloogi tugi on tahtlikult ehitamata "
                "(mõõdetult 0 kasutust) — sea absoluutne tee või ehita tugi."
            )
        return Path(tee) if tee else None
    failinimi = data.get("filename")
    if not failinimi:
        return None
    return Path(storage_dir) / data["key"] / failinimi


def iter_documents(base_url: str, storage_dir: Path,
                   collection_keys: list) -> list:
    """PDF-manused antud kollektsioonides.

    Prügikast: API kollektsioonivaade ei tohiks kustutatuid anda, aga me
    filtreerime `data.deleted` peale ka ise — lepingut ei usalda pimesi.
    """
    dokumendid, nahtud, vanemad = [], set(), {}
    manused = []
    for key in collection_keys:
        for kirje_ in fetch_all(base_url, f"/collections/{key}/items"):
            data = kirje_["data"]
            if data.get("deleted"):
                continue
            if data.get("itemType") == "attachment":
                manused.append(data)
            else:
                vanemad[kirje_["key"]] = data

    for data in manused:
        if data.get("contentType") != "application/pdf":
            continue
        if data["key"] in nahtud:
            continue
        nahtud.add(data["key"])
        tee = _lahenda_tee(data, storage_dir)
        if tee is None:
            continue
        vanem_key = data.get("parentItem")
        vanem = vanemad.get(vanem_key)
        if vanem is None:
            continue  # orb manus ilma kirjeta — ei ole tsiteeritav
        dokumendid.append(ZoteroDoc(
            doc_id=data["key"], parent_key=vanem_key, path=tee,
            link_mode=data.get("linkMode", ""), file_missing=not tee.exists(),
            bib=_bib_kirjest(vanem),
        ))
    return dokumendid

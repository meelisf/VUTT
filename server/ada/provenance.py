"""ADA lähtefaili → lõplik leheküljenumber. PUHAS: null I/O.

Kaks nihet on vahel: sammu 3 `excluded` (leht ei jõua OCR-i) ja sammu 4
`deleted` (leht ei jõua VUTT-i). `page_map` katab esimese, `sailinud_out`
teise.
"""
from datetime import datetime
from typing import Dict, List

KOMMENTAARI_AUTOR = "ada-import"
HANDLE_URL = "http://hdl.handle.net/{}"
BITSTREAM_URL = "https://dspace.ut.ee/server/api/core/bitstreams/{}/content"


def leia_ankrud(sources: List[dict], page_map: Dict[str, List[int]],
                sailinud_out: List[int]) -> Dict[int, dict]:
    """ADA tükk → lõplik leheküljenumber, kuhu provenance kirjutatakse.

    Iga tüki kohta otsitakse esimene väljundleht, mis elas üle MÕLEMAD nihked.
    Tükk, millest ei jäänud ühtki lehte, ankrut ei saa — vale kohta ei panda.
    """
    sailinud = sorted(sailinud_out)
    positsioon = {out: i + 1 for i, out in enumerate(sailinud)}
    ankrud = {}
    for allikas in sources:
        algus = int(allikas.get("first_src_page") or 0)
        lopp = algus + int(allikas.get("page_count") or 0) - 1
        leitud = None
        for src in range(algus, lopp + 1):
            for out in page_map.get(str(src)) or []:
                if out in positsioon:
                    leitud = positsioon[out]
                    break
            if leitud is not None:
                break
        # Kaks tükki ei tohi sama lehte hõivata: esimene võidab.
        if leitud is not None and leitud not in ankrud:
            ankrud[leitud] = allikas
    return ankrud


def ehita_source_vali(handle: str, allikas: dict) -> dict:
    """Masinloetav provenance lehe JSON-i juurtasandil."""
    return {
        "provider": "ada",
        "handle": handle,
        "bitstream_uuid": allikas.get("bitstream_uuid"),
        "name": allikas.get("name"),
    }


def ehita_kommentaar(handle: str, allikas: dict) -> dict:
    """Inimloetav provenance. Kommentaari kuju järgib olemasolevat `comments` massiivi.

    PÜSIV identifikaator on handle — ülikool tagab, et see resolvib digiteeringule.
    Bitstream-UUID on DSpace'i sisemine detail ja VÕIB muutuda, seepärast on ta
    viimane rida, mitte ainus viide.
    """
    return {
        "author": KOMMENTAARI_AUTOR,
        "text": "ADA: {}\n{}\n{}".format(
            allikas.get("name"),
            HANDLE_URL.format(handle),
            BITSTREAM_URL.format(allikas.get("bitstream_uuid")),
        ),
        "created_at": datetime.now().isoformat(),
    }

"""
Teose _metadata.json lugemise ühised helperid.

Tõstetud ``server/main.py``-st Faas 0 refaktoreeringus
(``docs/REFACTOR_main_py_2026-06-25.md``). Neid kasutavad mitu domeeni:
public/SEO (meta, sitemap), collections (ligipääsukontroll), download,
shareable, viewer-token.

Kaks funktsiooni:
- ``load_work_metadata``: otsib kataloogi work_id järgi, tagastab dict või ``None``.
  Kasutatakse seal, kus teos võib-olla ei eksisteeri (privilee kontroll, viewer-token).
- ``read_work_meta_direct_sync``: blokeeriv sünkroonne lugemine threadpooli jaoks.
  Tagastab ``{}`` (mitte ``None``) puuduva faili korral — ``/get-work-metadata``
  eeldab tühja dict'i, et frontend saaks tühja vormi näidata.
"""
import json
import os

from .config import BASE_DIR
from .utils import find_directory_by_id


def load_work_metadata(work_id: str):
    """Laeb teose _metadata.json. Tagastab None kui ei leitud.

    Kasutatakse: viewer-token, shareable, download, SEO meta, collections
    ligipääsukontroll — kõik need peavad eristama „ei leitud" (None) ja „tühi" ({}).
    """
    folder = find_directory_by_id(work_id)
    if not folder:
        return None
    meta_path = os.path.join(folder, '_metadata.json')
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def read_work_meta_direct_sync(work_id: str, original_path: str):
    """Loeb teose _metadata.json blokeeriva I/O-na (kutsutud threadpoolist).

    Lahutatud /get-work-metadata endpointist, et sync faililugemine ei blokeeriks
    event loopi (vt docs/koodi_ulevaade_2026-06-24_gemini_soovitused.md Leid 4).

    Tagastab ``{}`` (mitte ``None``) puuduva faili korral: endpoint
    /get-work-metadata eeldab tühja dict'i, et frontend saaks avada vormi uuele
    teosele, millel metafail veel puudub.
    """
    path = find_directory_by_id(work_id) or os.path.join(BASE_DIR, os.path.basename(original_path or ''))
    meta_path = os.path.join(path, '_metadata.json')
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

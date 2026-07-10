"""
Teose _metadata.json lugemise ühised helperid.

Tõstetud ``server/main.py``-st Faas 0 refaktoreeringus
(``docs/REFACTOR_main_py_2026-06-25.md``). Neid kasutavad mitu domeeni:
public/SEO (meta, sitemap), collections (ligipääsukontroll), download,
shareable, viewer-token.

``load_work_metadata`` otsib kataloogi work_id järgi ja tagastab dict või ``None``.
Ligipääsukontrolli kutsujad peavad ``None`` korral käituma fail-closed, sest see võib
lisaks puuduvale teosele tähendada vigast metaandmete faili.
"""
import json
import os

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

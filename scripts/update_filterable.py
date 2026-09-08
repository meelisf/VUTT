#!/usr/bin/env python3
"""Uuenda Meilisearchi filtreeritavad atribuudid."""

import meilisearch
import os
import sys
import types
from dotenv import load_dotenv

# Lae .env fail
load_dotenv()

# Kanooniline nimi, üks (ADR 0021)
MEILI_KEY = os.environ.get('MEILI_MASTER_KEY')

# Võimalikud URL-id
MEILI_URLS = [
    os.environ.get('MEILI_URL'),
    'http://localhost:7700',
    'http://meilisearch:7700',
    'http://127.0.0.1:7700'
]
# Eemalda None väärtused ja duplikaadid
MEILI_URLS = list(dict.fromkeys([u for u in MEILI_URLS if u]))

# Sama tõeallikas nagu seed ja runtime; uuendamine ei tohi dateeringufiltreid eemaldada.
#
# Fake-package muster: registreerime AINULT `server.meili_settings`, ilma et
# `server/__init__.py` käivituks. Muidu tõmbaks import kaasa FastAPI, PyJWT ja
# gitpythoni, mida hosti venv-is ei ole — see skript on mõeldud jooksma HOSTIS
# (`~/VUTT/.venv/bin/python3 scripts/update_filterable.py`), mitte konteineris.
_JUUR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if 'server' not in sys.modules:
    _pkg = types.ModuleType('server')
    _pkg.__path__ = [os.path.join(_JUUR, 'server')]
    _pkg.__package__ = 'server'
    sys.modules.setdefault('server', _pkg)
sys.path.insert(0, _JUUR)
from server.meili_settings import FILTERABLE_ATTRIBUTES as FILTERABLE_ATTRS


def main():
    if not MEILI_KEY:
        print("VIGA: Meilisearchi võti (MEILI_MASTER_KEY) puudub!")
        sys.exit(1)

    client = None
    for url in MEILI_URLS:
        try:
            print(f"Proovin ühenduda: {url}...")
            test_client = meilisearch.Client(url, MEILI_KEY)
            # Kontrolli ühendust
            test_client.get_indexes()
            client = test_client
            print(f"✓ Ühendus loodud: {url}")
            break
        except Exception as e:
            print(f"  × Ei saanud ühendust: {e}")

    if not client:
        print("\nVIGA: Ühegi Meilisearchi URL-iga ei saanud ühendust!")
        sys.exit(1)

    try:
        idx = client.index('teosed')
        print("\nPraegused filtreeritavad atribuudid:")
        current = idx.get_filterable_attributes()
        print(f"  {len(current)} atribuuti")

        missing = [a for a in FILTERABLE_ATTRS if a not in current]
        if missing:
            print(f"\nPuuduvad atribuudid: {missing}")
        else:
            print("\nKõik vajalikud atribuudid on juba olemas!")
            # Isegi kui kõik on olemas, uuendame igaks juhuks, et järjekord ja sisu oleks kindel
            # return

        print("\nUuendan filtreeritavaid atribuute...")
        task = idx.update_filterable_attributes(FILTERABLE_ATTRS)
        print(f"Task ID: {task.task_uid}")

        print("Ootan ülesande lõpetamist...")
        result = client.wait_for_task(task.task_uid)
        
        if result.status == 'succeeded':
            print("\n✓ Filtreeritavad atribuudid on edukalt uuendatud!")
        else:
            print(f"\n× Ülesande olek: {result.status}")
            print(f"Viga: {result.error}")

    except Exception as e:
        print(f"\nVIGA skripti täitmisel: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()

if __name__ == '__main__':
    main()

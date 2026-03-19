"""
Entity labels cache (state/labels.json): Q-kood → {et, en, ...} labelid.

Analoog people_ops.py-le, aga žanrite/tagide/tüüpide Q-koodide jaoks.
Automaatselt enrichib uued Q-koodid metaandmete salvestamisel (background).
"""
import os
import json
import threading
import urllib.request
import urllib.parse
from .config import LABELS_FILE
from .utils import atomic_write_json

_LABELS_LOCK = threading.Lock()
_HEADERS = {'User-Agent': 'VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)'}
_TARGET_LANGS = ['et', 'en', 'la', 'de']
_BATCH_SIZE = 50


def load_entity_labels():
    """Laeb entity labels cache failist."""
    if os.path.exists(LABELS_FILE):
        try:
            with open(LABELS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"LABELS: labels.json lugemine ebaõnnestus: {e}")
    return {}


def _fetch_wikidata_labels(qcodes):
    """Pärib Wikidatast labelid antud Q-koodidele (batch, max 50 korraga)."""
    results = {}
    qlist = sorted(qcodes)
    for i in range(0, len(qlist), _BATCH_SIZE):
        batch = qlist[i:i + _BATCH_SIZE]
        params = urllib.parse.urlencode({
            'action': 'wbgetentities',
            'ids': '|'.join(batch),
            'props': 'labels',
            'languages': '|'.join(_TARGET_LANGS),
            'format': 'json',
        })
        url = f"https://www.wikidata.org/w/api.php?{params}"
        try:
            req = urllib.request.Request(url, headers=_HEADERS)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            for qid, entity in data.get('entities', {}).items():
                if entity.get('missing'):
                    continue
                entry = {lang: lobj['value'] for lang, lobj in entity.get('labels', {}).items()}
                if entry:
                    results[qid] = entry
        except Exception as e:
            print(f"LABELS: Wikidata batch viga (batch {i // _BATCH_SIZE + 1}): {e}")
    return results


def _collect_qcodes(metadata):
    """Kogub Q-koodid metaandmete genre/type/tags väljadelt."""
    qcodes = set()

    def collect(val):
        if not val:
            return
        items = val if isinstance(val, list) else [val]
        for item in items:
            if isinstance(item, dict):
                qid = item.get('id', '')
                if qid and qid.startswith('Q'):
                    qcodes.add(qid)

    collect(metadata.get('genre'))
    collect(metadata.get('type'))
    collect(metadata.get('tags', []))
    return qcodes


def _collect_qcodes_from_person(person):
    """Kogub Q-koodid prosopograafia kirje väljadelt (seisus, amet, asutus jne)."""
    qcodes = set()

    def add(val):
        if isinstance(val, dict):
            qid = val.get('id', '')
            if qid and isinstance(qid, str) and qid.startswith('Q'):
                qcodes.add(qid)

    add(person.get('status'))
    add(person.get('confession'))
    add(person.get('origin_city'))
    add(person.get('origin_region'))
    birth = person.get('birth') or {}
    if isinstance(birth, dict):
        add(birth.get('place'))
    death = person.get('death') or {}
    if isinstance(death, dict):
        add(death.get('place'))
    for occ in person.get('occupations', []) or []:
        if isinstance(occ, dict):
            add({'id': occ.get('id')})
            add({'id': occ.get('institution_id')})
    for edu in person.get('education', []) or []:
        if isinstance(edu, dict):
            add({'id': edu.get('institution_id')})
    return qcodes


def enrich_entity_labels_from_person_async(person):
    """Lisab prosopograafia kirje Q-koodid labels.json-i taustal."""
    enrich_entity_labels_async_qcodes(_collect_qcodes_from_person(person))


def enrich_entity_labels_async_qcodes(qcodes):
    """Lisab/uuendab Q-koodid labels.json-is taustal.

    Re-fetchib ka Q-koodid kus mõni sihtkeel (nt 'et') puudub —
    kasutaja võis vahepeal Wikidata tõlke lisada.
    """
    if not qcodes:
        return

    def task():
        with _LABELS_LOCK:
            existing = load_entity_labels()
            to_fetch = {
                qid for qid in qcodes
                if qid not in existing
                or any(lang not in existing[qid] for lang in _TARGET_LANGS)
            }

        if not to_fetch:
            return

        print(f"LABELS: Pärin {len(to_fetch)} Q-koodi Wikidatast: {sorted(to_fetch)}")
        fetched = _fetch_wikidata_labels(to_fetch)

        if fetched:
            with _LABELS_LOCK:
                existing = load_entity_labels()
                existing.update(fetched)
                os.makedirs(os.path.dirname(LABELS_FILE), exist_ok=True)
                atomic_write_json(LABELS_FILE, existing)
            print(f"LABELS: Uuendatud {len(fetched)} kirjet labels.json-is")

    thread = threading.Thread(target=task)
    thread.daemon = True
    thread.start()


def refresh_all_entity_labels():
    """Värskendab kõik labels.json Q-koodid Wikidatast (admin toiming)."""
    existing = load_entity_labels()
    qcodes = list(existing.keys())
    if not qcodes:
        return 0
    print(f"LABELS: Täielik värskendus — {len(qcodes)} Q-koodi")
    fetched = _fetch_wikidata_labels(qcodes)
    if fetched:
        with _LABELS_LOCK:
            current = load_entity_labels()
            current.update(fetched)
            atomic_write_json(LABELS_FILE, current)
    return len(fetched)


def enrich_entity_labels_async(metadata):
    """Lisab puuduvad Q-koodid labels.json-i taustal.

    Kutsutakse metaandmete salvestamisel. Leiab žanri/tüübi/märksõnade
    Q-koodid mis puuduvad labels.json-ist ja pärib need Wikidatast.
    """
    enrich_entity_labels_async_qcodes(_collect_qcodes(metadata))

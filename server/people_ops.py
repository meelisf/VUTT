import os
import json
import time
import threading
import urllib.request
import urllib.parse
from .config import BASE_DIR, PEOPLE_FILE
from .utils import atomic_write_json

PEOPLE_LOCK = threading.Lock()

# Wikidata nõuab User-Agent päist
HEADERS = {
    'User-Agent': 'VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)'
}

def load_people_data():
    """Laeb inimeste andmed."""
    if os.path.exists(PEOPLE_FILE):
        try:
            with open(PEOPLE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}

def save_people_data(data):
    """Salvestab inimeste andmed atomically."""
    os.makedirs(os.path.dirname(PEOPLE_FILE), exist_ok=True)
    atomic_write_json(PEOPLE_FILE, data)

def fetch_wikidata_aliases(wikidata_id):
    """Küsub Wikidata API-st isiku aliased ja teised ID-d."""
    if not wikidata_id.startswith('Q'):
        return None
    
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{wikidata_id}.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            entity = data.get('entities', {}).get(wikidata_id, {})
            
            aliases = []
            TARGET_LANGS = ['et', 'en', 'de', 'la', 'mul']

            # Aliased (valitud keeltes)
            alias_data = entity.get('aliases', {})
            for lang in TARGET_LANGS:
                if lang in alias_data:
                    for a in alias_data[lang]:
                        aliases.append(a.get('value'))
            
            # Sildid (labels) (valitud keeltes)
            label_data = entity.get('labels', {})
            for lang in TARGET_LANGS:
                if lang in label_data:
                    aliases.append(label_data[lang].get('value'))
            
            # Puhasta ja eemalda duplikaadid
            aliases = sorted(list(set([a for a in aliases if a])))
            
            # Leia teised ID-d (P227 = GND, P214 = VIAF)
            ids = {'wikidata': wikidata_id}
            claims = entity.get('claims', {})
            
            # GND
            gnd_claims = claims.get('P227', [])
            if gnd_claims:
                ids['gnd'] = gnd_claims[0].get('mainsnak', {}).get('datavalue', {}).get('value')
            
            # VIAF
            viaf_claims = claims.get('P214', [])
            if viaf_claims:
                ids['viaf'] = viaf_claims[0].get('mainsnak', {}).get('datavalue', {}).get('value')
                
            primary_name = entity.get('labels', {}).get('et', {}).get('value') or \
                           entity.get('labels', {}).get('en', {}).get('value') or \
                           entity.get('labels', {}).get('de', {}).get('value') or \
                           (aliases[0] if aliases else wikidata_id)

            return {
                "primary_name": primary_name,
                "aliases": aliases,
                "ids": ids
            }
    except Exception as e:
        print(f"Wikidata fetch error ({wikidata_id}): {e}")
        return None

def fetch_gnd_aliases(gnd_id):
    """Küsub nimevariante GND-st (lobid.org API)."""
    # GND ID-d on tavaliselt numbrid või sisaldavad tähti
    url = f"https://lobid.org/gnd/{gnd_id}.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            
            aliases = []
            # Variant names
            variants = data.get('variantName', [])
            if isinstance(variants, list):
                aliases.extend(variants)
            elif isinstance(variants, str):
                aliases.append(variants)
                
            primary_name = data.get('preferredName', gnd_id)
            
            # Teised ID-d
            ids = {'gnd': gnd_id}
            same_as = data.get('sameAs', [])
            for item in same_as:
                id_url = item.get('id', '')
                if 'wikidata.org/entity/' in id_url:
                    ids['wikidata'] = id_url.split('/')[-1]
                elif 'viaf.org/viaf/' in id_url:
                    ids['viaf'] = id_url.split('/')[-1]

            return {
                "primary_name": primary_name,
                "aliases": sorted(list(set(aliases))),
                "ids": ids
            }
    except Exception as e:
        print(f"GND fetch error ({gnd_id}): {e}")
        return None

def update_person_async(creator_id, source=None, force=False):
    """Uuendab isiku andmeid taustal. force=True jätab aliaste kontrolli vahele."""
    def task():
        with PEOPLE_LOCK:
            people_data = load_people_data()

            # Kui juba olemas ja force pole, ei tee midagi
            if not force and creator_id in people_data:
                # Kontrollime kas aliased on olemas, kui ei, siis proovime täiendada
                if people_data[creator_id].get('aliases'):
                    return
            
            print(f"PEOPLE: Otsin andmeid isikule {creator_id}...")
            
            new_info = None
            if creator_id.startswith('Q'):
                new_info = fetch_wikidata_aliases(creator_id)
            elif source == 'gnd' or (len(creator_id) > 5 and creator_id.isdigit()):
                new_info = fetch_gnd_aliases(creator_id)
            
            if new_info:
                # Salvestame peamise ID järgi
                people_data[creator_id] = new_info
                
                # Kui leiti teisi ID-sid, tekitame viited (võrdväärsed kirjed)
                for key, val in new_info.get('ids', {}).items():
                    if val and val != creator_id:
                        people_data[val] = new_info
                
                save_people_data(people_data)
                print(f"PEOPLE: Uuendatud isik {creator_id} ({new_info['primary_name']})")
            else:
                print(f"PEOPLE: Ei leitud andmeid isikule {creator_id}")

    thread = threading.Thread(target=task)
    thread.daemon = True
    thread.start()

def process_creators_metadata(creators):
    """Käib läbi metaandmete loojad ja käivitab uuendused uutele ID-dele."""
    for creator in creators:
        c_id = creator.get('id')
        c_source = creator.get('source')
        if c_id:
            update_person_async(c_id, c_source)


def refresh_all_people():
    """Uuendab kõigi isikute aliased Wikidatast/GND-st.

    Deduplitseerib primary_name järgi, eelistab Wikidata ID-d GND-le.
    Tagastab: {"updated": N, "errors": N, "total": N}
    """
    with PEOPLE_LOCK:
        people_data = load_people_data()

    # Deduplitseeri: primary_name → parim ID + source
    seen = {}  # primary_name → (id, source)
    for person_id, info in people_data.items():
        primary = info.get('primary_name', '')
        if not primary:
            continue
        ids = info.get('ids', {})
        # Eelistame Wikidata ID-d
        wikidata_id = ids.get('wikidata')
        gnd_id = ids.get('gnd')
        if primary not in seen:
            if wikidata_id:
                seen[primary] = (wikidata_id, 'wikidata')
            elif gnd_id:
                seen[primary] = (gnd_id, 'gnd')
            else:
                seen[primary] = (person_id, None)
        else:
            # Uuenda kui leiame parema ID (Wikidata > GND)
            current_id, current_source = seen[primary]
            if wikidata_id and current_source != 'wikidata':
                seen[primary] = (wikidata_id, 'wikidata')

    total = len(seen)
    updated = 0
    errors = 0

    print(f"PEOPLE REFRESH: Alustan {total} isiku uuendamist...")

    for primary_name, (best_id, source) in seen.items():
        try:
            new_info = None
            if best_id.startswith('Q'):
                new_info = fetch_wikidata_aliases(best_id)
            elif source == 'gnd' or (len(best_id) > 5 and best_id.isdigit()):
                new_info = fetch_gnd_aliases(best_id)

            if new_info:
                with PEOPLE_LOCK:
                    people_data = load_people_data()
                    # Uuenda peamine kirje
                    people_data[best_id] = new_info
                    # Uuenda cross-reference kirjed
                    for key, val in new_info.get('ids', {}).items():
                        if val and val != best_id:
                            people_data[val] = new_info
                    save_people_data(people_data)
                updated += 1
            else:
                errors += 1
        except Exception as e:
            print(f"PEOPLE REFRESH: Viga isikul {best_id} ({primary_name}): {e}")
            errors += 1

        # Rate limit: 1 päring sekundis
        time.sleep(1)

    result = {"updated": updated, "errors": errors, "total": total}
    print(f"PEOPLE REFRESH: Valmis — {updated} uuendatud, {errors} viga, {total} kokku")
    return result


# Lukk, et vältida mitut samaaegset refresh'i
_refresh_running = threading.Lock()


def refresh_all_people_safe():
    """Käivitab refresh_all_people() kui teine ei jookse juba."""
    if not _refresh_running.acquire(blocking=False):
        print("PEOPLE REFRESH: Juba käimas, jätan vahele")
        return None
    try:
        return refresh_all_people()
    finally:
        _refresh_running.release()


PEOPLE_REFRESH_INTERVAL = 86400  # 24h
PEOPLE_REFRESH_INITIAL_DELAY = 300  # 5 min pärast starti


def people_refresh_loop():
    """Daemon loop: uuendab people.json aliased iga 24h."""
    time.sleep(PEOPLE_REFRESH_INITIAL_DELAY)
    print("PEOPLE REFRESH: Taustalõim käivitunud")
    while True:
        try:
            refresh_all_people_safe()
        except Exception as e:
            print(f"PEOPLE REFRESH LOOP: Viga: {e}")
        time.sleep(PEOPLE_REFRESH_INTERVAL)

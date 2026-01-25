#!/usr/bin/env python3
"""
Autorite ja isikute sidumine Wikidataga (Reconciliation).

See interaktiivne tööriist aitab siduda tekstilised autorinimed (nt "Johannes Gezelius")
Wikidata kirjega (Q-kood).

Omadused:
- Jätab meelde tehtud otsused (state/reconcile_authors_state.json).
- Saab igal hetkel katkestada ja hiljem jätkata.
- Uuendab failid jooksvalt.
- Pakub konteksti (teosed, aastad) eristamiseks.

Käivitamine:
    python3 scripts/reconcile_authors.py
"""

import os
import json
import sys
import urllib.request
import urllib.parse
import time
import re
import difflib

# Seadistused
BASE_DIR = os.getenv("VUTT_DATA_DIR", "data/")
STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "reconcile_authors_state.json")
ALBUM_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reference_data", "album_academicum.json")

# Wikidata API
WIKIDATA_API = "https://www.wikidata.org/w/api.php"

def load_album_data():
    if os.path.exists(ALBUM_FILE):
        try:
            with open(ALBUM_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Viga Album Academicumi lugemisel: {e}")
    return []

def clean_name_for_search(name):

    """

    Puhastab nime otsingu jaoks:

    1. Eemaldab sulud (ümar ja kandilised) koos sisuga

    2. Pöörab 'Perekonnanimi, Eesnimi' -> 'Eesnimi Perekonnanimi'

    """

    # 1. Asenda sulud ja nende sisu tühikuga

    # Kasutame eraldi regexi ümarsulgude ja nurksulgude jaoks, et olla kindlam

    s1 = re.sub(r'\(.*?\)', ' ', name)

    s2 = re.sub(r'\[.*?\]', ' ', s1)

    

    # 2. Eemalda üleliigsed tühikud ja sümbolid

    clean = re.sub(r'\s+', ' ', s2).strip()

    

    # 3. Pööra nimi ringi (Perekonnanimi, Eesnimi -> Eesnimi Perekonnanimi)

    if ',' in clean:

        parts = clean.split(',', 1)

        if len(parts) == 2:

            clean = f"{parts[1].strip()} {parts[0].strip()}"

            

    return clean.strip()

def search_album(query, album_data):
    matches = []
    # Query on juba clean_name_for_search poolt töödeldud
    
    # Koosta variatsioonid ka albumi jaoks
    parts = query.split()
    query_variants = [query]
    if len(parts) > 2:
        query_variants.append(" ".join(parts[:-1])) # Drop last
        query_variants.append(f"{parts[0]} {parts[-1]}") # Drop middle
    
    # Eemalda duplikaadid
    query_variants = list(dict.fromkeys(query_variants))

    for entry in album_data:
        p = entry.get('person', {})
        full_name = p.get('name', {}).get('full', '')
        if not full_name: continue
        
        # Puhastame ka Albumi nime võrdluseks (et kuju oleks sama)
        album_full_clean = clean_name_for_search(full_name).lower()
        
        best_score = 0
        for q_var in query_variants:
            q_var_lower = q_var.lower()
            
            # 1. Täpne vaste variatsiooniga
            if q_var_lower == album_full_clean:
                score = 1.0
            # 2. Fuzzy match
            else:
                score = max(
                    difflib.SequenceMatcher(None, q_var_lower, album_full_clean).ratio(),
                    difflib.SequenceMatcher(None, q_var_lower, full_name.lower()).ratio()
                )
            
            if score > best_score:
                best_score = score
            
        # 3. OCR kontroll (raw_text) - kasuta algset queryt
        raw = entry.get('raw_text') or ''
        if query.lower() in raw.lower() and best_score < 0.7:
            best_score = 0.75

        if best_score > 0.7:
            matches.append((best_score, entry))
            
    # Sorteeri skoori järgi ja tagasta entry-d
    matches.sort(key=lambda x: x[0], reverse=True)
    return [m[1] for m in matches[:3]]

def get_wikidata_entity(q_id):
    """Hangi konkreetne Wikidata üksus ID järgi."""
    params = {
        "action": "wbgetentities",
        "ids": q_id,
        "languages": "et|en|la",
        "format": "json",
        "props": "labels|descriptions",
        "origin": "*"
    }
    url = f"{WIKIDATA_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "VuttCatalog/1.0 (mailto:admin@example.com)"})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.load(response)
            entity = data.get("entities", {}).get(q_id, {})
            if entity and "labels" in entity:
                # Vali parim label (et -> en -> la)
                labels = entity["labels"]
                label_val = labels.get("et", labels.get("en", labels.get("la", {}))).get("value")
                desc_val = entity.get("descriptions", {}).get("et", entity.get("descriptions", {}).get("en", {})).get("value", "-")
                return {"id": q_id, "label": label_val, "description": desc_val}
    except Exception as e:
        print(f"Viga Wikidata päringus (ID): {e}")
    return None

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"processed": {}, "skipped": []}

def save_state(state):
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

def search_wikidata(query):
    params = {
        "action": "wbsearchentities",
        "search": query,
        "language": "et",
        "format": "json",
        "type": "item",
        "origin": "*"
    }
    url = f"{WIKIDATA_API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "VuttCatalog/1.0 (mailto:admin@example.com)"})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.load(response)
            return data.get("search", [])
    except Exception as e:
        print(f"Viga Wikidata päringus: {e}")
        return []

def get_files_with_author(author_name):
    """Leiab kõik failid, kus antud autor esineb stringina (ilma ID-ta)."""
    matches = []
    
    for root, dirs, files in os.walk(BASE_DIR):
        if '_metadata.json' in files:
            path = os.path.join(root, '_metadata.json')
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                
                found = False
                
                # Kontrolli creators massiivi
                for creator in meta.get('creators', []):
                    if creator.get('name') == author_name and not creator.get('id'):
                        found = True
                
                # Kontrolli vana 'autor'/'respondens' (kui creators puudub)
                if not meta.get('creators'):
                    if meta.get('autor') == author_name: found = True
                    if meta.get('respondens') == author_name: found = True
                
                if found:
                    year = meta.get('year') or meta.get('aasta') or "?"
                    title = meta.get('title') or meta.get('pealkiri') or "Pealkirjata"
                    matches.append({
                        "path": path,
                        "meta": meta,
                        "context": f"{title} ({year})"
                    })
            except:
                pass
    return matches

def update_file(file_path, old_name, new_entity):
    """Uuendab failis autori nime lingitud objektiks."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        
        # 1. Uuenda creators massiivis
        if 'creators' in meta:
            for creator in meta['creators']:
                if creator.get('name') == old_name:
                    creator['name'] = new_entity['label']
                    creator['id'] = new_entity['id']
                    creator['source'] = new_entity['source']
                    # Ära muuda rolli
        
        # 2. Uuenda vanu välju (kui on olemas)
        # NB: Vanade väljade puhul (stringid) me ei saa neid objektiks muuta ilma struktuuri lõhkumata.
        # Seega, me migreerime nad 'creators' massiivi, kui seda pole.
        if 'creators' not in meta:
            new_creators = []
            if meta.get('autor'):
                role = 'praeses'
                c_name = meta['autor']
                c_id = new_entity['id'] if c_name == old_name else None
                new_creators.append({"name": c_name, "role": role, "id": c_id, "source": "wikidata" if c_id else "manual"})
            
            if meta.get('respondens'):
                role = 'respondens'
                c_name = meta['respondens']
                c_id = new_entity['id'] if c_name == old_name else None
                new_creators.append({"name": c_name, "role": role, "id": c_id, "source": "wikidata" if c_id else "manual"})
            
            if new_creators:
                meta['creators'] = new_creators
                # Eemalda vanad väljad
                if 'autor' in meta: del meta['autor']
                if 'respondens' in meta: del meta['respondens']

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
            
        return True
    except Exception as e:
        print(f"Viga faili salvestamisel {file_path}: {e}")
        return False

def main():
    print("---" + " AUTORITE ÜHTLUSTAJA " + "---")
    state = load_state()
    album_data = load_album_data()
    if album_data:
        print(f"Laetud {len(album_data)} kirjet Album Academicumist.")
        
    processed = set(state['processed'].keys())
    
    # 1. Kogu kõik unikaalsed sidumata autorid
    print("Kogun andmeid...")
    unique_authors = set()
    
    for root, dirs, files in os.walk(BASE_DIR):
        if '_metadata.json' in files:
            path = os.path.join(root, '_metadata.json')
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                
                # Lisa nimed, mis pole veel lingitud
                for c in meta.get('creators', []):
                    if not c.get('id') and c.get('name'):
                        unique_authors.add(c.get('name'))
                
                if not meta.get('creators'):
                    if meta.get('autor'): unique_authors.add(meta['autor'])
                    if meta.get('respondens'): unique_authors.add(meta['respondens'])
            except:
                pass
    
    todo = sorted(list(unique_authors - processed))
    print(f"Leiti {len(unique_authors)} unikaalset nime.")
    print(f"Juba töödeldud: {len(processed)}")
    print(f"Teha: {len(todo)}\n")
    
    if not todo:
        print("Kõik tehtud!")
        return

    # 2. Töötle järjest
    for i, name in enumerate(todo):
        print(f"\n[{i+1}/{len(todo)}] Nimi: {name}")
        
        # Leia kontekst (kus failides esineb)
        files = get_files_with_author(name)
        if not files:
            print("  Ei leidnud enam failidest (võib-olla muudeti eelmise sammuga).")
            continue
            
        print(f"  Esineb {len(files)} failis. Näiteks:")
        for f in files[:3]:
            print(f"    - {f['context']}")
        
        # Otsi Wikidatast
        search_query = clean_name_for_search(name)
        print(f"  Otsin Wikidatast: '{search_query}'")
        
        # KONTROLLI: Kas me oleme sarnast nime juba lahendanud?
        previous_match = None
        for processed_name, processed_id in state['processed'].items():
            if processed_id != "LOCAL" and clean_name_for_search(processed_name) == search_query:
                previous_match = processed_id
                break
        
        if previous_match:
            print(f"  LEITUD EELMINE OTSUS: '{processed_name}' oli seotud {previous_match}-ga.")
            auto_choice = input(f"  Kas soovid kasutada sama vastet ({previous_match})? [Y/n] > ").strip().lower()
            if auto_choice in ['', 'y']:
                # Kui on AA ID, siis ära küsi Wikidatast
                if str(previous_match).startswith('AA:'):
                     # Leia AA kirje
                     num = int(previous_match.split(':')[1])
                     entry = next((e for e in album_data if e.get('entry_number') == num), None)
                     if entry:
                         name_aa = entry.get('person', {}).get('name', {}).get('full')
                         new_entity = {"label": name_aa, "id": previous_match, "source": "album_academicum"}
                         count = 0
                         for f in files:
                            if update_file(f['path'], name, new_entity): count += 1
                         state['processed'][name] = previous_match
                         save_state(state)
                         print(f"  Automaatselt seotud {previous_match} ({name_aa}) {count} failis.")
                         continue
                else:
                    # Wikidata ID puhul küsi Wikidatast
                    entity = get_wikidata_entity(previous_match)
                    if entity:
                         new_entity = {"label": entity['label'], "id": entity['id'], "source": "wikidata"}
                         count = 0
                         for f in files:
                            if update_file(f['path'], name, new_entity): count += 1
                         state['processed'][name] = entity['id']
                         save_state(state)
                         print(f"  Automaatselt seotud {entity['id']} ({entity['label']}) {count} failis.")
                         continue

        results = search_wikidata(search_query)

        # Kui ei leidnud, proovi variatsioone (Waterfall strateegia)
        if not results:
            variations = []
            parts = search_query.split()
            
            # 1. Proovi ilma viimase nimeta (nt Andreas Arvidi Stregnensis -> Andreas Arvidi)
            if len(parts) > 2:
                variations.append(" ".join(parts[:-1]))
            
            # 2. Proovi ilma keskmiste nimedeta (nt Andreas Arvidi Stregnensis -> Andreas Stregnensis)
            if len(parts) > 2:
                variations.append(f"{parts[0]} {parts[-1]}")
            
            # 3. Proovi ilma -ensis lõpuga sõnadeta (kui neid on)
            ensis_removed = [p for p in parts if not p.lower().endswith('ensis')]
            if len(ensis_removed) < len(parts) and len(ensis_removed) >= 1:
                variations.append(" ".join(ensis_removed))
            
            # 4. Proovi asendada -is -> -es (Johannis -> Johannes) jms
            base_variations = [search_query] + variations
            final_variations = []
            
            for base in base_variations:
                if 'Johannis' in base:
                    final_variations.append(base.replace('Johannis', 'Johannes'))
                elif 'Johannes' in base:
                    final_variations.append(base.replace('Johannes', 'Johannis'))
            
            all_variations = variations + final_variations
            unique_vars = []
            seen = set([search_query])
            for v in all_variations:
                if v not in seen:
                    unique_vars.append(v)
                    seen.add(v)

            for var in unique_vars:
                print(f"    ...ei leidnud. Proovin: '{var}'")
                results = search_wikidata(var)
                if results:
                    break

        # Otsi Album Academicumist
        album_matches = search_album(search_query, album_data) if album_data else []

        # Kuva valikud (Album Academicum esimesena, et anda konteksti)
        if album_matches:
            print("\n  VALIKUD (ALBUM ACADEMICUM):")
            for idx, entry in enumerate(album_matches):
                p = entry.get('person', {})
                name_aa = p.get('name', {}).get('full')
                death = p.get('death', {}).get('date') or "?"
                origin = p.get('origin', {}).get('city') or "?"
                num = entry.get('entry_number')
                print(f"    A{idx+1}. {name_aa} (surn. {death}, pärit {origin}) [AA:{num}]")

        # Kuva valikud (Wikidata)
        print("\n  VALIKUD (WIKIDATA):")
        if results:
            for idx, res in enumerate(results[:5]):
                desc = res.get('description', '-')
                print(f"    {idx+1}. {res['label']} ({res['id']}) - {desc}")
        else:
            print("    (Wikidatast vasteid ei leitud)")

        print("\n    L. (Local) - Märgi lokaalseks (ei seo Wikidataga)")
        print("    S. (Skip)  - Jäta vahele")
        print("    M. (Manual ID) - Sisesta Q-kood käsitsi")
        print("    R. (Rename) - Nimeta ümber")
        print("    Q. (Quit) - Lõpeta")
        
        choice = input("\n  Valik > ").strip().lower()
        
        if choice == 'q':
            print("Salvestan oleku ja lõpetan.")
            break
        
        elif choice.startswith('a') and len(choice) > 1 and choice[1:].isdigit():
            idx = int(choice[1:]) - 1
            if 0 <= idx < len(album_matches):
                entry = album_matches[idx]
                num = entry.get('entry_number')
                name_aa = entry.get('person', {}).get('name', {}).get('full')
                new_entity = {
                    "label": name_aa,
                    "id": f"AA:{num}",
                    "source": "album_academicum"
                }
                count = 0
                for f in files:
                    if update_file(f['path'], name, new_entity): count += 1
                state['processed'][name] = f"AA:{num}"
                save_state(state)
                print(f"  Seotud Album Academicumiga (AA:{num}) {count} failis.")
                continue

        elif choice == 's':
            print("  Vahele jäetud.")
            continue
            
        elif choice == 'l':
            state['processed'][name] = "LOCAL"
            save_state(state)
            print("  Märgitud lokaalseks.")
            
        elif choice == 'r':
            new_name = input("  Sisesta uus nimi > ").strip()
            if new_name:
                new_entity = {"label": new_name, "id": None, "source": "manual"}
                count = 0
                for f in files:
                    if update_file(f['path'], name, new_entity): count += 1
                print(f"  Nimi muudetud {count} failis.")
        
        elif choice == 'm':
            q_code = input("  Sisesta Q-kood (nt Q123) > ").strip().upper()
            if q_code.startswith('Q'):
                entity = get_wikidata_entity(q_code)
                if entity:
                    print(f"  Leiti: {entity['label']} - {entity['description']}")
                    confirm = input(f"  Kas seome sellega? [Y/n] > ").strip().lower()
                    if confirm in ['', 'y']:
                        new_entity = {"label": entity['label'], "id": q_code, "source": "wikidata"}
                        count = 0
                        for f in files:
                            if update_file(f['path'], name, new_entity): count += 1
                        state['processed'][name] = q_code
                        save_state(state)
                        print(f"  Seotud {q_code}-ga {count} failis.")
                else:
                    print(f"  Ei leidnud Wikidatast üksust koodiga {q_code}.")
        
        elif choice.isdigit() and 1 <= int(choice) <= len(results):
            res = results[int(choice) - 1]
            new_entity = {"label": res['label'], "id": res['id'], "source": "wikidata"}
            count = 0
            for f in files:
                if update_file(f['path'], name, new_entity): count += 1
            state['processed'][name] = res['id']
            save_state(state)
            print(f"  Seotud {res['id']}-ga {count} failis.")

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\nKatkestatud kasutaja poolt.")

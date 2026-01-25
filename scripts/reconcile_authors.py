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

# Seadistused
BASE_DIR = os.getenv("VUTT_DATA_DIR", "data/")
STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "reconcile_authors_state.json")

# Wikidata API
WIKIDATA_API = "https://www.wikidata.org/w/api.php"

def clean_name_for_search(name):
    """
    Puhastab nime otsingu jaoks:
    1. Eemaldab sulud ja nende sisu: "Albogius (Albohm)" -> "Albogius"
    2. Pöörab 'Perekonnanimi, Eesnimi' -> 'Eesnimi Perekonnanimi'
    """
    # Eemalda sulud koos sisuga
    name_clean = re.sub(r'\s*\(.*?\)', '', name)
    
    # Pöörab nime ümber, kui on koma
    if ',' in name_clean:
        parts = name_clean.split(',', 1)
        if len(parts) == 2:
            return f"{parts[1].strip()} {parts[0].strip()}".strip()
            
    return name_clean.strip()

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
    print("--- AUTORITE ÜHTLUSTAJA ---")
    state = load_state()
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
            
        results = search_wikidata(search_query)

        # Kui ei leidnud, proovi variatsioone
        if not results:
            variations = []
            
            # 1. Johannis <-> Johannes
            if 'Johannis' in search_query:
                variations.append(search_query.replace('Johannis', 'Johannes'))
            elif 'Johannes' in search_query:
                variations.append(search_query.replace('Johannes', 'Johannis'))
            
            # 2. Eemalda patronüümid (enamasti -is lõpuga keskmine nimi)
            parts = search_query.split()
            if len(parts) > 2:
                # Proovi ilma keskmise nimeta (nt Ericus Johannis Albogius -> Ericus Albogius)
                variations.append(f"{parts[0]} {parts[-1]}")
                
                # Proovi asendada -is -> -es (Johannis -> Johannes)
                new_parts = []
                for p in parts:
                    if p.endswith('is') and len(p) > 4:
                        new_parts.append(p[:-2] + 'es')
                    else:
                        new_parts.append(p)
                variations.append(" ".join(new_parts))

            for var in variations:
                if var == search_query: continue
                print(f"    ...ei leidnud. Proovin: '{var}'")
                results = search_wikidata(var)
                if results:
                    break
        
        # Kuva valikud
        print("\n  VALIKUD:")
        for idx, res in enumerate(results[:5]):
            desc = res.get('description', '-')
            print(f"    {idx+1}. {res['label']} ({res['id']}) - {desc}")
        
        print("    L. (Local) - Märgi lokaalseks (ei seo Wikidataga, aga loe tehtuks)")
        print("    S. (Skip)  - Jäta vahele (küsi hiljem uuesti)")
        print("    M. (Manual ID) - Sisesta Q-kood käsitsi")
        print("    R. (Rename) - Nimeta ümber (ja otsi uuesti)")
        print("    Q. (Quit) - Lõpeta praeguseks")
        
        choice = input("\n  Valik > ").strip().lower()
        
        if choice == 'q':
            print("Salvestan oleku ja lõpetan.")
            break
        
        elif choice == 's':
            print("  Vahele jäetud.")
            continue
            
        elif choice == 'l':
            # Märgi lokaalseks (processed = "LOCAL")
            state['processed'][name] = "LOCAL"
            save_state(state)
            print("  Märgitud lokaalseks.")
            
        elif choice == 'r':
            new_name = input("  Sisesta uus nimi > ").strip()
            if new_name:
                # Uuenda failides nimi ära, aga ära märgi tehtuks (järgmine kord leiab uue nimega)
                new_entity = {"label": new_name, "id": None, "source": "manual"}
                count = 0
                for f in files:
                    if update_file(f['path'], name, new_entity): count += 1
                print(f"  Nimi muudetud {count} failis. Uus nimi ilmub nimekirja järgmisel käivitusel.")
        
        elif choice == 'm':
            q_code = input("  Sisesta Q-kood (nt Q123) > ").strip().upper()
            label = input(f"  Sisesta silt (vaikimisi '{name}') > ").strip() or name
            if q_code.startswith('Q'):
                new_entity = {"label": label, "id": q_code, "source": "wikidata"}
                count = 0
                for f in files:
                    if update_file(f['path'], name, new_entity): count += 1
                
                state['processed'][name] = q_code
                save_state(state)
                print(f"  Seotud {q_code}-ga {count} failis.")
            else:
                print("  Vigane kood, jätsin vahele.")

        elif choice.isdigit() and 1 <= int(choice) <= len(results):
            res = results[int(choice) - 1]
            new_entity = {"label": res['label'], "id": res['id'], "source": "wikidata"}
            
            count = 0
            for f in files:
                if update_file(f['path'], name, new_entity): count += 1
            
            state['processed'][name] = res['id']
            save_state(state)
            print(f"  Seotud {res['id']}-ga {count} failis.")
            
        else:
            print("  Tundmatu valik, jätsin vahele.")

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\nKatkestatud kasutaja poolt.")

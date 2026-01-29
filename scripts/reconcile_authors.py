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
import requests
import time
import re
import difflib
from collections import Counter

# Seadistused
BASE_DIR = os.getenv("VUTT_DATA_DIR", "data/")
STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "reconcile_authors_state.json")
ALBUM_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reference_data", "album_academicum.json")

# Wikidata API
WIKIDATA_API = "https://www.wikidata.org/w/api.php"

# VIAF API (SRU otsing, parem kui AutoSuggest ajalooliste nimede jaoks)
VIAF_SEARCH = "https://viaf.org/viaf/search"

# Värvid terminali jaoks
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    RED = '\033[91m'
    BOLD = '\033[1m'
    BG_GREEN = '\033[42m\033[30m' # Must tekst rohelisel taustal
    BG_BLUE = '\033[44m\033[37m'  # Valge tekst sinisel taustal
    BG_YELLOW = '\033[43m\033[30m' # Must tekst kollasel taustal
    BG_MAGENTA = '\033[45m\033[37m' # Valge tekst magenta taustal (VIAF)
    RESET = '\033[0m'

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
    Puhastab nime baaskujule.
    Eemaldab sulud (aga jätab sisu meelde main funktsiooni jaoks).
    Wal(l)erius -> Walerius (mitte "Wal erius")
    """
    # Inline sulud (sõna sees, nt "Wal(l)erius") - eemalda sulud koos sisuga
    name_clean = re.sub(r'(\w)\((\w+)\)(\w)', r'\1\3', name)

    # Eraldiseisvad sulud (nt "(Carlhielm)") - asenda tühikuga
    name_clean = re.sub(r'\s*\([^)]*\)\s*', ' ', name_clean)
    name_clean = re.sub(r'\s*\[[^\]]*\]\s*', ' ', name_clean)

    clean = re.sub(r'\s+', ' ', name_clean).strip()

    if ',' in clean:
        parts = clean.split(',', 1)
        if len(parts) == 2:
            clean = f"{parts[1].strip()} {parts[0].strip()}"

    return clean.strip()

def get_name_variants_from_parentheses(name):
    """
    Eraldab sulgudest nimevariandid.
    Näiteks: "Carlholm (Carlhielm), Gustavus" -> ["Gustavus Carlholm", "Gustavus Carlhielm"]
    Näiteks: "Wal(l)erius, Laurentius" -> ["Laurentius Walerius", "Laurentius Wallerius"]
    """
    variants = []

    # Inline sulud sõna sees (nt "Wal(l)erius")
    inline_match = re.search(r'(\w+)\((\w+)\)(\w*)', name)
    if inline_match:
        prefix = inline_match.group(1)
        optional = inline_match.group(2)
        suffix = inline_match.group(3)

        # Variant 1: ilma sulgude sisuta (Walerius)
        name_v1 = name[:inline_match.start()] + prefix + suffix + name[inline_match.end():]
        variants.append(clean_name_for_search(name_v1))

        # Variant 2: koos sulgude sisuga (Wallerius)
        name_v2 = name[:inline_match.start()] + prefix + optional + suffix + name[inline_match.end():]
        variants.append(clean_name_for_search(name_v2))

        return variants

    # Eraldiseisvad sulud (nt "(Carlhielm)")
    matches = re.findall(r'\((.*?)\)', name)
    if not matches:
        return []

    # Eemalda sulud algsest nimest, et saada "põhinimi"
    base_name = clean_name_for_search(name)
    variants.append(base_name)

    for m in matches:
        # Kui sulgudes on ainult üks sõna (perekonnanimi), proovi seda asendada
        if len(m.split()) == 1 and ',' in name:
            surname = name.split(',')[0].strip()
            first_names = name.split(',')[1].split('(')[0].strip()
            variants.append(f"{first_names} {m.strip()}")
        else:
            # Muidu proovi sulgudes olevat asja eesnimena või eraldi
            variants.append(m.strip())

    return variants

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
    headers = {"User-Agent": "VuttCatalog/1.0 (mailto:admin@example.com)"}
    try:
        response = requests.get(WIKIDATA_API, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
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
    headers = {"User-Agent": "VuttCatalog/1.0 (mailto:admin@example.com)"}
    try:
        response = requests.get(WIKIDATA_API, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        return data.get("search", [])
    except Exception as e:
        print(f"Viga Wikidata päringus: {e}")
        return []

def normalize_viaf_name(name):
    """
    Normaliseerib VIAF nimekuju.
    'Turdinus, Petrus' -> 'Petrus Turdinus'
    'Gezelius, Johannes, 1615-1690' -> 'Johannes Gezelius'
    'Schaefer, Johannes Henrici, d. 1682' -> 'Johannes Henrici Schaefer'
    """
    if not name:
        return name

    # Eemalda lõpust punkt
    name = name.rstrip('.')

    # Eemalda daatumid ja sajandid (mitu formaati)
    name = re.sub(r',?\s*\d{4}\s*-\s*\d{4}\.?\s*$', '', name)  # "1615-1690"
    name = re.sub(r',?\s*\d{4}\s*-\s*$', '', name)  # "1615-"
    name = re.sub(r',?\s*-\s*\d{4}\s*$', '', name)  # "-1690"
    name = re.sub(r',?\s*d\.\s*\d{4}\s*$', '', name)  # "d. 1682"
    name = re.sub(r',?\s*b\.\s*\d{4}\s*$', '', name)  # "b. 1615"
    name = re.sub(r',?\s*fl\.\s*\d{4}\s*$', '', name)  # "fl. 1650"
    name = re.sub(r',?\s*ca\.?\s*\d{4}\s*-\s*ca\.?\s*\d{4}\s*$', '', name)  # "ca. 1600-ca. 1650"
    name = re.sub(r',?\s*ca\.?\s*\d{1,2}\.\s*Jh\.?\s*$', '', name)  # "ca. 17. Jh" (saksa sajand)
    name = re.sub(r',?\s*\d{1,2}\.\s*Jh\.?\s*$', '', name)  # "17. Jh"
    name = re.sub(r',?\s*\d{1,2}th\s+cent\.?\s*$', '', name, flags=re.IGNORECASE)  # "17th cent."

    # Kui on koma, pööra ümber: "Perenimi, Eesnimi" -> "Eesnimi Perenimi"
    if ',' in name:
        parts = name.split(',', 1)
        if len(parts) == 2:
            surname = parts[0].strip()
            firstname = parts[1].strip()
            # Eemalda võimalikud lisad eesnimest (nt "Jr." või numbreid)
            firstname = re.sub(r'\s+(Jr\.?|Sr\.?|I+V?|V?I*)$', '', firstname)
            name = f"{firstname} {surname}"

    return name.strip()

def search_viaf(query):
    """
    Otsib VIAF SRU API-st (parem kui AutoSuggest ajalooliste nimede jaoks).
    Tagastab listi: [{"viaf_id": "123", "label": "Petrus Turdinus", "raw_label": "Turdinus, Petrus", "sources": 5}, ...]
    """
    headers = {
        "User-Agent": "VuttCatalog/1.0 (mailto:admin@example.com)",
        "Accept": "application/json"
    }
    try:
        # SRU otsing - otsib nime kõikjalt
        response = requests.get(
            VIAF_SEARCH,
            params={"query": query},
            headers=headers,
            timeout=15
        )
        response.raise_for_status()
        data = response.json()

        results = []

        # SRU vastus on keerulisem struktuur
        srw = data.get("searchRetrieveResponse", {})
        records = srw.get("records", {})

        # Võib olla üks kirje (dict) või mitu (list)
        record_list = records.get("record", [])
        if isinstance(record_list, dict):
            record_list = [record_list]

        for record in record_list[:5]:
            record_data = record.get("recordData", {})
            cluster = record_data.get("ns2:VIAFCluster", {})

            if not cluster:
                continue

            viaf_id = cluster.get("ns2:viafID")
            if not viaf_id:
                continue

            # Nimed on mainHeadings all
            main_headings = cluster.get("ns2:mainHeadings", {})
            heading_data = main_headings.get("ns2:data", [])
            if isinstance(heading_data, dict):
                heading_data = [heading_data]

            # Võta esimene nimi (kõige rohkemate allikatega)
            raw_label = ""
            sources_count = 0
            for hd in heading_data:
                text = hd.get("ns2:text", "")
                if text:
                    raw_label = text
                    # Allikad võivad olla list või dict
                    src = hd.get("ns2:sources", {})
                    if isinstance(src.get("ns2:s"), list):
                        sources_count = len(src.get("ns2:s", []))
                    else:
                        sources_count = 1
                    break

            if not raw_label:
                continue

            # Normaliseeri nimekuju
            label = normalize_viaf_name(raw_label)

            results.append({
                "viaf_id": str(viaf_id),
                "label": label,
                "raw_label": raw_label,
                "sources": sources_count
            })

        return results
    except Exception as e:
        print(f"Viga VIAF päringus: {e}")
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
    author_counts = Counter()
    
    for root, dirs, files in os.walk(BASE_DIR):
        if '_metadata.json' in files:
            path = os.path.join(root, '_metadata.json')
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                
                # Lisa nimed, mis pole veel lingitud
                for c in meta.get('creators', []):
                    if not c.get('id') and c.get('name'):
                        author_counts[c.get('name')] += 1
                
                if not meta.get('creators'):
                    if meta.get('autor'): author_counts[meta['autor']] += 1
                    if meta.get('respondens'): author_counts[meta['respondens']] += 1
            except:
                pass
    
    unique_authors = set(author_counts.keys())
    todo = sorted(list(unique_authors - processed), key=lambda x: author_counts[x], reverse=True)
    print(f"Leiti {len(unique_authors)} unikaalset nime.")
    print(f"Juba töödeldud: {len(processed)}")
    print(f"Teha: {len(todo)}\n")
    
    if not todo:
        print("Kõik tehtud!")
        return

    # 2. Töötle järjest
    for i, name in enumerate(todo):
        search_query = clean_name_for_search(name)
        
        # Kuva nimi kollase taustaga
        name_display = f"{Colors.BG_YELLOW}{name}{Colors.RESET}"
        print(f"\n[{i+1}/{len(todo)}] Nimi: {name_display} ({author_counts[name]} teost)")

        # Leia kontekst
        files = get_files_with_author(name)
        if not files:
            print("  Ei leidnud enam failidest (võib-olla muudeti eelmise sammuga).")
            continue
            
        print(f"  Esineb {len(files)} failis. Näiteks:")
        for f in files[:3]:
            print(f"    - {f['context']}")

        # Kontrolli automaatselt eelmist vastet (ainult esimesel ringil)
        previous_match = None
        for processed_name, processed_id in state['processed'].items():
            if processed_id != "LOCAL" and clean_name_for_search(processed_name) == search_query:
                previous_match = processed_id
                break
        
        if previous_match:
            print(f"  LEITUD EELMINE OTSUS: '{processed_name}' oli seotud {previous_match}-ga.")
            auto_choice = input(f"  Kas soovid kasutada sama vastet ({previous_match})? [Y/n] > ").strip().lower()
            if auto_choice in ['', 'y']:
                # ... (sama loogika mis enne, aga lühendatult siin kontekstis) ...
                if str(previous_match).startswith('AA:'):
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
                elif str(previous_match).startswith('VIAF:'):
                    prev_label = clean_name_for_search(processed_name)
                    new_entity = {"label": prev_label, "id": previous_match, "source": "viaf"}
                    count = 0
                    for f in files:
                        if update_file(f['path'], name, new_entity): count += 1
                    state['processed'][name] = previous_match
                    save_state(state)
                    print(f"  Automaatselt seotud {previous_match} ({prev_label}) {count} failis.")
                    continue
                else:
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

        # Algne otsing
        results = search_wikidata(search_query)
        # ... (Waterfall strateegia jääb siia vahele, aga lihtsuse mõttes jätame selle bloki samaks või tõstame funktsiooni, 
        # aga antud juhul teeme lihtsa "esimene käivitus" loogika)

        # Kui ei leidnud, proovi variatsioone (Waterfall) - kopeerime olemasoleva loogika siia, et see töötaks esimesel korral
        if not results:
            def get_variants(base_str):
                vars_list = []
                words = base_str.split()
                if len(words) > 0:
                    first_name = words[0]
                    if first_name.endswith('us'): vars_list.append(" ".join([first_name[:-2]] + words[1:]))
                    if first_name.endswith('ius'): vars_list.append(" ".join([first_name[:-3]] + words[1:]))

                common_replacements = {
                    'Jacob': 'Jakob', 'Jakob': 'Jacob', 'Carl': 'Karl', 'Karl': 'Carl',
                    'Eric': 'Erik', 'Erik': 'Eric', 'Ericus': 'Erik', 'Nicolaus': 'Nikolaus', 
                    'Nikolaus': 'Nicolaus', 'Nils': 'Nicolaus', 'Marcus': 'Markus', 'Markus': 'Marcus',
                    'Lucas': 'Lukas', 'Lukas': 'Lucas', 'Friderico': 'Friedrich', 'Friedrich': 'Friderico',
                    'Christian': 'Kristian', 'Kristian': 'Christian', 'Gustav': 'Gustaf', 'Gustaf': 'Gustav',
                    'Sueno': 'Sven', 'Sven': 'Sueno', 'Laurentius': 'Lars', 'Lars': 'Laurentius',
                    'Henricus': 'Henrik', 'Henrik': 'Henricus', 'Georgius': 'Georg', 'Georg': 'Georgius',
                    'Olaus': 'Olof', 'Olof': 'Olaus', 'Petrus': 'Peter', 'Peter': 'Petrus'
                }
                
                # ... (säilitame olemasoleva variatsioonide loogika) ...
                if 'Johannis' in base_str: vars_list.append(base_str.replace('Johannis', 'Johannes'))
                elif 'Johannes' in base_str: vars_list.append(base_str.replace('Johannes', 'Johannis'))
                    
                words = base_str.split()
                new_words = []
                changed = False
                for w in words:
                    w_clean = w.strip('.,')
                    if w_clean in common_replacements:
                        new_words.append(common_replacements[w_clean])
                        changed = True
                    elif 'Frideric' in w and 'Friedrich' not in w:
                         new_words.append(w.replace('Frideric', 'Friedrich').replace('o', ''))
                         changed = True
                    else:
                        new_words.append(w)
                if changed: vars_list.append(" ".join(new_words))
                return vars_list

            search_queue = []
            paren_variants = get_name_variants_from_parentheses(name)
            for pv in paren_variants:
                if pv not in search_queue:
                    search_queue.append(pv)
                    search_queue.extend(get_variants(pv))
            search_queue.extend(get_variants(search_query))
            parts = search_query.split()
            short_forms = []
            if len(parts) > 2:
                short_forms.append(" ".join(parts[:-1]))
                short_forms.append(f"{parts[0]} {parts[-1]}")
            ensis_removed = [p for p in parts if not p.lower().endswith('ensis')]
            if len(ensis_removed) < len(parts) and len(ensis_removed) >= 1:
                short_forms.append(" ".join(ensis_removed))
            search_queue.extend(short_forms)
            for sf in short_forms: search_queue.extend(get_variants(sf))
            
            unique_queue = []
            seen = set([search_query])
            for q in search_queue:
                if q not in seen: unique_queue.append(q); seen.add(q)
            
            for var in unique_queue:
                # print(f"    ...ei leidnud. Proovin: '{var}'") # Liiga palju müra
                res_tmp = search_wikidata(var)
                if res_tmp:
                    results = res_tmp
                    # print(f"    Leitud variatsiooniga: '{var}'")
                    search_query = var # Uuenda otsingusõna, et ka teised allikad kasutaksid paremat varianti
                    break

        # Algne päring teistest allikatest
        album_matches = search_album(search_query, album_data) if album_data else []
        viaf_results = search_viaf(search_query)

        # SISEMISE TSÜKLI ALGUS (et saaks uuesti otsida)
        while True:
            # Kuva hetke otsingusõna
            print(f"\n  Otsingusõna: '{Colors.BOLD}{search_query}{Colors.RESET}'")

            # Kuva valikud (Album Academicum)
            if album_matches:
                print(f"\n  {Colors.BOLD}VALIKUD (ALBUM ACADEMICUM):{Colors.RESET}")
                for idx, entry in enumerate(album_matches):
                    p = entry.get('person', {})
                    name_aa = p.get('name', {}).get('full')
                    death = p.get('death', {}).get('date') or "?"
                    origin = p.get('origin', {}).get('city') or "?"
                    num = entry.get('entry_number')
                    style = Colors.BG_BLUE if idx == 0 else ""
                    print(f"    {style}A{idx+1}. {name_aa} (surn. {death}, pärit {origin}) [AA:{num}]{Colors.RESET}")
            else:
                print(f"\n  {Colors.RED}VALIKUD (ALBUM ACADEMICUM): (Vasteid ei leitud){Colors.RESET}")

            # Kuva valikud (VIAF)
            print(f"\n  {Colors.BOLD}VALIKUD (VIAF):{Colors.RESET}")
            if viaf_results:
                for idx, res in enumerate(viaf_results[:5]):
                    style = Colors.BG_MAGENTA if idx == 0 else ""
                    print(f"    {style}V{idx+1}. {res['raw_label']} [VIAF:{res['viaf_id']}]{Colors.RESET}")
                    print(f"        {Colors.GREEN}→ kirjutatakse: \"{res['label']}\"{Colors.RESET}")
            else:
                print(f"    {Colors.RED}(VIAF-ist vasteid ei leitud){Colors.RESET}")

            # Kuva valikud (Wikidata)
            print(f"\n  {Colors.BOLD}VALIKUD (WIKIDATA):{Colors.RESET}")
            if results:
                for idx, res in enumerate(results[:5]):
                    desc = res.get('description', '-')
                    style = Colors.BG_GREEN if idx == 0 else ""
                    print(f"    {style}{idx+1}. {res['label']} ({res['id']}) - {desc}{Colors.RESET}")
            else:
                print(f"    {Colors.RED}(Wikidatast vasteid ei leitud){Colors.RESET}")

            print("\n    O. (Otsi)  - Otsi uue nimega (VIAF/Wiki/Album)")
            print("    L. (Local) - Märgi lokaalseks (ei seo Wikidataga)")
            print("    S. (Skip)  - Jäta vahele")
            print("    M. (Manual ID) - Sisesta Q-kood käsitsi")
            print("    R. (Rename) - Nimeta ümber")
            print("    Q. (Quit) - Lõpeta")
            
            choice = input("\n  Valik > ").strip().lower()
            
            if choice == 'q':
                print("Salvestan oleku ja lõpetan.")
                sys.exit(0) # Välju täielikult
            
            elif choice == 'o':
                new_query = input("  Sisesta uus otsingusõna > ").strip()
                if new_query:
                    search_query = new_query
                    print(f"  Otsin uuesti: '{search_query}'...")
                    results = search_wikidata(search_query)
                    viaf_results = search_viaf(search_query)
                    album_matches = search_album(search_query, album_data) if album_data else []
                continue # Kordab while tsüklit uute tulemustega

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
                    break # Välju while tsüklist, mine järgmise nime juurde

            elif choice.startswith('v') and len(choice) > 1 and choice[1:].isdigit():
                idx = int(choice[1:]) - 1
                if 0 <= idx < len(viaf_results):
                    res = viaf_results[idx]
                    viaf_id = f"VIAF:{res['viaf_id']}"
                    new_entity = {
                        "label": res['label'],
                        "id": viaf_id,
                        "source": "viaf"
                    }
                    count = 0
                    for f in files:
                        if update_file(f['path'], name, new_entity): count += 1
                    state['processed'][name] = viaf_id
                    save_state(state)
                    print(f"  Seotud VIAF-iga ({viaf_id}) nimega '{res['label']}' {count} failis.")
                    break

            elif choice == 's':
                print("  Vahele jäetud.")
                break
                
            elif choice == 'l':
                state['processed'][name] = "LOCAL"
                save_state(state)
                print("  Märgitud lokaalseks.")
                break
                
            elif choice == 'r':
                new_name = input("  Sisesta uus nimi > ").strip()
                if new_name:
                    new_entity = {"label": new_name, "id": None, "source": "manual"}
                    count = 0
                    for f in files:
                        if update_file(f['path'], name, new_entity): count += 1
                    print(f"  Nimi muudetud {count} failis.")
                    # Rename puhul võime ka tsükli katkestada, sest failid on muudetud ja nimi ei pruugi enam 'todo' listiga klappida
                    # Või siis märgime 'processed' ja liigume edasi
                    state['processed'][name] = "RENAMED" 
                    save_state(state)
                    break
            
            elif choice == 'm':
                manual_input = input("  Sisesta ID (Q123, VIAF:123) või permalink > ").strip()
                
                # Tuvasta permalinkidest ID
                if 'viaf.org/viaf/' in manual_input:
                    match = re.search(r'viaf\.org/viaf/(\d+)', manual_input)
                    manual_id = f"VIAF:{match.group(1)}" if match else manual_input
                elif 'wikidata.org/wiki/' in manual_input:
                    match = re.search(r'wikidata\.org/wiki/(Q\d+)', manual_input)
                    manual_id = match.group(1) if match else manual_input
                else:
                    manual_id = manual_input

                if manual_id.upper().startswith('Q'):
                    q_code = manual_id.upper()
                    entity = get_wikidata_entity(q_code)
                    if entity:
                        print(f"  Leiti Wikidatast: {entity['label']} - {entity['description']}")
                        confirm = input(f"  Kas seome sellega? [Y/n] > ").strip().lower()
                        if confirm in ['', 'y']:
                            new_entity = {"label": entity['label'], "id": q_code, "source": "wikidata"}
                            count = 0
                            for f in files:
                                if update_file(f['path'], name, new_entity): count += 1
                            state['processed'][name] = q_code
                            save_state(state)
                            print(f"  Seotud {q_code}-ga {count} failis.")
                            break
                    else:
                        print(f"  Ei leidnud Wikidatast üksust koodiga {q_code}.")
                elif manual_id.upper().startswith('VIAF:'):
                    viaf_code = manual_id.split(':', 1)[1].strip()
                    label = input(f"  Sisesta nimi (vaikimisi '{name}') > ").strip() or name
                    new_entity = {"label": label, "id": viaf_code, "source": "viaf"}
                    count = 0
                    for f in files:
                        if update_file(f['path'], name, new_entity): count += 1
                    state['processed'][name] = f"VIAF:{viaf_code}"
                    save_state(state)
                    print(f"  Seotud VIAF-iga ({viaf_code}) {count} failis.")
                    break
                else:
                    print("  Tundmatu ID vorming. Kasuta Q123, VIAF:123 või kopeeri permalink.")

            elif choice.isdigit() and 1 <= int(choice) <= len(results):
                res = results[int(choice) - 1]
                new_entity = {"label": res['label'], "id": res['id'], "source": "wikidata"}
                count = 0
                for f in files:
                    if update_file(f['path'], name, new_entity): count += 1
                state['processed'][name] = res['id']
                save_state(state)
                print(f"  Seotud {res['id']}-ga {count} failis.")
                break


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\nKatkestatud kasutaja poolt.")
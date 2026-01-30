"""
Abifunktsioonid ja utiliidid.
"""
import os
import re
import json
import secrets
import string
import tempfile
import unicodedata
from .config import BASE_DIR


def atomic_write_json(filepath, data, indent=2):
    """Kirjutab JSON faili atomically (temp file + rename).

    See tagab, et serveri crashi korral ei jää fail poolikuks.
    os.replace() on atomic operatsioon POSIX süsteemides.

    Args:
        filepath: Sihtfaili absoluutne tee
        data: JSON-serialiseeritavad andmed
        indent: JSON indentatsiooni tase (default 2)
    """
    dir_name = os.path.dirname(filepath)
    tmp_path = None

    try:
        # Loo temp fail samas kataloogis (vajalik atomic rename jaoks)
        with tempfile.NamedTemporaryFile(
            mode='w',
            encoding='utf-8',
            dir=dir_name,
            delete=False,
            prefix='.tmp_',
            suffix='.json'
        ) as tmp:
            json.dump(data, tmp, ensure_ascii=False, indent=indent)
            tmp_path = tmp.name

        # Atomic rename (asendab olemasoleva faili)
        os.replace(tmp_path, filepath)
        # Sea õigused loetavaks kõigile (Docker/root probleemi vältimiseks)
        os.chmod(filepath, 0o644)
    except Exception:
        # Kustuta temp fail kui os.replace() ebaõnnestus
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise

# Nanoid seadistus
NANOID_LENGTH = 6
NANOID_ALPHABET = string.ascii_lowercase + string.digits  # a-z, 0-9

# Cache: Work ID (nanoid) -> Directory path
WORK_ID_CACHE = {}


def generate_nanoid(length=NANOID_LENGTH):
    """Genereerib nanoid-stiilis lühikoodi."""
    return ''.join(secrets.choice(NANOID_ALPHABET) for _ in range(length))


def sanitize_id(text):
    """Puhastab teksti, et see sobiks ID-ks (sama loogika mis 1-1 skriptis)."""
    if not text:
        return ""
    # Eemalda diakriitikud
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    # Asenda kõik mitte-lubatud märgid alakriipsuga
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', ascii_text)
    # Eemalda mitu järjestikust alakriipsu
    sanitized = re.sub(r'_+', '_', sanitized)
    # Eemalda algus- ja lõpukriipsud
    sanitized = sanitized.strip('_-')
    return sanitized


def capitalize_first(text):
    """Teeb esimese tähe suureks, ülejäänud jätab samaks (toetab lühendeid)."""
    if not text:
        return ""
    return text[0].upper() + text[1:]


def build_work_id_cache():
    """Ehitab mälu-cache'i work_id -> directory_path vastavustest.
    
    Käivitada serveri stardil.
    """
    global WORK_ID_CACHE
    WORK_ID_CACHE = {}
    print("Building Work ID cache...")
    
    if not os.path.exists(BASE_DIR):
        print(f"Hoiatus: Andmekausta {BASE_DIR} ei leitud.")
        return

    count = 0
    try:
        for entry in os.scandir(BASE_DIR):
            if entry.is_dir():
                meta_path = os.path.join(entry.path, '_metadata.json')
                if os.path.exists(meta_path):
                    try:
                        with open(meta_path, 'r', encoding='utf-8') as f:
                            meta = json.load(f)
                            work_id = meta.get('id')
                            if work_id:
                                WORK_ID_CACHE[work_id] = entry.path
                                count += 1
                    except Exception as e:
                        print(f"Viga metaandmete lugemisel {entry.name}: {e}")
    except Exception as e:
        print(f"Viga cache ehitamisel: {e}")
    
    print(f"Work ID cache built: {count} entries.")


def find_directory_by_id(target_id):
    """Leiab failisüsteemist kausta teose ID järgi.

    Otsib järjekorras:
    1. Cache (kui on laetud)
    2. `id` väli (nanoid, püsiv) - otsib failisüsteemist kui cache puudub
    3. `slug` väli
    4. Kausta nimi (sanitiseeritult, viimane võimalus)
    """
    if not target_id:
        return None

    # 1. Cache lookup
    if target_id in WORK_ID_CACHE:
        path = WORK_ID_CACHE[target_id]
        if os.path.exists(path):
            return path
        else:
            # Cache on aegunud (kaust kustutatud?)
            del WORK_ID_CACHE[target_id]

    # Aeglane failisüsteemi otsing
    try:
        for entry in os.scandir(BASE_DIR):
            if entry.is_dir():
                meta_path = os.path.join(entry.path, '_metadata.json')
                if os.path.exists(meta_path):
                    try:
                        with open(meta_path, 'r', encoding='utf-8') as f:
                            meta = json.load(f)

                            # 2. Kontrolli nanoid `id` välja (eelistatud)
                            work_id = meta.get('id')
                            if work_id == target_id:
                                WORK_ID_CACHE[work_id] = entry.path
                                return entry.path

                            # 3. Kontrolli slug välja
                            slug = meta.get('slug')
                            if slug == target_id:
                                return entry.path
                    except:
                        pass

                # 4. Kontrolli kausta nime (sanitiseeritult)
                if sanitize_id(entry.name) == target_id:
                    return entry.path
    except Exception:
        pass

    return None


def get_label(value, lang='et'):
    """Tagastab sildi LinkedEntity objektist või stringist eelistatud keeles."""
    if not value:
        return ""
    if isinstance(value, str):
        return capitalize_first(value)
    if isinstance(value, dict):
        # Proovi leida silti konkreetses keeles
        labels = value.get('labels')
        if labels and isinstance(labels, dict):
            if labels.get(lang):
                return capitalize_first(labels[lang])
            # Fallback eesti keelele
            if labels.get('et'):
                return capitalize_first(labels['et'])
        
        # Fallback peamisele sildile
        return capitalize_first(value.get('label', ''))
    return capitalize_first(str(value))


def get_id(value):
    """Tagastab ID LinkedEntity objektist."""
    if isinstance(value, dict):
        return value.get('id')
    return None


def get_all_labels(value):
    """Kogub kõik sildid (sh mitmekeelsed) LinkedEntity objektist või massiivist."""
    if not value:
        return []

    values = value if isinstance(value, list) else [value]
    labels = []

    for val in values:
        if isinstance(val, str):
            labels.append(capitalize_first(val))
        elif isinstance(val, dict):
            # Peamine silt
            if val.get('label'):
                labels.append(capitalize_first(val['label']))
            # Mitmekeelsed sildid
            if val.get('labels') and isinstance(val['labels'], dict):
                for l in val['labels'].values():
                    if l:
                        labels.append(capitalize_first(l))

    return sorted(list(set(labels)))


def get_primary_labels(value):
    """Tagastab ainult peamised sildid LinkedEntity objektist või massiivist. Eelistab eesti keelt."""
    if not value:
        return []
    
    values = value if isinstance(value, list) else [value]
    labels = []
    
    for val in values:
        if isinstance(val, str):
            labels.append(capitalize_first(val))
        elif isinstance(val, dict):
            # Eelisjärjekord: et > label > esimene väärtus labels dictist
            label = None
            if val.get('labels') and isinstance(val['labels'], dict):
                label = val['labels'].get('et')
            
            if not label:
                label = val.get('label')
            
            if label:
                labels.append(capitalize_first(label))
                
    return labels


def get_labels_by_lang(value, lang):
    """Tagastab sildid konkreetses keeles (või fallback)."""
    if not value:
        return []
    
    values = value if isinstance(value, list) else [value]
    labels = []
    
    for val in values:
        if isinstance(val, str):
            # Stringi puhul ei tea keelt, tagastame alati (eeldades et on primaarne)
            labels.append(capitalize_first(val))
        elif isinstance(val, dict):
            label = None
            # Otsi konkreetses keeles
            if val.get('labels') and isinstance(val['labels'], dict):
                label = val['labels'].get(lang)
            
            # Fallback: primaarne label
            if not label:
                label = val.get('label')
            
            if label:
                labels.append(capitalize_first(label))
                
    return labels


def get_all_ids(value):
    """Kogub kõik ID-d LinkedEntity objektist või massiivist."""
    if not value:
        return []

    values = value if isinstance(value, list) else [value]
    ids = []

    for val in values:
        if isinstance(val, dict) and val.get('id'):
            ids.append(val['id'])

    return sorted(list(set(ids)))


def generate_default_metadata(dir_name):
    """Genereerib vaike-metaandmed kataloogi nime põhjal."""
    slug = sanitize_id(dir_name)

    # Pealkiri kataloogi nimest (eemaldame aastaarvu ja ID osa kui võimalik)
    clean_title = re.sub(r'^\d{4}[-_]\d+[-_]?', '', dir_name)
    if clean_title == dir_name:
        clean_title = re.sub(r'^\d{4}[-_]?', '', dir_name)

    title = clean_title.replace('-', ' ').replace('_', ' ').strip().capitalize() if clean_title else "Pealkiri puudub"

    # Proovi leida aasta
    year = 0
    year_match = re.match(r'^(\d{4})', dir_name)
    if year_match:
        year = int(year_match.group(1))

    return {
        "id": generate_nanoid(),
        "slug": slug,
        "title": title,
        "year": year,
        "location": None,
        "publisher": None,
        "creators": [],
        "tags": [],
        "type": None,
        "genre": None,
        "languages": [],
        "collection": None,
        "ester_id": None,
        "external_url": None
    }


def normalize_genre(tag):
    """Normaliseerib žanri väärtuse 'disputatsioon'-iks, kui see on üks sünonüümidest."""
    # Kui on objekt, võta sealt label
    if isinstance(tag, dict):
        label = tag.get('label', '')
        # Võime tagastada objekti muutmata kujul, või normaliseerida labelit.
        # Kuna normalize_genre eesmärk on ühtlustada stringe vanade andmete jaoks,
        # siis objektide puhul (mis tulevad Wikidatast) on need ilmselt juba korras.
        # Tagastame objekti endisena.
        return tag
    
    if not isinstance(tag, str):
        return tag

    synonyms = ["dissertatsioon", "exercitatio", "teesid", "dissertatio", "theses", "disputatio"]
    if tag and tag.strip().lower() in synonyms:
        return "disputatsioon"
    return tag.strip().lower() if tag else tag


def calculate_work_status(page_statuses):
    """Arvutab teose koondstaatuse lehekülgede staatuste põhjal.

    Loogika: Kõik Valmis → Valmis, Kõik Toores/Leidmata → Toores, muidu → Töös
    """
    if not page_statuses:
        return 'Toores'

    # Valmis / Tehtud (Frontendis näib olevat DONE või Tehtud)
    done_aliases = ['Valmis', 'Tehtud', 'DONE']
    # Toores / Algne
    raw_aliases = ['Toores', 'Algne', 'RAW', '']

    is_all_done = all(s in done_aliases for s in page_statuses)
    if is_all_done:
        return 'Valmis'

    is_all_raw = all(s in raw_aliases or s is None for s in page_statuses)
    if is_all_raw:
        return 'Toores'

    return 'Töös'
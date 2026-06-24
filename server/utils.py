"""
Abifunktsioonid ja utiliidid.
"""
import os
import re
import json
import secrets
import string
import tempfile
import threading
import unicodedata
from typing import Optional, Tuple
from .config import BASE_DIR, get_logger

logger = get_logger(__name__)

# Jagatud lukud failioperatsioonide jaoks (race condition'ide vältimine)
metadata_lock = threading.RLock()  # _metadata.json operatsioonid
page_json_lock = threading.RLock()  # Lehekülje .json failide operatsioonid


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
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)
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


_LANG_CHAIN = ['et', 'en', 'la', 'de']

def pick_best_label(labels_dict, lang):
    """Kanooniline keele-fallback: lang → et → en → la → de → ''."""
    if not labels_dict or not isinstance(labels_dict, dict):
        return ''
    base_lang = lang.split('-')[0]
    if labels_dict.get(base_lang):
        return labels_dict[base_lang]
    for l in _LANG_CHAIN:
        if l != base_lang and labels_dict.get(l):
            return labels_dict[l]
    return ''


# Sajandimuster: "19. saj", "19. sajand", "19 saj" (stringi algusest, trimmituna)
_CENTURY_RE = re.compile(r'^(\d{1,2})\.?\s*saj', re.IGNORECASE)
# Sajandite vahemik: "17.-19. saj", "17-19. saj", "17. – 19. saj" (vt issue #31).
# Eraldi muster, kontrollitakse ENNE _CENTURY_RE-d, sest üksik-sajandi muster
# (ankerdatud, nõuab 'saj' kohe pärast numbrit) ei taba vahemikku.
_CENTURY_RANGE_RE = re.compile(r'^(\d{1,2})\.?\s*[-\u2013\u2014]\s*(\d{1,2})\.?\s*saj', re.IGNORECASE)
_YEAR4_RE = re.compile(r'\d{4}')
_APPROX_RE = re.compile(r'\bca\.?\b', re.IGNORECASE)


def parse_year_range(year, year_display) -> Optional[Tuple[int, int]]:
    """Tuletab teose aastavahemiku (year_start, year_end) filtreerimise jaoks.

    "19. saj"      -> (1801, 1900)   N. sajand = (N-1)*100+1 ... N*100
    "17.-19. saj"  -> (1601, 1900)   sajandite vahemik: 17. saj algusest kuni 19. saj lõpuni
    "ca. 1750"     -> (1740, 1760)
    "1670-1690"    -> (1670, 1690)   aastad sorititakse (vt issue #31)
    "1690-1670"    -> (1670, 1690)   tagurpidi vahemik normaliseeritakse
    "1750"         -> (1750, 1750)
    Tagastab None kui aastat ei tuvastata.
    NB: peegelloogika frontendis: src/utils/yearDisplayUtils.ts parseYearDisplayRange
    """
    if year_display:
        s = str(year_display).strip()
        # Sajandite vahemik kõigepealt (üksik-sajandi muster seda ei taba)
        mr = _CENTURY_RANGE_RE.match(s)
        if mr:
            c1, c2 = sorted((int(mr.group(1)), int(mr.group(2))))
            return ((c1 - 1) * 100 + 1, c2 * 100)
        m = _CENTURY_RE.match(s)
        if m:
            c = int(m.group(1))
            return ((c - 1) * 100 + 1, c * 100)
        # Aastad sorititakse, et tagurpidi vahemik ("1690-1670") annaks
        # (1670, 1690), mitte (1690, 1670) — year_start peab <= year_end (vt issue #31)
        years = sorted(int(y) for y in _YEAR4_RE.findall(s))
        if len(years) >= 2:
            return (years[0], years[-1])
        if len(years) == 1:
            y = years[0]
            if _APPROX_RE.search(s):
                return (y - 10, y + 10)
            return (y, y)
    try:
        numeric = int(year) if year else 0
    except (TypeError, ValueError):
        numeric = 0
    if numeric:
        return (numeric, numeric)
    return None


def build_work_id_cache():
    """Ehitab mälu-cache'i work_id -> directory_path vastavustest.
    
    Käivitada serveri stardil.
    """
    global WORK_ID_CACHE
    WORK_ID_CACHE = {}
    logger.info("Building Work ID cache...")
    
    if not os.path.exists(BASE_DIR):
        logger.warning(f"Hoiatus: Andmekausta {BASE_DIR} ei leitud.")
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
                        logger.error(f"Viga metaandmete lugemisel {entry.name}: {e}")
    except Exception as e:
        logger.error(f"Viga cache ehitamisel: {e}")
    
    logger.info(f"Work ID cache built: {count} entries.")


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
                    except Exception:
                        pass

                # 4. Kontrolli kausta nime (sanitiseeritult)
                if sanitize_id(entry.name) == target_id:
                    return entry.path
    except Exception:
        pass

    return None


def get_label(value, lang='et'):
    """Tagastab sildi LinkedEntity objektist, stringist või massiivist (esimene element) eelistatud keeles."""
    if not value:
        return ""
    if isinstance(value, list):
        return get_label(value[0], lang) if value else ""
    if isinstance(value, str):
        return capitalize_first(value)
    if isinstance(value, dict):
        labels = value.get('labels')
        if labels and isinstance(labels, dict):
            label = pick_best_label(labels, lang)
            if label:
                return capitalize_first(label)
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


def get_labels_by_lang(value, lang, labels_store=None):
    """Tagastab sildid konkreetses keeles (või fallback).

    Args:
        value: LinkedEntity objekt, string või nende massiiv
        lang: keelekood ('et', 'en', jne)
        labels_store: kanooniline Q-koodi → label register (state/labels.json)
    """
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
            qcode = val.get('id', '')
            # Kontrolli labels_store esmalt (kanooniline allikas — ületab _metadata.json labeli)
            if labels_store and qcode and qcode in labels_store:
                label = pick_best_label(labels_store[qcode], lang)
            else:
                if val.get('labels') and isinstance(val['labels'], dict):
                    label = pick_best_label(val['labels'], lang)
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
"""
Abifunktsioonid ja utiliidid.
"""
import os
import re
import json
import unicodedata
from .config import BASE_DIR


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


def find_directory_by_id(target_id):
    """Leiab failisüsteemist kausta teose ID järgi."""
    if not target_id:
        return None

    for entry in os.scandir(BASE_DIR):
        if entry.is_dir():
            # 1. Kontrolli _metadata.json faili sisu
            meta_path = os.path.join(entry.path, '_metadata.json')
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        if meta.get('teose_id') == target_id:
                            return entry.path
                except:
                    pass

            # 2. Kontrolli kausta nime (sanitiseeritult)
            if sanitize_id(entry.name) == target_id:
                return entry.path
    return None


def generate_default_metadata(dir_name):
    """Genereerib vaike-metaandmed kataloogi nime põhjal."""
    teose_id = sanitize_id(dir_name)

    # Pealkiri kataloogi nimest (eemaldame aastaarvu ja ID osa kui võimalik)
    # Sama loogika mis 1-1_consolidate_data.py skriptis
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
        "teose_id": teose_id,
        "pealkiri": title,
        "autor": "",
        "respondens": "",
        "aasta": year,
        "teose_tags": [],
        "ester_id": None,
        "external_url": None
    }


def normalize_genre(tag):
    """Normaliseerib žanri väärtuse 'disputatsioon'-iks, kui see on üks sünonüümidest."""
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

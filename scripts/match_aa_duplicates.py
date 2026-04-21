"""
Interaktiivne skript sulunimega prosopo isikute sobitamiseks AA-koodiga duplikaatidega.

Käivitus (serveril):
    cd ~/VUTT && python3 scripts/match_aa_duplicates.py
    python3 scripts/match_aa_duplicates.py --dry-run   # merge ei toimu

Progress salvestatakse: state/match_aa_progress.json
"""
import json
import os
import re
import sys
from typing import Optional

# Projekti juur sys.path-i — serverimoodulite importimiseks
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BASE_DIR not in sys.path:
    sys.path.insert(0, _BASE_DIR)


def extract_name_variants(label: str) -> list:
    """
    Ekstraheerib kõik nimevariandid sulgunimest.

    "Limacius (Limasius), Andreas" → ["limacius", "limasius", "andreas"]
    "Wag(e)ner, Heinrich"          → ["wagner", "wagener", "heinrich"]
    "Bus(sch)man(nus)"             → ["busman", "busschmannus"]
    """
    tokens = set()

    # 1. Täissõna variandid suludes (≥4 tähemärki)
    for v in re.findall(r'\(([A-Za-zÀ-ÿ]{4,})\)', label):
        tokens.add(v.lower())

    # 2. Stripitud versioon — sulud eemaldatud: Wag(e)ner → wagner
    stripped = re.sub(r'\([^)]*\)', '', label)
    for w in re.split(r'[,\s]+', stripped):
        if len(w) >= 3:
            tokens.add(w.lower())

    # 3. Kaasav versioon — sulu sisu lisatakse: Wag(e)ner → wagener
    included = re.sub(r'\(([^)]*)\)', r'\1', label)
    for w in re.split(r'[,\s]+', included):
        if len(w) >= 3:
            tokens.add(w.lower())

    return list(tokens)

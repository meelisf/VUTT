#!/usr/bin/env python3
"""Kas serveris on tööd lennus? Deploy-valve (#257).

Tootmises 2026-08-24 tappis deploy kasutaja poolelioleva upload'i: 59 MB PDF,
33 lehe eelvaade, 27 poolitusotsust. Päästmine nõudis käsitsi `state.json`
parandust. Deploy'ja oli kontrollinud `reocr_active.json`-i ja UNUSTANUD
uploadid — kaht kohta käsitsi meeles pidada ei tööta.

Loeb AINULT faile, mitte API-t: peab töötama ka siis, kui backend on maas,
kinni või just seetõttu taaskäivitamist ootab. Ainult stdlib, et
`server_update.sh` ei sõltuks venv-i seisust.

Väljumiskood: 0 = puhas, 1 = midagi on lennus (server_update.sh peatub).
"""
import json
import os
import sys
from datetime import datetime

# Upload'i staatused, mille ajal lõime tapmine kaotab kasutaja tööd.
# `applying` — 300 DPI renderdus + SFTP käib; restart jätab upload'i rippu (#256).
# `processing` — partii on OCR-serveris, pisipiltide sünk käib.
# `collecting_images` — pildikausta kogumine käib VUTT-i poolel.
UPLOAD_LENNUS = ("applying", "processing", "collecting_images")

# Re-OCR töö staatused, mis tähendavad elavat lõime.
REOCR_LENNUS = ("uploading", "processing", "cancelling")


def _vanus(algus) -> str:
    """Inimloetav kestus. „Kaua see kestnud on" otsustab, kas oodata tasub."""
    if not algus:
        return "aeg teadmata"
    for vorming in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            algusaeg = datetime.strptime(str(algus)[:26], vorming)
            break
        except ValueError:
            continue
    else:
        return "aeg teadmata"
    minutid = int((datetime.now() - algusaeg).total_seconds() // 60)
    if minutid < 1:
        return "alla minuti"
    if minutid < 60:
        return "{} min".format(minutid)
    return "{} h {} min".format(minutid // 60, minutid % 60)


def _uploadid(juur: str):
    leiud = []
    kaust = os.path.join(juur, "uploads")
    if not os.path.isdir(kaust):
        return leiud
    for uid in sorted(os.listdir(kaust)):
        tee = os.path.join(kaust, uid, "state.json")
        if not os.path.exists(tee):
            continue
        try:
            with open(tee, encoding="utf-8") as f:
                s = json.load(f)
        except Exception as e:
            # Loetamatu fail EI TOHI anda rohelist tuld. Valve mõte on öelda,
            # et me EI TEA, kas midagi on lennus — vaikne „ei leidnud" on siin
            # halvim võimalik vastus.
            leiud.append("upload {}: state.json loetamatu ({})".format(uid, e))
            continue
        if s.get("status") in UPLOAD_LENNUS:
            pealkiri = (s.get("meta") or {}).get("title") or "pealkirjata"
            leiud.append("upload {} [{}] „{}“ — {}".format(
                uid, s.get("status"), pealkiri, _vanus(s.get("created_at"))))
    return leiud


def _reocr(juur: str):
    tee = os.path.join(juur, "state", "reocr_active.json")
    if not os.path.exists(tee):
        # Faili puudumine tähendab „ühtki tööd pole olnud", mitte viga.
        return []
    try:
        with open(tee, encoding="utf-8") as f:
            andmed = json.load(f)
    except Exception as e:
        return ["reocr_active.json loetamatu ({})".format(e)]

    tood = andmed if isinstance(andmed, list) else list(andmed.values())
    leiud = []
    for too in tood:
        if not isinstance(too, dict):
            continue
        if too.get("status") in REOCR_LENNUS:
            leiud.append("re-OCR {} [{}] teos {} — {}".format(
                too.get("job_id", "?"), too.get("status"),
                too.get("work_id", "?"), _vanus(too.get("started_at"))))
    return leiud


def leia_lennus_olevad(juur: str):
    """Kõik lennus olev, inimloetavate ridadena. Tühi list = puhas seis."""
    return _uploadid(juur) + _reocr(juur)


def main() -> int:
    juur = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/VUTT")
    leiud = leia_lennus_olevad(juur)
    if not leiud:
        print("✅ Ühtki tööd ei ole lennus.")
        return 0
    print("⛔ Töö on lennus — restart kaotaks selle:")
    for rida in leiud:
        print("   • {}".format(rida))
    print()
    print("   Oota lõpuni või kasuta --force, kui deploy on kiireloomuline.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

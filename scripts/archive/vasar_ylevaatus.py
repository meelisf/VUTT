#!/usr/bin/env python3
"""jbc88t (Vasari klapitus): lipuga ridade ülevaatuse parandused + kommentaaride koristus.

Parandused on tehtud skaneeringu järgi (2026-11-03). Põhimõte: tekst nagu käsikirjas,
interlineaarne lisandus on `<add>` oma kohas (ADR 0067), ridadevaheline sõna ei ole
omaette rida; püüdsõna on `<catch>`. Vasari laienduste eemaldamine jättis lühendid
punktita („v", „n", „I M D") — punkt tagasi nagu käsikirjas.

Kommentaaridest (id `vasar-*`) eemaldatakse „Üle vaadata" loend; asemele üks rida.
Salvestus /save kaudu koos meta_content'i ja base'iga (kolmesuunaline liitmine,
ADR 0054): leht kirjutatakse ainult siis, kui kettal on sama seis, mis kuivkäivitusel.

    python3 scripts/archive/vasar_ylevaatus.py             # kuivkäivitus
    python3 scripts/archive/vasar_ylevaatus.py --kirjuta
"""
import copy
import getpass
import glob
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
KAUST = "1632-tartu-ulikooli-academia-gustaviana-pohikiri-17-saj-2-pool-umber-kirjutanud"
API = "http://127.0.0.1:8002"
SILT = "Vasari klapitus"
KOMMENTAARI_LOPP = "\n\nLipuga read skaneeringu järgi üle vaadatud 2026-11-03; ligatuurid (æ, œ) lahti kirjutatud."

# (lehe id, vana, uus) — vana peab failis esinema TÄPSELT üks kord
PARANDUSED = [
    # lk 8
    ("nijmxt", "remqve ad Cancellarium\npericulosae\ndeferendi, ut is super illo negotio decimat δ) si periculosae & turbu-",
     "remqve ad Cancellarium\ndeferendi, ut is super illo negotio decidat δ) si <add>periculosae</add> & turbu-"),
    # lk 9
    ("03xao1", "ne qvis hic negli-", "ne qvis <add>hic</add> negli-"),
    ("03xao1", "\nnovi\nIntroductio autem Rectoris novi hoc", "\nIntroductio autem Rectoris <add>novi</add> hoc"),
    ("03xao1", "Academicis aliis aliis aede", "Academicis aliis aede"),
    # lk 10
    ("ao1wzt", "ubi et et delinqventis", "ubi et delinqventis"),
    ("ao1wzt", "Ad Vatemendum", "<catch>Iuramentum</catch>"),
    # lk 13
    ("7u2ab3", "ac devolviet.", "ac devolvet."),
    ("7u2ab3", "concernentibus. 8.\nProvocatio", "concernentibus.\n8. Provocatio"),
    ("7u2ab3", "tricesimum , proposito", "tricesimum, proposito"),
    # lk 14
    ("q7fouq", "ad vitae perservaturum. 49. Deinde Ser ac Potentis",
     "ad vitae finem perservaturum. Deinde Ser. ac Potentiss."),
    ("q7fouq", "2. Horum erit,", "2. Horum officium erit,"),
    # lk 15
    ("8wrfj2", "censura prius non", "censura <add>prius</add> non"),
    # lk 16
    ("cnu9tl", "deinde JCTi. Jctos", "deinde J.C.Ti. Jctos"),
    ("cnu9tl", "caeterarum qvoqve\nFacultatum\nDoctores servabunt.", "caeterarum qvoqve\n<add>Facultatum</add> Doctores servabunt."),
    ("cnu9tl", "Qvod si qvis\nSuperioris\nFacultatis Doctor", "Qvod si qvis\nSuperioris Facultatis Doctor"),
    ("cnu9tl", "ad publicum docen-\ndi", "ad publicum docen-\n<catch>di</catch>"),
    # lk 17
    ("x52si6", "Profefforibus\nmunus adhibeantur, postiores sunt omnibus Professoribus.",
     "di munus adhibeantur, posteriores sunt omnibus <add>Professoribus</add>."),
    ("x52si6", "Regiae\nnomine\nad confirmandum", "Regiae\nad confirmandum"),
    ("x52si6", "Hi (1) bis\nqvotannis aut", "Hi (1) bis qvot-\nannis aut"),
    # lk 22
    ("w366n3", "absolverent.", "absolvent."),
    ("w366n3", "pridie invitat ad", "pridie invitabit ad"),
    # lk 23
    ("sx7h30", "\nI M D adjuvet.", "\nI. M. D. adjuvet."),
    ("sx7h30", "Ita me D adjuvet!", "Ita me D. adjuvet!"),
    ("sx7h30", "ones , lites", "ones, lites"),
    # lk 24
    ("07sizb", "I M D adjuvet!", "I. M. D. adjuvet!"),
    ("07sizb", "superio- rum", "superiorum"),
    # lk 25
    ("8rs33c", "administrandae erunt,", "administrandae <add>erunt</add>,"),
    # lk 26
    ("8rmcmn", "instituendae sint. 1)\nPrivatae", "instituendae sint.\n1) Privatae"),
    # lk 31
    ("1cyqbg", "esse et qvamcunqve", "esse Arithmeticam et qvamcunqve"),
    ("1cyqbg", "Eeuclides", "Euclides"),
    # lk 32
    ("25123k", "in N T libris", "in N. T. libris"),
    ("25123k", "qvidem hor 8 Antemera.", "qvidem hor. 8 Antemera."),
    ("25123k", "aut etiam Golij", "vel etiam Golij"),
    # lk 33
    ("66icu1", "Academiae peculiare,", "Academiae peculiares,"),
    ("66icu1", "hora 4 pom praecepta", "hora 4 pom. praecepta"),
    ("66icu1", "Plutarcho, Livio\nOrationum\nexceptis; lisdemqve dabit dispositiones Orationum, qvas",
     "Plutarcho, Livio etc. ex-\nceptis; iisdemqve dabit dispositiones <add>Orationum</add>, qvas"),
    # lk 35
    ("h5y8f7", "in Rei- publ. administratione", "in Reipubl. administratione"),
    # lk 36
    ("wpfud0", "ad 30 Decembris sumae", "ad 30 Xbr. sumae"),
    ("wpfud0", "circa 17 br.", "circa 7br."),
    ("wpfud0", "Accademiae", "Academiae"),
    # lk 37
    ("5agu0a", "Theologos et Philosophos\nnec", "Theologos et Philosophos\n<catch>nec</catch>"),
    # lk 38 (teine käsi; foliant „20" ei ole tekst, punktinumbrid rea algusesse)
    ("021", "20\nDEI ipsius", "DEI ipsius"),
    ("021", "exclusione. III.\nCrebro", "exclusione.\nIII. Crebro"),
    ("021", "morem gerite. V.\nNemo", "morem gerite.\nV. Nemo"),
    ("021", "relegabuntur. VI.\nNemo", "relegabuntur.\nVI. Nemo"),
    ("021", "fideles, crebris\naccedite", "fideles, crebris ac-\ncedite"),
    ("021", "vitate. Certum n\nexitium", "vitate. Certum n. ex-\nitium"),
    # lk 39
    ("022", "patienter sit..; honestis", "patienter ferat, sit .... honestis"),
    ("022", "πειραν", "πενιαν"),
    ("022", "hac addita\ncomminatione", "hac addi-\nta comminatione"),
]

# Vasari „v[ero]" / „n[am]" → käsikirja „v." / „n." (üksiktäht sõnana, punktita)
LUHEND = re.compile(r"(?<= )([vn])(?=[ ,]|$)", re.MULTILINE)


def nfc(s):
    return unicodedata.normalize("NFC", s)


def paring(meetod, tee, keha=None, token=None):
    paised = {"Content-Type": "application/json"}
    if token:
        paised["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(API + tee, method=meetod, headers=paised,
                                 data=json.dumps(keha).encode() if keha is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def teisenda_tekst(leht, tekst):
    uus = nfc(tekst)
    for lid, vana, asendus in PARANDUSED:
        if lid != leht:
            continue
        vana, asendus = nfc(vana), nfc(asendus)
        n = uus.count(vana)
        if n != 1:
            sys.exit(f"VIGA {leht}: {vana!r} esineb {n} korda (oodatud 1)")
        uus = uus.replace(vana, asendus)
    return LUHEND.sub(r"\1.", uus)


def koristatud_kommentaarid(kommentaarid):
    uued = copy.deepcopy(kommentaarid or [])
    muutus = False
    for c in uued:
        if not str(c.get("id", "")).startswith("vasar-"):
            continue
        tekst = c.get("text", "")
        for marker in ("\n\nÜle vaadata:", "\n\nMärgitud ridu pole"):
            i = tekst.find(marker)
            if i != -1:
                tekst = tekst[:i]
        if KOMMENTAARI_LOPP.strip() not in tekst:
            tekst += KOMMENTAARI_LOPP
        if tekst != c.get("text"):
            c["text"] = tekst
            muutus = True
    return uued, muutus


def main():
    kaust = os.path.join(DATA, KAUST)
    tood = []
    for jf in sorted(glob.glob(os.path.join(kaust, "*.json"))):
        if os.path.basename(jf).startswith("_"):
            continue
        meta = json.load(open(jf, encoding="utf-8"))
        sildid = [t if isinstance(t, str) else t.get("label") for t in meta.get("page_tags") or []]
        if SILT not in sildid:
            continue
        tf = jf[:-5] + ".txt"
        leht = os.path.basename(tf).rsplit("jbc88t-", 1)[1][:-4]
        vana = open(tf, encoding="utf-8").read()
        uus = teisenda_tekst(leht, vana)
        kommentaarid, k_muutus = koristatud_kommentaarid(meta.get("comments"))
        if uus != nfc(vana) or k_muutus:
            uus_meta = dict(meta, comments=kommentaarid)
            tood.append((leht, os.path.basename(tf), vana, uus, meta, uus_meta))

    lehed = {lid for lid, *_ in PARANDUSED}
    puudu = lehed - {t[0] for t in tood}
    if puudu:
        sys.exit(f"VIGA: parandatavad lehed puuduvad: {sorted(puudu)}")

    luhendeid = sum(len(LUHEND.findall(nfc(t[2]))) for t in tood)
    print(f"Lehti {len(tood)}, käsitsi parandusi {len(PARANDUSED)}, lühendipunkte {luhendeid}.")
    for leht, fail, vana, uus, meta, uus_meta in tood:
        va, ua = nfc(vana).split("\n"), uus.split("\n")
        if va != ua:
            print(f"\n== {leht}")
            import difflib
            for rida in difflib.unified_diff(va, ua, lineterm="", n=0):
                if not rida.startswith(("---", "+++")):
                    print("  " + rida)
    naidis = next(t for t in tood if t[0] == "xzb6ai")
    print("\nKommentaar (xzb6ai) pärast:\n" + next(c["text"] for c in naidis[5]["comments"]
                                               if c["id"].startswith("vasar-")))

    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return

    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    vead = 0
    for leht, fail, vana, uus, meta, uus_meta in tood:
        if open(os.path.join(kaust, fail), encoding="utf-8").read() != vana or \
                json.load(open(os.path.join(kaust, fail[:-4] + ".json"), encoding="utf-8")) != meta:
            print(f"VAHELE {leht}: leht muutunud pärast lugemist")
            vead += 1
            continue
        base = {"text_content": vana, **{k: meta.get(k) for k in
                                         ("status", "page_tags", "comments", "text_annotations")}}
        kood, vastus = paring("POST", "/save", {"original_path": KAUST, "file_name": fail,
                                                 "text_content": uus, "meta_content": uus_meta,
                                                 "base": base}, token=token)
        ok = kood == 200 and vastus.get("changed") and vastus.get("git_committed")
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {leht}  {kood} {'' if ok else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
